import { NoteCard } from "@/components/views/NoteCard";
import { displayTitle } from "@/lib/note-title";
import { useToastStore } from "@/lib/toast/store";
import { useTag } from "@/lib/vault/queries";
import type { TagRoles } from "@/lib/vault/tag-roles";
import type { Note } from "@/lib/vault/types";
import { type Lane, groupIntoLanes, resolveLaneOrder } from "@/lib/views/grouping";
import { type ViewFieldValue, useViewFieldMutation } from "@/lib/views/mutate";
import type { QueryKey } from "@tanstack/react-query";
import { useMemo, useState } from "react";

// The board kind (Views Wave 2b, made EDITABLE in the view-experience wave) —
// Aaron's flagship: Projects laned by status. Result notes become COLUMNS keyed
// by the distinct values of the `laneBy` metadata field; a note missing that
// field lands in a trailing "No {field}" lane. Lane order honors the subject
// tag's schema `enum` when it has one (the authored order), else a built-in
// default, else alphabetical — see `groupIntoLanes`/`resolveLaneOrder`. Lanes
// scroll horizontally on overflow.
//
// Tap-to-move (slice 1): every card carries a "Move to…" menu that writes the
// target lane's `laneBy` value onto the note and re-lanes the card optimistically
// (`useViewFieldMutation`). This is the mobile-first, no-dependency version;
// real drag-and-drop is the next slice.
//
// Pinning surfaces WITHIN a lane (the card keeps its star) rather than as a
// separate band — a board's value is the columns, so the caller hands us the
// pinned + rest notes already concatenated.
export function BoardView({
  notes,
  laneBy,
  subjectTag,
  roles,
  viewResultsKey,
}: {
  notes: Note[];
  laneBy: string;
  /** The view's primary query tag — its schema supplies the lane enum order. */
  subjectTag?: string;
  roles: TagRoles;
  /** The `useViewResults` cache key this board reads — the optimistic-move target. */
  viewResultsKey: QueryKey;
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
                <BoardNoteCard
                  key={note.id}
                  note={note}
                  laneBy={laneBy}
                  lanes={lanes}
                  currentLane={lane}
                  roles={roles}
                  viewResultsKey={viewResultsKey}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Two lanes are "the same" if both are the uncategorized lane, or both name the same value. */
function sameLane(a: Lane, b: Lane): boolean {
  if (a.uncategorized || b.uncategorized) return a.uncategorized && b.uncategorized;
  return a.key === b.key;
}

// A board card + its tap-to-move menu. Rendered once per note, so it can own a
// note-bound `useViewFieldMutation` (a per-note hook can't live in BoardView's
// lane×note loop).
function BoardNoteCard({
  note,
  laneBy,
  lanes,
  currentLane,
  roles,
  viewResultsKey,
}: {
  note: Note;
  laneBy: string;
  lanes: Lane[];
  currentLane: Lane;
  roles: TagRoles;
  viewResultsKey: QueryKey;
}) {
  const pushToast = useToastStore((s) => s.push);
  const { move, isPending } = useViewFieldMutation(note.id, viewResultsKey);

  // Every lane except the one the card is already in (moving there is a no-op).
  const targets = useMemo(
    () => lanes.filter((l) => !sameLane(l, currentLane)),
    [lanes, currentLane],
  );

  const handleMove = async (target: Lane) => {
    try {
      // `target.value` is the lane's ORIGINAL typed value (number/boolean/string,
      // or `null` for the uncategorized lane) — never the stringified `key`.
      await move(laneBy, target.value as ViewFieldValue, note.updatedAt);
    } catch (err) {
      pushToast(
        `Couldn't move "${displayTitle(note).text}": ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error",
      );
    }
  };

  return (
    <NoteCard
      note={note}
      pinnedTag={roles.pinned}
      archivedTag={roles.archived}
      overlay={
        <MoveMenu field={laneBy} targets={targets} disabled={isPending} onMove={handleMove} />
      }
    />
  );
}

// The "Move to…" affordance: a small button on the card that opens a menu of the
// OTHER lanes. Picking one calls `onMove`. A full-screen backdrop closes it on
// an outside tap. Lives outside the card's anchor (via NoteCard's `overlay`), so
// the button doesn't nest in — or navigate — the card link.
function MoveMenu({
  field,
  targets,
  disabled,
  onMove,
}: {
  field: string;
  targets: Lane[];
  disabled: boolean;
  onMove: (target: Lane) => void;
}) {
  const [open, setOpen] = useState(false);

  // Nowhere to move to (the only lane on the board) — no affordance.
  if (targets.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Move to another ${field}`}
        title="Move to…"
        onClick={() => setOpen((o) => !o)}
        className="focus-ring rounded-full border border-border bg-bg-soft/90 px-2 py-0.5 text-[0.6875rem] font-medium text-fg-dim backdrop-blur transition-colors hover:text-accent disabled:opacity-50"
      >
        Move
      </button>
      {open ? (
        <>
          {/* Outside-tap backdrop — closes the menu, invisible. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            aria-label="Move to…"
            className="card absolute right-0 z-20 mt-1 flex min-w-[10rem] flex-col gap-0.5 p-1 shadow-lg"
          >
            {targets.map((target) => (
              <button
                key={target.uncategorized ? "__uncategorized__" : target.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onMove(target);
                }}
                className={`focus-ring rounded px-2 py-1.5 text-left text-sm hover:bg-bg-soft ${
                  target.uncategorized ? "text-fg-dim" : "text-fg"
                }`}
              >
                {target.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
