import { NoteCard } from "@/components/views/NoteCard";
import { useTag } from "@/lib/vault/queries";
import type { TagRoles } from "@/lib/vault/tag-roles";
import type { Note } from "@/lib/vault/types";
import { groupIntoLanes, resolveLaneOrder } from "@/lib/views/grouping";
import { useMemo } from "react";

// The board kind (Views Wave 2b) — Aaron's flagship: Projects laned by status.
// Result notes become COLUMNS keyed by the distinct values of the `laneBy`
// metadata field; a note missing that field lands in a trailing "No {field}"
// lane. Lane order honors the subject tag's schema `enum` when it has one
// (the authored order), else a built-in default, else alphabetical — see
// `groupIntoLanes`/`resolveLaneOrder`. Lanes scroll horizontally on overflow.
//
// Pinning surfaces WITHIN a lane (the card keeps its star) rather than as a
// separate band — a board's value is the columns, so the caller hands us the
// pinned + rest notes already concatenated.
export function BoardView({
  notes,
  laneBy,
  subjectTag,
  roles,
}: {
  notes: Note[];
  laneBy: string;
  /** The view's primary query tag — its schema supplies the lane enum order. */
  subjectTag?: string;
  roles: TagRoles;
}) {
  // Only mounts for board kind, so the schema fetch is board-scoped; a missing
  // tag/schema just falls the order back to the built-in/alphabetical path.
  const tag = useTag(subjectTag ?? null);
  const lanes = useMemo(
    () => groupIntoLanes(notes, laneBy, resolveLaneOrder(laneBy, tag.data?.fields)),
    [notes, laneBy, tag.data],
  );

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex items-start gap-4">
        {lanes.map((lane) => (
          <section
            key={lane.uncategorized ? "__uncategorized__" : lane.key}
            aria-label={lane.label}
            className="flex w-72 shrink-0 flex-col gap-2"
          >
            <header className="flex items-baseline justify-between gap-2 border-b border-border pb-2">
              <span
                className={`min-w-0 truncate text-sm font-medium ${
                  lane.uncategorized ? "text-fg-dim" : "text-fg"
                }`}
              >
                {lane.label}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-fg-dim">{lane.notes.length}</span>
            </header>
            <div className="flex flex-col gap-2">
              {lane.notes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  pinnedTag={roles.pinned}
                  archivedTag={roles.archived}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
