import { type ProvenanceAttribution, describeProvenance } from "@/lib/note-provenance";

// A quiet, factual attribution line — the ONE component both the note list
// row (NoteRow) and note detail (NoteView) mount so the same note carries
// the same story everywhere. See note-provenance.ts for the "factual only,
// never a human-vs-AI guess" rule this renders. Tolerates null/legacy
// records SILENTLY (renders nothing) — no "unknown" placeholder noise.
//
// `compact` — one short fragment ("via MCP"), for a list row sitting beside
// the relative-time stamp. `detail` — the fuller created/updated pair, for
// NoteView's metadata panel; only shows "updated" when it names a different
// principal than "created" (otherwise it's the same fact twice).
export function ProvenanceBadge({
  note,
  variant = "compact",
  className,
}: {
  note: ProvenanceAttribution;
  variant?: "compact" | "detail";
  className?: string;
}) {
  const parts = describeProvenance(note);
  if (!parts) return null;

  if (variant === "detail") {
    return (
      <div
        className={`space-y-0.5 text-xs text-fg-dim${className ? ` ${className}` : ""}`}
        title={parts.raw}
      >
        {parts.created ? <p>created {parts.created}</p> : null}
        {parts.updated && parts.differs ? <p>updated {parts.updated}</p> : null}
      </div>
    );
  }

  return (
    <span
      className={`shrink-0 text-xs text-fg-dim${className ? ` ${className}` : ""}`}
      title={parts.raw}
    >
      {parts.compact}
    </span>
  );
}
