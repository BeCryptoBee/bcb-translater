export type Mode = 'translate' | 'summarize';

export interface ProcessRequest {
  type: 'process';
  mode: Mode;
  text: string;
  sourceLang?: string;
  targetLang: string;
}

export type ErrorCode =
  | 'quota_exhausted'
  | 'network_error'
  | 'provider_error'
  | 'invalid_input'
  | 'too_long'
  | 'unknown';

export type ProcessResponse =
  | {
      ok: true;
      result: string;
      provider: 'gemini' | 'groq';
      remainingQuota?: number;
      cached?: boolean;
    }
  | { ok: false; code: ErrorCode; message: string };

export function isProcessRequest(x: unknown): x is ProcessRequest {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    o.type === 'process' &&
    (o.mode === 'translate' || o.mode === 'summarize') &&
    typeof o.text === 'string' &&
    typeof o.targetLang === 'string'
  );
}

export function isProcessResponse(x: unknown): x is ProcessResponse {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (o.ok === true) {
    return typeof o.result === 'string' && (o.provider === 'gemini' || o.provider === 'groq');
  }
  if (o.ok === false) {
    return typeof o.code === 'string' && typeof o.message === 'string';
  }
  return false;
}
