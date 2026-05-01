import { checkAndIncrement } from './quota';
import { callWithFallback } from './llm-fallback';
import {
  buildTranslatePrompt,
  buildSummarizePrompt,
  buildBatchTranslatePrompt,
  presplitForBatch,
  TEMPERATURES,
  SEGMENTED_TEMPERATURE,
  BATCH_RESPONSE_SCHEMA,
} from './prompts';
import { validateSegments } from './segments-validate';

export interface Env {
  QUOTA_KV: KVNamespace;
  GEMINI_API_KEY: string;
  GROQ_API_KEY: string;
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-install-id',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/v1/process') {
      return json(404, { error: 'not_found' });
    }

    const installId = request.headers.get('x-install-id');
    if (!installId) return json(400, { error: 'missing_install_id' });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'invalid_json' });
    }
    const b = body as
      | { mode?: unknown; text?: unknown; targetLang?: unknown; segmented?: unknown }
      | null
      | undefined;
    if (
      !b ||
      (b.mode !== 'translate' && b.mode !== 'summarize') ||
      typeof b.text !== 'string' ||
      typeof b.targetLang !== 'string' ||
      (b.segmented !== undefined && typeof b.segmented !== 'boolean')
    ) {
      return json(400, { error: 'invalid_input' });
    }
    if (b.text.length > 10_000) return json(400, { error: 'too_long' });

    const q = await checkAndIncrement(env.QUOTA_KV, installId);
    if (!q.allowed) return json(429, { error: 'quota_exhausted' });

    const segmented = b.segmented === true && b.mode === 'translate';

    try {
      if (segmented) {
        const lines = presplitForBatch(b.text);
        if (lines.length > 0) {
          const batch = buildBatchTranslatePrompt({ lines, targetLang: b.targetLang });
          const r = await callWithFallback(
            'auto',
            {
              system: batch.system,
              prompt: batch.user,
              temperature: SEGMENTED_TEMPERATURE,
              jsonMode: { schema: BATCH_RESPONSE_SCHEMA as object },
            },
            { gemini: env.GEMINI_API_KEY, groq: env.GROQ_API_KEY },
          );
          let parsed: unknown;
          try { parsed = JSON.parse(r.text); } catch { parsed = null; }
          const tgts =
            parsed && typeof parsed === 'object' && Array.isArray((parsed as { translations?: unknown }).translations)
              ? ((parsed as { translations: unknown[] }).translations as unknown[])
              : null;
          if (tgts && tgts.length === lines.length && tgts.every((x) => typeof x === 'string')) {
            const candidate = lines.map((src, i) => ({ src, tgt: tgts[i] as string }));
            const v = validateSegments(candidate, b.text);
            if (v.ok) {
              return json(200, {
                result: v.derivedFlat,
                segments: v.segments,
                separators: v.separators,
                provider: r.provider,
                remainingQuota: q.remaining,
              });
            }
          }
        }
        // Pre-split / batch failed somewhere — internal flat retry. Quota
        // counts once at the user-facing boundary even though we made
        // multiple upstream calls.
        const flat = buildTranslatePrompt({ text: b.text, targetLang: b.targetLang });
        const r2 = await callWithFallback(
          'auto',
          { system: flat.system, prompt: flat.user, temperature: TEMPERATURES[b.mode] },
          { gemini: env.GEMINI_API_KEY, groq: env.GROQ_API_KEY },
        );
        return json(200, {
          result: r2.text,
          provider: r2.provider,
          remainingQuota: q.remaining,
        });
      }

      // Non-segmented (flat) path — translate or summarize.
      const built =
        b.mode === 'translate'
          ? buildTranslatePrompt({ text: b.text, targetLang: b.targetLang })
          : buildSummarizePrompt({ text: b.text, targetLang: b.targetLang });
      const r = await callWithFallback(
        'auto',
        {
          system: built.system,
          prompt: built.user,
          temperature: TEMPERATURES[b.mode],
        },
        { gemini: env.GEMINI_API_KEY, groq: env.GROQ_API_KEY },
      );
      return json(200, { result: r.text, provider: r.provider, remainingQuota: q.remaining });
    } catch {
      return json(502, { error: 'provider_error' });
    }
  },
} satisfies ExportedHandler<Env>;

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  });
}
