import { type FieldControlOption, FieldValueControl } from "@/components/views/FieldValueControl";
import { NoteCard } from "@/components/views/NoteCard";
import { NoteFieldChips } from "@/components/views/NoteFieldChips";
import { displayTitle } from "@/lib/note-title";
import { useTag } from "@/lib/vault/queries";
import type { TagRoles } from "@/lib/vault/tag-roles";
import type { Note } from "@/lib/vault/types";
import {
  type DropHandlerRegistry,
  useDropHandlerRegistry,
  useNoteDragSource,
  useNoteDropTarget,
} from "@/lib/views/dnd";
import type { ResolvedField } from "@/lib/views/fields";
import { type Lane, groupIntoLanes, resolveLaneOrder } from "@/lib/views/grouping";
import type { ViewFieldValue } from "@/lib/views/mutate";
import { useViewFieldWrite } from "@/lib/views/write";
import type { QueryKey } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useMemo } from "react";

// The board kind (Views Wave 2b, made EDITABLE in the view-experience wave) —
// Aaron's flagship: Projects laned by status. Result notes become COLUMNS keyed
// by the distinct values of the `laneBy` metadata field; a note missing that
// field lands in a trailing "No {field}" lane. Lane order honors the subject
// tag's schema `enum` when it has one (the authored order), else a built-in
// default, else alphabetical — see `groupIntoLanes`/`resolveLaneOrder` (now the
// shared grouping engine, view-experience wave).
//
// Tap-to-move: every card carries a "Move" control that writes the target
// lane's value onto the note and re-lanes the card optimistically. It's the
// ENUM case of the shared `FieldValueControl` (view-experience wave, Part A.2)
// — the board passes its target lanes as the control's options; the write goes
// through the shared `useViewFieldWrite` hook every kind shares (views train
// A: the `useViewFieldMutation` primitive + the microconfirmation — success
// toast echoing the tapped lane + card flash on resolve). Below the card
// body, `NoteFieldChips` shows + edits the tag's OTHER fields (Part C; the
// lane field itself is omitted, the Move control already owns it).
//
// Desktop drag (views train E): on fine-pointer devices every card is ALSO a
// drag source and every lane a drop zone — the same move, as a gesture. A
// drop routes through the registry (`src/lib/views/dnd.ts`) back to the
// dragged card's own `useViewFieldWrite`, so drag and the Move menu are one
// write path: same typed lane value / null-for-uncategorized contract, same
// toast + flash. Dropping a card on its own lane is a no-op (no write, no
// toast); touch devices see none of this — tap-to-move is unchanged.
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
  fields = [],
}: {
  notes: Note[];
  laneBy: string;
  /** The view's primary query tag — its schema supplies the lane enum order. */
  subjectTag?: string;
  roles: TagRoles;
  /** The `useViewResults` cache key this board reads — the optimistic-move target. */
  viewResultsKey: QueryKey;
  /** The view's resolved fields (Part B) — rendered as an editable chip band. */
  fields?: ResolvedField[];
}) {
  // Only mounts for board kind, so the schema fetch is board-scoped; a missing
  // tag/schema just falls the order back to the built-in/alphabetical path.
  const tag = useTag(subjectTag ?? null);
  const lanes = useMemo(
    () => groupIntoLanes(notes, laneBy, resolveLaneOrder(laneBy, tag.data?.fields)),
    [notes, laneBy, tag.data],
  );

  // Routes a drop (landing on a LANE) to the dragged card's own write hook.
  const dropRegistry = useDropHandlerRegistry<Lane>();

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex items-start gap-4">
        {lanes.map((lane) => (
          <BoardLane
            key={lane.uncategorized ? "__uncategorized__" : lane.key}
            lane={lane}
            dropRegistry={dropRegistry}
          >
            {lane.notes.map((note) => (
              <BoardNoteCard
                key={note.id}
                note={note}
                laneBy={laneBy}
                lanes={lanes}
                currentLane={lane}
                roles={roles}
                viewResultsKey={viewResultsKey}
                fields={fields}
                dropRegistry={dropRegistry}
              />
            ))}
          </BoardLane>
        ))}
      </div>
    </div>
  );
}

// A lane column — and, on fine-pointer devices, a drop zone for card drags.
// The drop handler only knows the dragged note's ID; the registry routes it to
// that card's own receive-drop handler (which owns the note-bound write).
function BoardLane({
  lane,
  dropRegistry,
  children,
}: {
  lane: Lane;
  dropRegistry: DropHandlerRegistry<Lane>;
  children: ReactNode;
}) {
  const onDropNote = useCallback(
    (noteId: string) => dropRegistry.dispatch(noteId, lane),
    [dropRegistry, lane],
  );
  const { isOver, targetProps } = useNoteDropTarget(onDropNote);

  return (
    <section
      aria-label={lane.label}
      className={`flex w-72 shrink-0 flex-col gap-2 ${
        // The drop affordance: a subtle coral outline around the hovered lane.
        // A state change, not motion — nothing for the reduced-motion gate.
        isOver ? "rounded-md outline-2 outline-offset-2 outline-accent/50" : ""
      }`}
      {...targetProps}
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
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

/** Two lanes are "the same" if both are the uncategorized lane, or both name the same value. */
function sameLane(a: Lane, b: Lane): boolean {
  if (a.uncategorized || b.uncategorized) return a.uncategorized && b.uncategorized;
  return a.key === b.key;
}

// The board's Move control styling — the small backdrop-blurred pill that sits
// in the card's top-right overlay slot (unchanged from the shipped move menu).
const MOVE_TRIGGER_CLASS =
  "focus-ring rounded-full border border-border bg-bg-soft/90 px-2 py-0.5 text-[0.6875rem] font-medium text-fg-dim backdrop-blur transition-colors hover:text-accent disabled:opacity-50";

// A board card + its tap-to-move control + the field-chips band. Rendered once
// per note, so it can own a note-bound `useViewFieldWrite` (a per-note hook
// can't live in BoardView's lane×note loop).
function BoardNoteCard({
  note,
  laneBy,
  lanes,
  currentLane,
  roles,
  viewResultsKey,
  fields,
  dropRegistry,
}: {
  note: Note;
  laneBy: string;
  lanes: Lane[];
  currentLane: Lane;
  roles: TagRoles;
  viewResultsKey: QueryKey;
  fields: ResolvedField[];
  dropRegistry: DropHandlerRegistry<Lane>;
}) {
  const { write, isPending } = useViewFieldWrite(note, viewResultsKey);

  // Every lane except the one the card is already in (moving there is a no-op).
  const targets = useMemo(
    () => lanes.filter((l) => !sameLane(l, currentLane)),
    [lanes, currentLane],
  );

  // Each target lane becomes a menu option carrying its ORIGINAL typed value
  // (number/boolean/string, or `null` for the uncategorized lane) — never the
  // stringified `key`, which an `indexed` integer/boolean field would reject.
  const moveOptions: FieldControlOption[] = useMemo(
    () =>
      targets.map((t) => ({
        value: t.value as ViewFieldValue,
        label: t.label,
        muted: t.uncategorized,
      })),
    [targets],
  );

  // The one write both gestures share — the lane's label rides into the
  // success toast ("✓ status → Done") so the confirmation echoes exactly what
  // was tapped/dropped, including the muted "No {field}" lane. The error
  // phrasing stays the shipped `Couldn't move "{title}"`.
  const moveTo = useCallback(
    async (value: ViewFieldValue, label: string | undefined) => {
      await write(laneBy, value, {
        valueLabel: label,
        errorPrefix: `Couldn't move "${displayTitle(note).text}"`,
      });
    },
    [write, laneBy, note],
  );

  const handleMove = async (value: ViewFieldValue) => {
    const target = moveOptions.find((o) => o.value === value);
    await moveTo(value, target?.label);
  };

  // Desktop drag (train E): the card is a drag source; a drop on some lane
  // dispatches back here, where the note-bound write lives. Same-lane drops
  // are a deliberate no-op (no write, no toast) — nothing moved.
  const drag = useNoteDragSource(note.id);
  const receiveLaneDrop = useCallback(
    (lane: Lane) => {
      if (isPending || sameLane(lane, currentLane)) return;
      void moveTo(lane.value as ViewFieldValue, lane.label);
    },
    [isPending, currentLane, moveTo],
  );
  useEffect(
    () => dropRegistry.register(note.id, receiveLaneDrop),
    [dropRegistry, note.id, receiveLaneDrop],
  );

  return (
    <NoteCard
      note={note}
      pinnedTag={roles.pinned}
      archivedTag={roles.archived}
      drag={drag}
      overlay={
        // Nowhere to move to (the only lane on the board) — no affordance.
        targets.length > 0 ? (
          <FieldValueControl
            field={laneBy}
            value={currentLane.value as ViewFieldValue}
            options={moveOptions}
            disabled={isPending}
            onCommit={(value) => void handleMove(value)}
            trigger={{
              label: "Move",
              ariaLabel: `Move to another ${laneBy}`,
              className: MOVE_TRIGGER_CLASS,
            }}
          />
        ) : null
      }
      footer={
        fields.length > 0 ? (
          <NoteFieldChips
            note={note}
            fields={fields}
            viewResultsKey={viewResultsKey}
            omit={[laneBy]}
          />
        ) : null
      }
    />
  );
}
