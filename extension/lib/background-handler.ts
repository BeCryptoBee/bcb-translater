import type { ProcessRequest, ProcessResponse } from './messages';
import { getSettings } from './storage';
import { getInstallId } from './install-id';
import { getEntry, setEntry, getCacheKey, type StorageAdapter } from './cache';
import {
  buildTranslatePrompt,
  buildSummarizePrompt,
  buildTranslateSegmentedPrompt,
  TEMPERATURES,
  SEGMENTED_RESPONSE_SCHEMA,
} from './prompts';
import { callWithFallback } from './llm-fallback';
import { callProxy } from './providers/proxy';
import { incrementLocalQuota } from './quota';
import { detectLanguage, pickSmartTarget } from './lang-detect';
import { validateSegments } from './segments-validate';

const MAX_LEN = 10_000;

export async function handleProcess(
  req: ProcessRequest,
  store: StorageAdapter,
): Promise<ProcessResponse> {
  if (!req.text.trim()) {
    return { ok: false, code: 'invalid_input', message: 'Empty text' };
  }
  if (req.text.length > MAX_LEN) {
    return {
      ok: false,
      code: 'too_long',
      message: 'Text too long (>10 KB) — please shorten',
    };
  }

  const settings = await getSettings();
  const targetLang = req.smartDirection
    ? pickSmartTarget(detectLanguage(req.text), settings)
    : (req.targetLang || settings.targetLang);
  // Translation Highlight only applies to translate mode. When ON, the
  // pipeline asks the model for a JSON-segmented response and surfaces
  // segments+separators alongside the flat result.
  const segmented = req.mode === 'translate' && settings.translationHighlight === true;

  const cacheKey = await getCacheKey({
    mode: req.mode,
    text: req.text,
    targetLang,
    segmented,
  });
  const cached = await getEntry(cacheKey, store);
  if (cached) {
    // Cache stores only the flat string. On a hit we lose segments; the
    // popup degrades to plain rendering. Acceptable per spec.
    return { ok: true, result: cached, provider: 'gemini', cached: true };
  }

  const flatBuilt =
    req.mode === 'translate'
      ? buildTranslatePrompt({ text: req.text, targetLang })
      : buildSummarizePrompt({ text: req.text, targetLang });
  const segBuilt = segmented
    ? buildTranslateSegmentedPrompt({ text: req.text, targetLang })
    : null;
  const temperature = TEMPERATURES[req.mode];

  try {
    let result: string;
    let provider: 'gemini' | 'groq';
    let remainingQuota: number | undefined;
    let segments: Array<{ src: string; tgt: string }> | undefined;
    let separators: string[] | undefined;

    if (settings.userApiKey) {
      // Own-key path. When segmented, ask provider in JSON mode then parse +
      // validate locally; on failure, fall back to flat prompt once.
      if (segBuilt) {
        const r = await callWithFallback(settings.provider, {
          system: segBuilt.system,
          prompt: segBuilt.user,
          temperature,
          apiKey: settings.userApiKey,
          jsonMode: { schema: SEGMENTED_RESPONSE_SCHEMA as object },
        });
        let parsed: unknown;
        try { parsed = JSON.parse(r.text); } catch { parsed = null; }
        const v = parsed && typeof parsed === 'object'
          ? validateSegments((parsed as { segments?: unknown }).segments, req.text)
          : { ok: false as const, reason: 'parse_failed' };
        if (v.ok) {
          segments = v.segments;
          separators = v.separators;
          result = v.derivedFlat;
          provider = r.provider;
        } else {
          // Single retry with the flat prompt; no JSON mode.
          const r2 = await callWithFallback(settings.provider, {
            system: flatBuilt.system,
            prompt: flatBuilt.user,
            temperature,
            apiKey: settings.userApiKey,
          });
          result = r2.text;
          provider = r2.provider;
          // segments/separators stay undefined — UI degrades to flat.
        }
      } else {
        const r = await callWithFallback(settings.provider, {
          system: flatBuilt.system,
          prompt: flatBuilt.user,
          temperature,
          apiKey: settings.userApiKey,
        });
        result = r.text;
        provider = r.provider;
      }
    } else {
      // Proxy path — the worker handles segmented branching server-side
      // and returns segments/separators when the toggle is on.
      const installId = await getInstallId();
      const r = await callProxy({
        mode: req.mode,
        text: req.text,
        targetLang,
        installId,
        ...(segmented ? { segmented: true } : {}),
      });
      result = r.text;
      provider = r.provider;
      remainingQuota = r.remainingQuota;
      if (segmented && r.segments) {
        segments = r.segments;
        separators = r.separators;
      }
      await incrementLocalQuota();
    }

    // Structure-preservation safeguard for translation only (one retry max).
    // Skip when we have segments — the segment-by-segment join algorithm
    // already preserves source whitespace exactly, so the heuristic would
    // misfire (each tgt has no internal newlines) and discard the segments.
    if (req.mode === 'translate' && segments === undefined) {
      const srcN = (req.text.match(/\n/g) ?? []).length;
      const dstN = (result.match(/\n/g) ?? []).length;
      if (srcN >= 2 && dstN < srcN / 2) {
        const reinforcedSystem =
          flatBuilt.system +
          '\n\nREMINDER: The source has line breaks. The output MUST contain the same number of line breaks in the same positions.';
        try {
          if (settings.userApiKey) {
            const r2 = await callWithFallback(settings.provider, {
              system: reinforcedSystem,
              prompt: flatBuilt.user,
              temperature,
              apiKey: settings.userApiKey,
            });
            result = r2.text;
            provider = r2.provider;
          } else {
            const installId2 = await getInstallId();
            const r2 = await callProxy({
              mode: 'translate',
              text: req.text,
              targetLang,
              installId: installId2,
            });
            result = r2.text;
            provider = r2.provider;
            remainingQuota = r2.remainingQuota;
          }
        } catch {
          /* keep original result if retry fails */
        }
      }
    }

    await setEntry(cacheKey, result, store);
    return { ok: true, result, provider, remainingQuota, segments, separators };
  } catch (e: unknown) {
    const kind = (e as { kind?: string })?.kind;
    const usingOwnKey = !!settings.userApiKey;
    if (kind === 'auth') {
      return {
        ok: false,
        code: 'invalid_input',
        message: 'API key was rejected — check it in settings.',
      };
    }
    if (kind === 'rate_limit') {
      return {
        ok: false,
        code: 'quota_exhausted',
        message: usingOwnKey
          ? 'Provider rate limit hit (free-tier limits are short — try again in a minute, or paste a Groq key for higher throughput).'
          : 'Free quota exhausted — please add your own API key in settings.',
      };
    }
    if (kind === 'network') {
      return {
        ok: false,
        code: 'network_error',
        message: 'Network error — please retry',
      };
    }
    return {
      ok: false,
      code: 'provider_error',
      message: 'Translation failed — please try again',
    };
  }
}
