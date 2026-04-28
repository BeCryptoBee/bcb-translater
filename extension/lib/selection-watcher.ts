export interface SelectionInfo {
  text: string;
  rect: DOMRect;
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
    const text = sel.toString();
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
