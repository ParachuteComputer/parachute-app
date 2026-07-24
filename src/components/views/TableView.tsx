import { FieldValueControl } from "@/components/views/FieldValueControl";
import { scalarValue } from "@/components/views/NoteFieldChips";
import { displayTitle } from "@/lib/note-title";
import type { TagRoles } from "@/lib/vault/tag-roles";
import type { Note } from "@/lib/vault/types";
import type { ResolvedField } from "@/lib/views/fields";
import { useViewFieldWrite } from "@/lib/views/write";
import type { QueryKey } from "@tanstack/react-query";
import { Link } from "react-router";

// The table kind (views train D) — the resolved field set AS COLUMNS: a title
// column (a navigating Link, same gesture as NoteRow/NoteCard titles) plus one
// column per resolved field (`resolveViewFields` — the same ordered set the
// chips band renders), rows = the view results. Every cell is click-to-edit:
// it renders the shipped `FieldValueControl` (enum menu / date picker /
// boolean toggle / text / number — no second editor), committing through the
// shared `useViewFieldWrite` hook (views train A: immediate optimistic write +
// microconfirmation toast + row flash — `data-note-id` on the <tr> is the
// flash target). An empty cell shows the control's quiet "—" affordance, the
// chips' existing pattern.
//
// Mobile: the wrapper scrolls HORIZONTALLY (the BoardView pattern) with a
// min-width table, so the page body never scrolls sideways. The title column
// is sticky against that scroll (opaque `bg-bg` so cells slide under it).
//
// Accepted v1 caveat (per the plan): FieldValueControl's popovers are
// absolute-in-relative inside this overflow container, so a right-edge cell's
// menu may clip at the container edge — the board already lives with this;
// no popover redesign here.
//
// Pinning surfaces WITHIN the rows (the star stays on the title) rather than
// as a separate band — like board/gallery/calendar, the caller hands us the
// pinned + rest notes already concatenated.
export function TableView({
  notes,
  roles,
  viewResultsKey,
  fields = [],
}: {
  notes: Note[];
  roles: TagRoles;
  /** The `useViewResults` cache key this table reads — the optimistic-write target. */
  viewResultsKey: QueryKey;
  /** The view's resolved fields (Part B) — one column each, in view order. */
  fields?: ResolvedField[];
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th
              scope="col"
              className="sticky left-0 z-[1] bg-bg py-2 pr-4 text-xs font-medium text-fg-dim"
            >
              Note
            </th>
            {fields.map((f) => (
              <th
                key={f.name}
                scope="col"
                className="whitespace-nowrap py-2 pr-4 text-xs font-medium text-fg-dim"
              >
                {f.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {notes.map((note) => (
            <TableRow
              key={note.id}
              note={note}
              fields={fields}
              roles={roles}
              viewResultsKey={viewResultsKey}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// One row per note, so it can own the note-bound `useViewFieldWrite` serving
// every cell (same shape as BoardNoteCard / the chips band: one hook per note).
function TableRow({
  note,
  fields,
  roles,
  viewResultsKey,
}: {
  note: Note;
  fields: ResolvedField[];
  roles: TagRoles;
  viewResultsKey: QueryKey;
}) {
  const { write, isPending } = useViewFieldWrite(note, viewResultsKey);
  const title = displayTitle(note);
  const isPinned = (note.tags ?? []).includes(roles.pinned);
  const isArchived = (note.tags ?? []).includes(roles.archived);

  return (
    // data-note-id: the microconfirmation flash's target (views train A) —
    // a cell write pulses this row via `flashNoteCard`.
    <tr
      data-note-id={note.id}
      className={`border-b border-border/60 ${isArchived ? "opacity-60 italic" : ""}`}
    >
      <th scope="row" className="sticky left-0 z-[1] bg-bg py-1.5 pr-4 text-left font-normal">
        <Link
          to={`/n/${encodeURIComponent(note.id)}`}
          className="focus-ring inline-flex max-w-[16rem] items-baseline gap-1.5 hover:text-accent"
        >
          {isPinned ? (
            <span className="shrink-0 text-accent" aria-label="pinned" title="pinned">
              ★
            </span>
          ) : null}
          <span
            className={
              title.kind === "timestamp"
                ? "min-w-0 truncate title-timestamp"
                : "min-w-0 truncate font-medium text-fg"
            }
          >
            {title.text}
          </span>
        </Link>
      </th>
      {fields.map((f) => (
        <td key={f.name} className="py-1 pr-4 align-middle">
          <FieldValueControl
            field={f.name}
            schema={f.schema}
            value={scalarValue(note.metadata?.[f.name])}
            disabled={isPending}
            includeClear
            onCommit={(value) => void write(f.name, value)}
          />
        </td>
      ))}
    </tr>
  );
}
