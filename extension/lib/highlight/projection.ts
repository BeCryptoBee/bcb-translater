/**
 * Build a "projected text" view of a DOM region (HTMLElement or Range) by
 * concatenating all descendant Text nodes' values, optionally passing each
 * raw nodeValue through a 1:1-length normalize callback. The resulting map
 * lets callers translate offsets in the projected text back to per-Text
 * (textNode, nodeOffset) coordinates suitable for building Ranges.
 *
 * The normalize callback MUST be length-preserving (1 raw char -> 1 projected
 * char). If you need length-changing normalization, project the raw text and
 * apply the change post-hoc on the search side.
 */

export interface ProjectionEntry {
  textNode: Text;
  /** Start offset in projection.text (inclusive). */
  projectedStart: number;
  /** End offset in projection.text (exclusive). */
  projectedEnd: number;
}

export interface Projection {
  text: string;
  map: ProjectionEntry[];
  normalize?: (raw: string) => string;
}

export function buildProjection(
  root: HTMLElement | Range,
  normalize?: (raw: string) => string,
): Projection {
  const map: ProjectionEntry[] = [];
  let text = '';

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const tn = node as Text;
      const raw = tn.nodeValue ?? '';
      const projected = normalize ? normalize(raw) : raw;
      const start = text.length;
      text += projected;
      map.push({ textNode: tn, projectedStart: start, projectedEnd: text.length });
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return;
      for (const child of Array.from(node.childNodes)) visit(child);
    }
  };

  if (root instanceof Range) {
    // Walk only Text nodes that intersect the Range. Use the Range's owner
    // document so we don't get confused if `document` is shadowed.
    const ownerDoc = root.startContainer.ownerDocument ?? document;
    const walker = ownerDoc.createTreeWalker(
      root.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (n: Node) =>
          root.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
      },
    );
    let n: Node | null;
    while ((n = walker.nextNode())) visit(n);
  } else {
    for (const child of Array.from(root.childNodes)) visit(child);
  }

  return { text, map, normalize };
}

export interface Cover {
  textNode: Text;
  /** Offset within textNode.nodeValue. */
  startOffset: number;
  /** Offset within textNode.nodeValue. */
  endOffset: number;
}

/**
 * Locate `needle` inside `proj.text` starting from `fromProjectedOffset`.
 * Returns null when not found, or a list of per-text-node "covers" describing
 * which slice of which Text node the match occupies. A single match can span
 * multiple covers when it crosses inline element boundaries.
 */
export function locateInProjection(
  proj: Projection,
  needle: string,
  fromProjectedOffset: number,
): { startProjected: number; endProjected: number; covers: Cover[] } | null {
  const target = proj.normalize ? proj.normalize(needle) : needle;
  const at = proj.text.indexOf(target, fromProjectedOffset);
  if (at === -1) return null;
  const end = at + target.length;
  const covers: Cover[] = [];
  for (const entry of proj.map) {
    if (entry.projectedEnd <= at) continue;
    if (entry.projectedStart >= end) break;
    const segStart = Math.max(0, at - entry.projectedStart);
    const segEnd = Math.min(
      entry.projectedEnd - entry.projectedStart,
      end - entry.projectedStart,
    );
    if (segEnd > segStart) {
      covers.push({ textNode: entry.textNode, startOffset: segStart, endOffset: segEnd });
    }
  }
  return { startProjected: at, endProjected: end, covers };
}
