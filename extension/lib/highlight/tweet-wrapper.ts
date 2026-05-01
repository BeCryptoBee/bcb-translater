import { buildProjection, locateInProjection, type Cover } from './projection';
import { normalizeForMatch } from '../segments-validate';

const SEG_CLASS = 'bcb-src-seg';
const ACTIVE_CLASS = 'bcb-src-seg--active';

/**
 * Tweet text is normalized by the injector before being sent to the LLM:
 * single \n (not bordered by \n) -> space, runs of whitespace collapsed.
 * We MUST replicate that normalization here so the segment src strings
 * (which match the normalized form) align against the live DOM text.
 *
 * NOTE: this is NOT length-preserving (whitespace collapse). We pass the
 * length-preserving subset (\n -> space) to the projection's normalize
 * callback; whitespace-collapse is handled by normalizeForMatch on both
 * sides of the indexOf comparison via locateInProjection.
 */
function tweetProjectionNormalize(s: string): string {
  // 1:1 length-preserving step: convert single \n to space.
  return s.replace(/(?<!\n)\n(?!\n)/g, ' ');
}

export function wrapTweetSegments(
  root: HTMLElement,
  segments: Array<{ src: string; tgt: string }>,
): void {
  // We must rebuild the projection AFTER each successful wrap because
  // splitText invalidates the existing entries (textNode lengths change,
  // siblings shift). Simpler and safe.
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;
    const proj = buildProjection(root, (s) =>
      // Layer the per-textnode normalize on top of full match-normalization
      // so the projection's text matches exactly what indexOf will compare
      // against. (normalizeForMatch is also length-preserving for everything
      // except ellipsis — sufficient for tweet text in practice.)
      normalizeForMatch(tweetProjectionNormalize(s)),
    );
    // Already-wrapped spans from prior segments are still in the projection;
    // skip past them by starting search from the previous match's end. We
    // approximate that by finding the FIRST occurrence of seg.src that's
    // inside an unwrapped Text node; if it's inside a span we already
    // wrapped, accept it anyway (the toggle still works since we use the
    // segment-index attribute).
    const found = locateInProjection(proj, seg.src, 0);
    if (!found) continue;
    for (const cover of found.covers) {
      wrapCover(cover, i);
    }
  }
}

function wrapCover(cover: Cover, segmentIndex: number): void {
  const { textNode, startOffset, endOffset } = cover;
  if (endOffset <= startOffset) return;
  const ownerDoc = textNode.ownerDocument;
  if (!ownerDoc) return;

  // Three-way split: before | middle | after. `middle` becomes the wrapped span.
  let middle: Text = textNode;
  if (startOffset > 0) {
    middle = textNode.splitText(startOffset);
  }
  const middleLen = endOffset - startOffset;
  if (middle.nodeValue && middle.nodeValue.length > middleLen) {
    middle.splitText(middleLen);
  }
  const span = ownerDoc.createElement('span');
  span.className = SEG_CLASS;
  span.setAttribute('data-segment-index', String(segmentIndex));
  middle.parentNode?.insertBefore(span, middle);
  span.appendChild(middle);
}

export function unwrapSegmentSpans(root: HTMLElement): void {
  const spans = root.querySelectorAll<HTMLSpanElement>(`.${SEG_CLASS}`);
  spans.forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    if (parent instanceof Element) parent.normalize();
  });
}

export function setActiveSegment(
  root: HTMLElement,
  index: number,
  active: boolean,
): void {
  const spans = root.querySelectorAll<HTMLSpanElement>(
    `.${SEG_CLASS}[data-segment-index="${index}"]`,
  );
  spans.forEach((s) => s.classList.toggle(ACTIVE_CLASS, active));
}

/**
 * Convenience: clear the active class from ALL wrapped segment spans inside
 * `root`. Used when the popup closes.
 */
export function clearAllActiveSegments(root: HTMLElement): void {
  root.querySelectorAll<HTMLSpanElement>(`.${ACTIVE_CLASS}`).forEach((el) => {
    el.classList.remove(ACTIVE_CLASS);
  });
}
