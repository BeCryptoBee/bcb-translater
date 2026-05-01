interface Props {
  onTranslate: () => void;
  onSummary: () => void;
  /** CSS color value (the user's chosen accent). Applied as the bar's solid
   *  background so the buttons always have a stable, high-contrast surface
   *  regardless of the host page colors. Text stays black via shadow.css. */
  color?: string | null;
}

export function FloatingButton({ onTranslate, onSummary, color }: Props) {
  // Make the accent slightly translucent so the page reads through; the
  // backdrop-filter blur in shadow.css then frosts whatever is behind us.
  const style = color
    ? { background: `color-mix(in srgb, ${color} 88%, transparent)` }
    : undefined;
  return (
    <div
      className="bcb-floating-bar"
      role="group"
      aria-label="BCB Translator actions"
      style={style}
    >
      <button
        type="button"
        className="bcb-floating-btn"
        onClick={(e) => {
          console.log('[BCB] FloatingButton T clicked', { defaultPrevented: e.defaultPrevented });
          onTranslate();
        }}
        aria-label="Translate selection"
        title="Translate"
      >
        T
      </button>
      <button
        type="button"
        className="bcb-floating-btn"
        onClick={(e) => {
          console.log('[BCB] FloatingButton S clicked', { defaultPrevented: e.defaultPrevented });
          onSummary();
        }}
        aria-label="Summarize selection"
        title="Summary"
      >
        S
      </button>
    </div>
  );
}
