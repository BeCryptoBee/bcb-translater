interface Props {
  onTranslate: () => void;
  onSummary: () => void;
  /** CSS color value taken from the selection's surrounding text. When set,
   *  the pill buttons inherit this color via `style.color` so they blend with
   *  the page typography. Falls back to the shadow.css default otherwise. */
  color?: string | null;
}

export function FloatingButton({ onTranslate, onSummary, color }: Props) {
  const style = color ? { color } : undefined;
  return (
    <div
      className="bcb-floating-bar"
      role="group"
      aria-label="bcb-translater actions"
      style={style}
    >
      <button
        type="button"
        className="bcb-floating-btn"
        onClick={onTranslate}
        aria-label="Translate selection"
      >
        Translate
      </button>
      <button
        type="button"
        className="bcb-floating-btn"
        onClick={onSummary}
        aria-label="Summarize selection"
      >
        Summary
      </button>
    </div>
  );
}
