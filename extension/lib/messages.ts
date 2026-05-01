export type Mode = 'translate' | 'summarize';

export interface ProcessRequest {
  type: 'process';
  mode: Mode;
  text: string;
  sourceLang?: string;
  targetLang: string;
  smartDirection?: boolean;
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
      /**
       * Sentence-aligned segments. Set ONLY when Translation Highlight is
       * enabled and the segmented pipeline succeeded. Always set together
       * with `separators` (length === segments.length).
       */
      segments?: Array<{ src: string; tgt: string }>;
      /**
       * Inter-segment whitespace from the source text. `separators[0]` is the
       * leading text before segment 0 (usually ""); `separators[i]` for i>0
       * is the text between segment i-1's end and segment i's start.
       */
      separators?: string[];
    }
  | { ok: false; code: ErrorCode; message: string };

export function isProcessRequest(x: unknown): x is ProcessRequest {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (
    o.type !== 'process' ||
    (o.mode !== 'translate' && o.mode !== 'summarize') ||
    typeof o.text !== 'string' ||
    typeof o.targetLang !== 'string'
  ) {
    return false;
  }
  if (o.smartDirection !== undefined && typeof o.smartDirection !== 'boolean') return false;
  return true;
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
