// MIRRORED FILE: keep extension/lib/segments-validate.ts and
// worker/src/segments-validate.ts in sync. Pure module, no deps.

export interface Segment {
  src: string;
  tgt: string;
}

export type ValidationResult =
  | { ok: true; derivedFlat: string; segments: Segment[]; separators: string[] }
  | { ok: false; reason: string };

// `separators` has length equal to segments.length:
//   separators[0] = leading text in source BEFORE the first segment src match
//                   (usually "" — source starts with src[0])
//   separators[i] for i>0 = text in source between match-end of segment i-1
//                           and match-start of segment i

const CURLY_DOUBLE_RE = /[“”„‟″‶]/g;
const CURLY_SINGLE_RE = /[‘’‚‛′‵]/g;
const UNICODE_SPACE_RE = /[  -​  　]/g;
const ELLIPSIS_RE = /…/g;

export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFC')
    .replace(CURLY_DOUBLE_RE, '"')
    .replace(CURLY_SINGLE_RE, "'")
    .replace(UNICODE_SPACE_RE, ' ')
    .replace(ELLIPSIS_RE, '...');
}

export function validateSegments(
  segments: unknown,
  sourceText: string,
): ValidationResult {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { ok: false, reason: 'empty_or_not_array' };
  }
  const cleaned: Segment[] = [];
  for (const s of segments) {
    if (
      !s ||
      typeof s !== 'object' ||
      typeof (s as Segment).src !== 'string' ||
      typeof (s as Segment).tgt !== 'string'
    ) {
      return { ok: false, reason: 'bad_segment_shape' };
    }
    cleaned.push({ src: (s as Segment).src, tgt: (s as Segment).tgt });
  }

  const normSource = normalizeForMatch(sourceText);
  const { normToRaw } = buildIndexMap(sourceText);
  let rawCursor = 0;
  let normCursor = 0;
  const parts: string[] = [];
  const separators: string[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const seg = cleaned[i]!;
    const normSrc = normalizeForMatch(seg.src);
    const matchAt = normSource.indexOf(normSrc, normCursor);
    if (matchAt === -1) return { ok: false, reason: `src_not_found_${i}` };
    const rawMatchStart = normToRaw[matchAt];
    const rawMatchEnd = normToRaw[matchAt + normSrc.length];
    if (rawMatchStart === undefined || rawMatchEnd === undefined) {
      return { ok: false, reason: `index_map_${i}` };
    }
    const sep = sourceText.slice(rawCursor, rawMatchStart);
    separators.push(sep);
    if (i > 0) parts.push(sep);
    parts.push(seg.tgt);
    rawCursor = rawMatchEnd;
    normCursor = matchAt + normSrc.length;
  }

  return { ok: true, derivedFlat: parts.join(''), segments: cleaned, separators };
}

/**
 * Build an index map from normalized-string positions to raw-string positions.
 * Walk the raw source char-by-char; for each char, record the current
 * normalized cursor (so callers can translate back). Single Unicode space
 * variants and curly quotes are 1:1; ellipsis (…) is 1->3 (one raw
 * char normalizes to three "..."), so the raw cursor advances 1 while the
 * normalized cursor advances 3. We FILL EVERY normalized index (including
 * positions inside a 1->3 expansion) so that any normalized match offset
 * — even one that lands inside an ellipsis expansion in pathological cases —
 * translates back to a defined raw position.
 */
function buildIndexMap(raw: string): { normToRaw: number[] } {
  const map: number[] = [];
  let normPos = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const expand = ch === '…' ? 3 : 1;
    for (let k = 0; k < expand; k++) {
      if (map[normPos + k] === undefined) map[normPos + k] = i;
    }
    normPos += expand;
  }
  map[normPos] = raw.length;
  return { normToRaw: map };
}
