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
// is sticky against that scroll — its cells carry an OPAQUE background so
// data cells slide under it, and that background must match the containing
// card (`bg-card` in the body, `bg-bg-soft` in the header band; polish V5) or
// rows seam visibly under the sticky column when scrolled.
//
// Containment (polish V5): the table sits in a raised card — rounded border +
// resting shadow around the scroll container (the prototype's `.tbl-wrap`),
// with a soft uppercase header band and hairline row separators; the last row
// runs borderless into the card's own edge. Row hover tints with
// `bg-bg-soft/60`; the sticky title cell mirrors that tint via an overlay
// pseudo-element (composited over its opaque `bg-card`, so it matches the
// row in BOTH themes without going transparent under the scroll).
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
    // The card wrapper AROUND the scroll container — `overflow-hidden` clips
    // the header band's soft background into the rounded corners.
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th
                scope="col"
                className="sticky left-0 z-[1] bg-bg-soft px-3 py-2 text-2xs font-semibold uppercase tracking-[0.08em] text-fg-dim"
              >
                Note
              </th>
              {fields.map((f) => (
                <th
                  key={f.name}
                  scope="col"
                  // Number columns read right-aligned (digits line up down the
                  // column — polish V1); the header follows its cells.
                  className={`whitespace-nowrap bg-bg-soft px-3 py-2 text-2xs font-semibold uppercase tracking-[0.08em] text-fg-dim ${
                    f.schema.type === "number" ? "text-right" : ""
                  }`}
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
      className={`group border-b border-border-light last:border-b-0 hover:bg-bg-soft/60 ${isArchived ? "opacity-60 italic" : ""}`}
    >
      {/* Sticky title cell: opaque `bg-card` (matches the containing card, so
          data cells slide under it seam-free), with the row-hover tint
          mirrored by an `::after` overlay — the sticky z-[1] stacking context
          keeps the -z-10 overlay above the cell's own background but below
          the link text. */}
      <th
        scope="row"
        className="group-hover:after:opacity-100 sticky left-0 z-[1] bg-card px-3 py-1.5 text-left font-normal after:pointer-events-none after:absolute after:inset-0 after:-z-10 after:bg-bg-soft/60 after:opacity-0"
      >
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
        <td
          key={f.name}
          className={`px-3 py-1 align-middle ${f.schema.type === "number" ? "text-right" : ""}`}
        >
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
