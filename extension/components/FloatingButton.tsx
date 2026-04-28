export function FloatingButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="bcb-floating"
      onClick={onClick}
      aria-label="bcb-translater action"
    >
      🌐
    </button>
  );
}
