import type { Mode } from '../messages';

export interface ProxyInput {
  mode: Mode;
  text: string;
  targetLang: string;
  installId: string;
  segmented?: boolean;
}

export interface ProxyResult {
  text: string;
  provider: 'gemini' | 'groq';
  remainingQuota: number;
  segments?: Array<{ src: string; tgt: string }>;
  separators?: string[];
}

// will be replaced at build/deploy
const PROXY_URL = '__PROXY_URL__';

export async function callProxy(
  input: ProxyInput,
  fetchImpl: typeof fetch = fetch,
): Promise<ProxyResult> {
  let res: Response;
  try {
    res = await fetchImpl(PROXY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-install-id': input.installId },
      body: JSON.stringify({
        mode: input.mode,
        text: input.text,
        targetLang: input.targetLang,
        ...(input.segmented ? { segmented: true } : {}),
      }),
    });
  } catch {
    throw { kind: 'network' };
  }
  if (res.status === 429) throw { kind: 'rate_limit' };
  if (!res.ok) throw { kind: 'server', status: res.status };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw { kind: 'malformed' };
  }
  const body = json as {
    result?: unknown;
    provider?: 'gemini' | 'groq';
    remainingQuota?: number;
    segments?: unknown;
    separators?: unknown;
  };
  if (typeof body.result !== 'string') throw { kind: 'malformed' };
  if (body.provider !== 'gemini' && body.provider !== 'groq') throw { kind: 'malformed' };
  if (typeof body.remainingQuota !== 'number') throw { kind: 'malformed' };

  let segments: Array<{ src: string; tgt: string }> | undefined;
  let separators: string[] | undefined;
  if (body.segments !== undefined) {
    if (!Array.isArray(body.segments)) throw { kind: 'malformed' };
    // Lightweight shape check — full validation happened server-side.
    segments = body.segments as Array<{ src: string; tgt: string }>;
    if (Array.isArray(body.separators)) {
      separators = body.separators as string[];
    }
  }

  return {
    text: body.result,
    provider: body.provider,
    remainingQuota: body.remainingQuota,
    segments,
    separators,
  };
}
