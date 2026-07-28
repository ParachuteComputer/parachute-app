// A dismissable chip — a filter/refinement dimension that's currently
// active, with its own × to clear it. Shared between the view surface's
// RefinementBar (query refinements layered onto a saved def) and the
// VaultSurface filter chips row (PR-B) — same shape, same affordance,
// wherever "here's what's narrowing this list, tap × to undo" is needed.
export function RefinementChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="chip chip-tag-active">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove refinement ${label}`}
        className="focus-ring ml-1 rounded-full"
      >
        ×
      </button>
    </span>
  );
}
