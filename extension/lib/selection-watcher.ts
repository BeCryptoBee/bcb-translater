export interface SelectionInfo {
  text: string;
  rect: DOMRect;
}

/**
 * Extract the visible text of a Selection with line breaks between
 * block-level elements preserved.
 *
 * Why not `Selection.toString()`: the native method concatenates text-node
 * data and does NOT insert "\n" between inline-block elements. X.com (and
 * many sites) renders each line of a multi-line list as its own
 * `display:block`/`display:inline-block` span, so `toString()` returns one
 * collapsed string. Downstream segmentation then has nothing to split on.
 *
 * `innerText` IS CSS-aware — it emits "\n" between block boundaries — but
 * it only works on a Node, not a Range. We clone the range's contents into
 * an offscreen div, then read its `innerText`.
 */
export function getSelectionText(sel: Selection): string {
  if (sel.rangeCount === 0 || sel.isCollapsed) return '';
  const range = sel.getRangeAt(0);
  const fallback = sel.toString();
  try {
    const ownerDoc = range.startContainer.ownerDocument ?? document;
    const div = ownerDoc.createElement('div');
    div.style.cssText =
      'position:absolute;left:-99999px;top:-99999px;white-space:pre-wrap;';
    div.appendChild(range.cloneContents());

    // Twemoji & friends: X.com (and many sites) render emoji as
    // <img alt="🧠" src="twemoji.svg">. innerText/textContent ignore the
    // alt attribute, so emoji evaporate from the captured text. Replace
    // every emoji-image with a Text node carrying its alt BEFORE reading
    // innerText so the original glyphs survive into the LLM prompt.
    const imgs = div.querySelectorAll('img[alt]');
    imgs.forEach((img) => {
      const alt = (img as HTMLImageElement).alt;
      if (alt) img.replaceWith(ownerDoc.createTextNode(alt));
    });

    ownerDoc.body.appendChild(div);
    const text = div.innerText;
    ownerDoc.body.removeChild(div);
    return text.length >= fallback.length ? text : fallback;
  } catch {
    return fallback;
  }
}

export function watchSelection(
  callback: (selection: SelectionInfo | null) => void,
): () => void {
  const handler = () => {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      callback(null);
      return;
    }
    const text = getSelectionText(sel);
    if (text.trim().length < 3) {
      callback(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    callback({ text, rect });
  };
  document.addEventListener('selectionchange', handler);
  return () => document.removeEventListener('selectionchange', handler);
}
