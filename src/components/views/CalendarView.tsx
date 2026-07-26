import { EmptyState } from "@/components/ui/EmptyState";
import { NoteCard } from "@/components/views/NoteCard";
import { NoteFieldChips } from "@/components/views/NoteFieldChips";
import { formatLongDate, formatLongMonth, monthGrid, shiftMonth, todayKey } from "@/lib/dates";
import { displayTitle } from "@/lib/note-title";
import type { TagRoles } from "@/lib/vault/tag-roles";
import type { Note } from "@/lib/vault/types";
import {
  type DropHandlerRegistry,
  useDropHandlerRegistry,
  useNoteDragSource,
  useNoteDropTarget,
} from "@/lib/views/dnd";
import type { ResolvedField } from "@/lib/views/fields";
import { defaultMonth, placeByCreatedAt, placeOnCalendar } from "@/lib/views/grouping";
import { useViewFieldWrite } from "@/lib/views/write";
import type { QueryKey } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Note titles shown inside a day cell before collapsing to "+N more".
const MAX_CHIPS_PER_DAY = 2;

// The calendar kind (Views Wave 2b) — plot result notes on a month grid by
// their `dateField` metadata value (an ISO date string like a meeting's
// `meeting_date`). A real month view: weeks as rows, days as cells, each
// dated note a chip on its day. A day with notes is a button that opens a
// panel of that day's notes below the grid; ◀/▶ navigate months. Notes with a
// missing/unparseable date are omitted and counted in a footnote. The grid
// mechanics (Sunday-started `monthGrid`, local `YYYY-MM-DD` keys) are shared
// with the /calendar route via `@/lib/dates`.
//
// Desktop drag (views train E): on fine-pointer devices each day chip is a
// drag source and each IN-MONTH cell a drop zone — dropping writes the note's
// `dateField` as a bare `YYYY-MM-DD`, exactly the value the field chip's date
// picker commits, through the same `useViewFieldWrite`. Same-day drops are a
// no-op; out-month cells take no drops (navigate months first); there's no
// "unschedule" zone — the chip's Clear already covers it. Touch devices see
// none of this — the tap path is unchanged.
//
// The createdAt fallback (views train F, D8): a `null` dateField plots notes
// by the local day of their `createdAt` instead of falling back to a list —
// a READ-ONLY calendar. There is no date field to write, so the entire date-
// write surface is gated off: no drop zones on cells (no props, no hover
// affordance), no drag sources on chips, no `useViewFieldWrite` bound for a
// day drop — the read-only chip is a plain span. The day panel still opens,
// and its FIELD chips stay editable (they write other fields through the
// shared hook — ratified). A quiet hint replaces the undated footnote (every
// note has a createdAt). Explicitly rejected: per-note fallback (undated
// notes plotting on createdAt inside a date-field calendar) — it blurs
// scheduled-vs-unscheduled and makes drag ambiguous.
export function CalendarView({
  notes,
  dateField,
  roles,
  viewResultsKey,
  fields = [],
}: {
  notes: Note[];
  /** The date-typed field to plot by — `null` mounts the read-only createdAt fallback. */
  dateField: string | null;
  roles: TagRoles;
  /** The `useViewResults` cache key — the optimistic write target for the chips. */
  viewResultsKey: QueryKey;
  /** The view's resolved fields (Part B) — an editable chip band on the day panel. */
  fields?: ResolvedField[];
}) {
  const placement = useMemo(
    () => (dateField === null ? placeByCreatedAt(notes) : placeOnCalendar(notes, dateField)),
    [notes, dateField],
  );
  // First-render default: the month of the most recent dated note. A lazy
  // initializer runs once (the results are already loaded when this mounts),
  // so user navigation wins after that — nothing yanks the month back.
  const [ym, setYm] = useState(() => defaultMonth(placement.dates.values()));
  const [selected, setSelected] = useState<string | null>(null);

  const days = useMemo(() => monthGrid(ym.year, ym.month), [ym]);
  const today = todayKey();

  // Routes a drop (landing on a DAY CELL) to the dragged chip's write hook.
  const dropRegistry = useDropHandlerRegistry<string>();

  // No dated notes at all — an empty grid with month nav would be busywork.
  // (Near-unreachable in createdAt mode — every wire note carries createdAt —
  // but degrade honestly if none parse.) This is where a JUST-created date
  // field lands (the on-ramp's `due`): the grid is empty because nothing
  // carries the field yet, so instead of a bare footnote we hand back the
  // notes themselves with an in-place date picker — the calendar's answer to
  // the board's uncategorized lane, where the first value gets set.
  if (placement.byDay.size === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          title="Nothing on the calendar yet"
          description={
            dateField === null
              ? undefined
              : `Give a note a ${dateField} date below and it lands on the grid.`
          }
        />
        {dateField === null ? null : (
          <UndatedNotes
            notes={placement.undated}
            dateField={dateField}
            roles={roles}
            viewResultsKey={viewResultsKey}
            fields={fields}
          />
        )}
      </div>
    );
  }

  const goto = (next: { year: number; month: number }) => {
    setSelected(null);
    setYm(next);
  };
  const selectedNotes = selected ? (placement.byDay.get(selected) ?? []) : [];

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-2xl tracking-tight text-fg">
          {formatLongMonth(ym.year, ym.month)}
        </h2>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => goto(shiftMonth(ym.year, ym.month, -1))}
            className="chip"
            aria-label="Previous month"
          >
            ← Prev
          </button>
          <button
            type="button"
            onClick={() => goto(defaultMonth(placement.dates.values()))}
            className="chip"
          >
            Latest
          </button>
          <button
            type="button"
            onClick={() => goto(shiftMonth(ym.year, ym.month, 1))}
            className="chip"
            aria-label="Next month"
          >
            Next →
          </button>
        </div>
      </header>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="grid grid-cols-7 border-b border-border bg-bg-soft text-2xs uppercase tracking-wider text-fg-dim">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-2 py-2 text-center">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const key = todayKey(d);
            const inMonth = d.getMonth() + 1 === ym.month;
            const dayNotes = placement.byDay.get(key) ?? [];
            const isToday = key === today;
            const isSelected = key === selected;
            return (
              <DayCell
                key={key}
                dayKey={key}
                dayNumber={d.getDate()}
                inMonth={inMonth}
                isToday={isToday}
                isSelected={isSelected}
                notes={dayNotes}
                onSelect={() => setSelected(key)}
                dateField={dateField}
                viewResultsKey={viewResultsKey}
                dropRegistry={dropRegistry}
              />
            );
          })}
        </div>
      </div>

      {selected && selectedNotes.length > 0 ? (
        <section aria-label={`Notes on ${formatLongDate(selected)}`} className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="eyebrow">{formatLongDate(selected)}</p>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-fg-dim hover:text-accent focus-ring rounded"
            >
              Clear
            </button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-2">
            {selectedNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                pinnedTag={roles.pinned}
                archivedTag={roles.archived}
                footer={
                  fields.length > 0 ? (
                    <NoteFieldChips note={note} fields={fields} viewResultsKey={viewResultsKey} />
                  ) : null
                }
              />
            ))}
          </div>
        </section>
      ) : null}

      {dateField === null ? (
        // The read-only mode's quiet hint — same register as the footnote it
        // replaces. The Date-field control above is the graduation path.
        <p className="text-xs text-fg-dim">
          Showing by created date — set a date field to schedule.
        </p>
      ) : (
        // The undated notes stay ACTIONABLE below the grid — a date picker per
        // note, so an undated note is one tap from a day, not just a count.
        <UndatedNotes
          notes={placement.undated}
          dateField={dateField}
          roles={roles}
          viewResultsKey={viewResultsKey}
          fields={fields}
        />
      )}
    </div>
  );
}

function DayCell({
  dayKey,
  dayNumber,
  inMonth,
  isToday,
  isSelected,
  notes,
  onSelect,
  dateField,
  viewResultsKey,
  dropRegistry,
}: {
  dayKey: string;
  dayNumber: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  notes: Note[];
  onSelect: () => void;
  /** `null` = read-only createdAt mode — this cell is NOT a drop zone. */
  dateField: string | null;
  viewResultsKey: QueryKey;
  dropRegistry: DropHandlerRegistry<string>;
}) {
  const hasNotes = notes.length > 0;
  // The editability gate (train F): a `null` dateField means there is nothing
  // a drop could write — no drop props, no hover affordance, static chips.
  const canEdit = dateField !== null;

  // Drop zone (train E) — the cell receives note drags; only IN-MONTH cells
  // in an EDITABLE calendar attach the props, so an out-month or read-only
  // drop falls through to the browser default (nothing). The handler passes
  // this cell's day to the dragged chip's registered writer.
  const onDropNote = useCallback(
    (noteId: string) => dropRegistry.dispatch(noteId, dayKey),
    [dropRegistry, dayKey],
  );
  const { isOver, targetProps } = useNoteDropTarget(onDropNote);
  const dropProps = canEdit && inMonth ? targetProps : {};

  const numberBadge = (
    <span
      className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full font-serif tabular-nums ${
        isToday ? "bg-accent text-(--color-on-accent)" : "text-fg"
      }`}
    >
      {dayNumber}
    </span>
  );

  const chips = (
    <span className="flex flex-col gap-0.5">
      {notes
        .slice(0, MAX_CHIPS_PER_DAY)
        .map((note) =>
          dateField === null ? (
            <StaticDayChip key={note.id} note={note} />
          ) : (
            <DayChip
              key={note.id}
              note={note}
              dayKey={dayKey}
              dateField={dateField}
              viewResultsKey={viewResultsKey}
              dropRegistry={dropRegistry}
            />
          ),
        )}
      {notes.length > MAX_CHIPS_PER_DAY ? (
        <span className="text-[10px] text-fg-dim">+{notes.length - MAX_CHIPS_PER_DAY} more</span>
      ) : null}
    </span>
  );

  const cellClass = `flex min-h-24 flex-col border-b border-r border-border p-1.5 text-left text-xs ${
    inMonth ? "" : "opacity-40"
  } ${isSelected ? "bg-accent/5" : ""} ${
    // The drop affordance: a subtle coral inset outline + tint on the hovered
    // cell. A state change, not motion — nothing for the reduced-motion gate.
    // Gated on `canEdit` alongside the props themselves — a read-only calendar
    // shows no drop affordance under any event sequence.
    canEdit && inMonth && isOver ? "bg-accent/5 outline-2 -outline-offset-2 outline-accent/60" : ""
  }`;

  if (!hasNotes) {
    return (
      <div className={cellClass} data-day={dayKey} {...dropProps}>
        {numberBadge}
        <span className="sr-only">no notes</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${formatLongDate(dayKey)} — ${notes.length} notes`}
      className={`${cellClass} hover:bg-bg/60 focus:bg-bg/60 focus:outline-none`}
      data-day={dayKey}
      {...dropProps}
    >
      {numberBadge}
      {chips}
    </button>
  );
}

// The chip's register (polish V6): a raised neutral mini — the prototype's
// `.mini` — not a coral tint. Every note on the grid used to wear
// `bg-accent/10 text-accent`, which made each one read as a link; neutral
// card-on-card keeps coral for what it means everywhere else (today, drop
// affordance, selection). Class-only: both chip variants share this constant.
const DAY_CHIP_CLASS =
  "truncate rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] leading-tight text-fg shadow-sm";

// The read-only calendar's chip (train F) — a plain span, deliberately
// hook-free: no `useViewFieldWrite`, no drag source, no registry entry. The
// `data-note-id` stays for markup parity with the editable chip (and the
// flash helper's selector), but nothing here can reach a write.
function StaticDayChip({ note }: { note: Note }) {
  return (
    <span data-note-id={note.id} className={DAY_CHIP_CLASS}>
      {displayTitle(note).text}
    </span>
  );
}

// A note's chip on its day cell — and, on fine-pointer devices, the calendar's
// drag source. Rendered once per (visible) note, so it can own the note-bound
// `useViewFieldWrite`; a drop anywhere on the grid dispatches back here. The
// written value is the target cell's bare `YYYY-MM-DD` day key — identical to
// what the field chip's date picker commits — with the same-day drop a
// deliberate no-op (no write, no toast). Chips aren't links, but they live
// inside the day-panel button: the drag source's click-capture also stops the
// post-dragend residue click from toggling the panel. Only mounted in the
// EDITABLE mode (a real `dateField`); the read-only mode renders
// `StaticDayChip` instead.
function DayChip({
  note,
  dayKey,
  dateField,
  viewResultsKey,
  dropRegistry,
}: {
  note: Note;
  dayKey: string;
  dateField: string;
  viewResultsKey: QueryKey;
  dropRegistry: DropHandlerRegistry<string>;
}) {
  const { write, isPending } = useViewFieldWrite(note, viewResultsKey);
  const drag = useNoteDragSource(note.id);

  const receiveDayDrop = useCallback(
    (targetDay: string) => {
      if (isPending || targetDay === dayKey) return;
      void write(dateField, targetDay, {
        errorPrefix: `Couldn't move "${displayTitle(note).text}"`,
      });
    },
    [isPending, dayKey, dateField, write, note],
  );
  useEffect(
    () => dropRegistry.register(note.id, receiveDayDrop),
    [dropRegistry, note.id, receiveDayDrop],
  );

  return (
    <span
      // The microconfirmation flash's target (views train A): after the drop's
      // write resolves, `flashNoteCard` pulses the chip on its NEW day.
      data-note-id={note.id}
      className={drag.canDrag ? `${DAY_CHIP_CLASS} cursor-grab` : DAY_CHIP_CLASS}
      {...drag.sourceProps}
    >
      {displayTitle(note).text}
    </span>
  );
}

// The undated notes, kept ACTIONABLE — the calendar's counterpart to the
// board's uncategorized lane. Each note is a card with a chip band scoped to
// the ONE date field it's missing; setting a date writes through the shared
// `useViewFieldWrite` (optimistic against the view's result cache), so the note
// re-places onto the grid without a refetch. Nothing when there are none.
function UndatedNotes({
  notes,
  dateField,
  roles,
  viewResultsKey,
  fields,
}: {
  notes: Note[];
  dateField: string;
  roles: TagRoles;
  viewResultsKey: QueryKey;
  fields: ResolvedField[];
}) {
  if (notes.length === 0) return null;
  // Scope the chip band to just the date field — the one thing keeping these
  // notes off the grid. Prefer the view's resolved field (its real schema);
  // synthesize a plain date field only if a `fields` override hides it, so the
  // picker is always the right control.
  const dateFieldEntry: ResolvedField = fields.find((f) => f.name === dateField) ?? {
    name: dateField,
    schema: { type: "date" },
  };
  // "no {field} date" reads well for `due`/`scheduled`, but doubles for a field
  // the user already named with "date" in it (`meeting date` → "no meeting date
  // date"). Since we celebrate arbitrary date-field names, append " date" only
  // when the name doesn't already carry it.
  const dateLabel = /date/i.test(dateField) ? dateField : `${dateField} date`;
  return (
    <section aria-label={`Not on the calendar — no ${dateLabel}`} className="space-y-2">
      <p className="eyebrow">Not on the calendar yet</p>
      <p className="text-xs text-fg-dim">
        {notes.length} {notes.length === 1 ? "note has" : "notes have"} no {dateLabel} — set one to
        place {notes.length === 1 ? "it" : "them"}.
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-2">
        {notes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            pinnedTag={roles.pinned}
            archivedTag={roles.archived}
            footer={
              <NoteFieldChips
                note={note}
                fields={[dateFieldEntry]}
                viewResultsKey={viewResultsKey}
              />
            }
          />
        ))}
      </div>
    </section>
  );
}
