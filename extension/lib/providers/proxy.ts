import type { Mode } from '../messages';

export interface ProxyInput {
  mode: Mode;
  text: string;
  targetLang: string;
  installId: string;
}

export interface ProxyResult {
  text: string;
  provider: 'gemini' | 'groq';
  remainingQuota: number;
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
      body: JSON.stringify({ mode: input.mode, text: input.text, targetLang: input.targetLang }),
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
  };
  if (typeof body.result !== 'string') throw { kind: 'malformed' };
  if (body.provider !== 'gemini' && body.provider !== 'groq') throw { kind: 'malformed' };
  if (typeof body.remainingQuota !== 'number') throw { kind: 'malformed' };
  return { text: body.result, provider: body.provider, remainingQuota: body.remainingQuota };
}
