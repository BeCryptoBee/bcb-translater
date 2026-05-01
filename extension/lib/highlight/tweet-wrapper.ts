import { buildProjection, locateInProjection, type Cover } from './projection';

const SEG_CLASS = 'bcb-src-seg';
const ACTIVE_CLASS = 'bcb-src-seg--active';

/**
 * Tweet text is normalized by the injector before being sent to the LLM:
 * single \n (not bordered by \n) -> space, runs of whitespace collapsed.
 * The whitespace-collapse step is NOT length-preserving and would violate
 * the projection contract, so we apply ONLY the length-preserving
 * \n -> space step here. In practice that's sufficient — X.com tweet
 * rendering rarely produces internal whitespace runs.
 */
function tweetProjectionNormalize(s: string): string {
  return s.replace(/(?<!\n)\n(?!\n)/g, ' ');
}

export function wrapTweetSegments(
  root: HTMLElement,
  segments: Array<{ src: string; tgt: string }>,
): void {
  // We rebuild the projection AFTER each successful wrap because splitText
  // invalidates the existing entries (textNode lengths change, siblings
  // shift). Track the running projected-offset cursor so subsequent searches
  // skip past already-wrapped territory — critical for short or repeated
  // src strings that would otherwise re-locate to the same position.
  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;
    const proj = buildProjection(root, tweetProjectionNormalize);
    const found = locateInProjection(proj, seg.src, cursor);
    if (!found) {
      // Not found from the current cursor — try once from 0 in case the
      // wrap of an earlier segment shifted offsets unpredictably.
      const retry = locateInProjection(proj, seg.src, 0);
      if (!retry) continue;
      cursor = retry.endProjected;
      for (const cover of retry.covers) wrapCover(cover, i);
      continue;
    }
    cursor = found.endProjected;
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
