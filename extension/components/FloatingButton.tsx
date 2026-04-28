interface Props {
  onTranslate: () => void;
  onSummary: () => void;
}

export function FloatingButton({ onTranslate, onSummary }: Props) {
  return (
    <div className="bcb-floating-bar" role="group" aria-label="bcb-translater actions">
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
