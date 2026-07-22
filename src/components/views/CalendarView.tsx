import { EmptyState } from "@/components/ui/EmptyState";
import { NoteCard } from "@/components/views/NoteCard";
import { NoteFieldChips } from "@/components/views/NoteFieldChips";
import { formatLongDate, formatLongMonth, monthGrid, shiftMonth, todayKey } from "@/lib/dates";
import { displayTitle } from "@/lib/note-title";
import type { TagRoles } from "@/lib/vault/tag-roles";
import type { Note } from "@/lib/vault/types";
import type { ResolvedField } from "@/lib/views/fields";
import { defaultMonth, placeOnCalendar } from "@/lib/views/grouping";
import type { QueryKey } from "@tanstack/react-query";
import { useMemo, useState } from "react";

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
export function CalendarView({
  notes,
  dateField,
  roles,
  viewResultsKey,
  fields = [],
}: {
  notes: Note[];
  dateField: string;
  roles: TagRoles;
  /** The `useViewResults` cache key — the optimistic write target for the chips. */
  viewResultsKey: QueryKey;
  /** The view's resolved fields (Part B) — an editable chip band on the day panel. */
  fields?: ResolvedField[];
}) {
  const placement = useMemo(() => placeOnCalendar(notes, dateField), [notes, dateField]);
  // First-render default: the month of the most recent dated note. A lazy
  // initializer runs once (the results are already loaded when this mounts),
  // so user navigation wins after that — nothing yanks the month back.
  const [ym, setYm] = useState(() => defaultMonth(placement.dates.values()));
  const [selected, setSelected] = useState<string | null>(null);

  const days = useMemo(() => monthGrid(ym.year, ym.month), [ym]);
  const today = todayKey();

  // No dated notes at all — an empty grid with month nav would be busywork.
  if (placement.byDay.size === 0) {
    return (
      <div className="space-y-3">
        <EmptyState
          title="Nothing to place on the calendar yet"
          description={`None of these notes carry a ${dateField} date.`}
        />
        <UndatedFootnote count={placement.undated.length} dateField={dateField} />
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
        <div className="grid grid-cols-7 border-b border-border text-xs uppercase tracking-wider text-fg-dim">
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

      <UndatedFootnote count={placement.undated.length} dateField={dateField} />
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
}: {
  dayKey: string;
  dayNumber: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  notes: Note[];
  onSelect: () => void;
}) {
  const hasNotes = notes.length > 0;
  const numberBadge = (
    <span
      className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full tabular-nums ${
        isToday ? "bg-accent text-(--color-on-accent)" : "text-fg"
      }`}
    >
      {dayNumber}
    </span>
  );

  const chips = (
    <span className="flex flex-col gap-0.5">
      {notes.slice(0, MAX_CHIPS_PER_DAY).map((note) => (
        <span
          key={note.id}
          className="truncate rounded bg-accent/10 px-1 py-0.5 text-[10px] leading-tight text-accent"
        >
          {displayTitle(note).text}
        </span>
      ))}
      {notes.length > MAX_CHIPS_PER_DAY ? (
        <span className="text-[10px] text-fg-dim">+{notes.length - MAX_CHIPS_PER_DAY} more</span>
      ) : null}
    </span>
  );

  const cellClass = `flex min-h-24 flex-col border-b border-r border-border p-1.5 text-left text-xs ${
    inMonth ? "" : "opacity-40"
  } ${isSelected ? "bg-accent/5" : ""}`;

  if (!hasNotes) {
    return (
      <div className={cellClass}>
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
    >
      {numberBadge}
      {chips}
    </button>
  );
}

function UndatedFootnote({ count, dateField }: { count: number; dateField: string }) {
  if (count === 0) return null;
  return (
    <p className="text-xs text-fg-dim">
      {count} {count === 1 ? "note isn't" : "notes aren't"} shown — no {dateField} date.
    </p>
  );
}
