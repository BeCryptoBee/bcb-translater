import { checkAndIncrement } from './quota';
import { callWithFallback } from './llm-fallback';
import { buildTranslatePrompt, buildSummarizePrompt, TEMPERATURES } from './prompts';

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
      | { mode?: unknown; text?: unknown; targetLang?: unknown }
      | null
      | undefined;
    if (
      !b ||
      (b.mode !== 'translate' && b.mode !== 'summarize') ||
      typeof b.text !== 'string' ||
      typeof b.targetLang !== 'string'
    ) {
      return json(400, { error: 'invalid_input' });
    }
    if (b.text.length > 10_000) return json(400, { error: 'too_long' });

    const q = await checkAndIncrement(env.QUOTA_KV, installId);
    if (!q.allowed) return json(429, { error: 'quota_exhausted' });

    const built =
      b.mode === 'translate'
        ? buildTranslatePrompt({ text: b.text, targetLang: b.targetLang })
        : buildSummarizePrompt({ text: b.text, targetLang: b.targetLang });

    try {
      const r = await callWithFallback(
        'auto',
        { system: built.system, prompt: built.user, temperature: TEMPERATURES[b.mode] },
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
