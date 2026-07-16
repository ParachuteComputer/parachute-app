import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { noteTitle } from "@/lib/note-title";
import { relativeTime } from "@/lib/time";
import type { Note } from "@/lib/vault/types";
import type { ReactNode } from "react";
import { Link } from "react-router";

// THE note row (W2-11 / F9) — one anatomy for every surface that lists notes:
//
//   dot/status · title · preview · time · chips
//
// The Recent timeline (RecentTimeline), the day drill-in (DayView), and the
// /notes list all consume this component, so the same note renders
// identically in every room — the room's WIDTH (reading `page-prose` vs
// managing `page`) is the only deliberate difference. Before this component
// existed, Home and /notes each hand-rolled a row and the two had drifted
// (no dot / no pinned star on Home; different containers) — the F9 finding.
//
// States follow the design system's row pattern (`.note-row` in index.css):
// transparent at rest, card-tint hover, grass-soft on press — never an
// underline or border-select.
//
// `pinnedTag` / `archivedTag` are the vault's role-tag names (from
// `useTagRoles` at the LIST level — resolving them once per list, not per
// row, keeps the settings query out of the row). `trailing` is an optional
// action slot outside the link (e.g. the untagged view's quick-tag control).
export function NoteRow({
  note,
  pinnedTag,
  archivedTag,
  trailing,
}: {
  note: Note;
  pinnedTag: string;
  archivedTag: string;
  trailing?: ReactNode;
}) {
  const title = noteTitle(note);
  // The mono path is metadata under the human title — but only when it says
  // something the title doesn't (a folder the leaf drops). Compare against the
  // extension-stripped path so a bare root file ("Aaron.md" vs title "Aaron")
  // doesn't render a redundant line that differs only by ".md".
  const showPath = !!note.path && note.path.replace(/\.md$/i, "") !== title;
  const stamp = note.updatedAt ?? note.createdAt;
  const isPinned = (note.tags ?? []).includes(pinnedTag);
  const isArchived = (note.tags ?? []).includes(archivedTag);
  return (
    <li className={isArchived ? "opacity-60 italic" : undefined}>
      <div className="note-row items-stretch">
        <span aria-hidden="true" className="note-dot" />
        <Link
          to={`/n/${encodeURIComponent(note.id)}`}
          className="focus-ring block min-h-11 min-w-0 flex-1 md:min-h-0"
        >
          <div className="flex items-baseline justify-between gap-4">
            <span className="flex min-w-0 items-baseline gap-1.5">
              {isPinned ? (
                <span className="shrink-0 text-accent" aria-label="pinned" title="pinned">
                  ★
                </span>
              ) : null}
              <span className="min-w-0 truncate text-sm font-medium text-fg">{title}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="text-xs text-fg-dim">{relativeTime(stamp)}</span>
              <ProvenanceBadge note={note} />
            </span>
          </div>
          {showPath ? <p className="mt-0.5 min-w-0 truncate note-id">{note.path}</p> : null}
          {note.preview ? (
            <p className="mt-1 truncate text-sm text-fg-muted">{note.preview}</p>
          ) : null}
          {note.tags && note.tags.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {note.tags.map((t) => (
                <span key={t} className="chip chip-tag max-w-full break-all">
                  #{t}
                </span>
              ))}
            </div>
          ) : null}
        </Link>
        {trailing ? <div className="shrink-0 self-center">{trailing}</div> : null}
      </div>
    </li>
  );
}

// The shared list container for NoteRows — the flat, hover-card list shape
// (prototype `.note` stack). Exported so Recent and /notes wrap rows the same
// way; day-group headers / section labels stay with the callers.
export function NoteRowList({
  children,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <ol aria-label={ariaLabel} className="flex flex-col gap-0.5">
      {children}
    </ol>
  );
}
