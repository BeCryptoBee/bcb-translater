import type { ProcessRequest, ProcessResponse } from './messages';
import { getSettings } from './storage';
import { getInstallId } from './install-id';
import { getEntry, setEntry, getCacheKey, type StorageAdapter } from './cache';
import { buildTranslatePrompt, buildSummarizePrompt, TEMPERATURES } from './prompts';
import { callWithFallback } from './llm-fallback';
import { callProxy } from './providers/proxy';
import { incrementLocalQuota } from './quota';

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
  const targetLang = req.targetLang || settings.targetLang;
  const cacheKey = await getCacheKey({ mode: req.mode, text: req.text, targetLang });
  const cached = await getEntry(cacheKey, store);
  if (cached) {
    return { ok: true, result: cached, provider: 'gemini', cached: true };
  }

  const prompt =
    req.mode === 'translate'
      ? buildTranslatePrompt({ text: req.text, targetLang })
      : buildSummarizePrompt({ text: req.text, targetLang });
  const temperature = TEMPERATURES[req.mode];

  try {
    let result: string;
    let provider: 'gemini' | 'groq';
    let remainingQuota: number | undefined;

    if (settings.userApiKey) {
      const r = await callWithFallback(settings.provider, {
        prompt,
        temperature,
        apiKey: settings.userApiKey,
      });
      result = r.text;
      provider = r.provider;
    } else {
      const installId = await getInstallId();
      const r = await callProxy({ mode: req.mode, text: req.text, targetLang, installId });
      result = r.text;
      provider = r.provider;
      remainingQuota = r.remainingQuota;
      await incrementLocalQuota();
    }

    // Structure-preservation safeguard for translation only (one retry max)
    if (req.mode === 'translate') {
      const srcN = (req.text.match(/\n/g) ?? []).length;
      const dstN = (result.match(/\n/g) ?? []).length;
      if (srcN >= 2 && dstN < srcN / 2) {
        const reinforced =
          prompt +
          '\n\nREMINDER: The source has line breaks. The output MUST contain the same number of line breaks in the same positions.';
        try {
          if (settings.userApiKey) {
            const r2 = await callWithFallback(settings.provider, {
              prompt: reinforced,
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
    return { ok: true, result, provider, remainingQuota };
  } catch (e: unknown) {
    const kind = (e as { kind?: string })?.kind;
    if (kind === 'rate_limit') {
      return {
        ok: false,
        code: 'quota_exhausted',
        message: 'Free quota exhausted — please add your own API key in settings',
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
