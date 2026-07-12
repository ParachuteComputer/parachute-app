import { NoteRow, NoteRowList } from "@/components/NoteRow";
import { formatLongDate, shiftDay, toDateKey, todayKey } from "@/lib/dates";
import { useTagRoles, useVaultStore } from "@/lib/vault";
import type { Note } from "@/lib/vault/types";
import { useMemo } from "react";
import { Link } from "react-router";

// The day-grouped recent-notes list on the front-door home (`/`). The rows
// themselves are the shared NoteRow (W2-11 / F9 — one anatomy across Today,
// the day drill-in, and /notes); this module owns only the day bucketing and
// the day-header links into the single-day view.

export interface DayGroup {
  key: string;
  notes: Note[];
}

// Group the capped recent-notes window by day (updatedAt, falling back to
// createdAt — a note lands on the day it was last touched). Days sort newest
// first; notes within a day sort newest first. Exported for unit testing the
// bucketing without mounting a route.
export function groupNotesByDay(notes: Note[]): DayGroup[] {
  const byDay = new Map<string, Note[]>();
  for (const n of notes) {
    const key = toDateKey(n.updatedAt ?? n.createdAt);
    if (!key) continue;
    const bucket = byDay.get(key);
    if (bucket) bucket.push(n);
    else byDay.set(key, [n]);
  }
  const stamp = (n: Note) => n.updatedAt ?? n.createdAt;
  return Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, group]) => ({
      key,
      notes: group.sort((a, b) => (stamp(a) < stamp(b) ? 1 : stamp(a) > stamp(b) ? -1 : 0)),
    }));
}

// "Today" / "Yesterday" for the two most recent days, else the long date. Keeps
// the timeline's day headers legible at a glance.
export function relativeDayLabel(key: string): string {
  const today = todayKey();
  if (key === today) return "Today";
  if (key === shiftDay(today, -1)) return "Yesterday";
  return formatLongDate(key);
}

// Eyebrow-style section label with a hairline rule, per the design system.
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="eyebrow mb-2 flex items-center gap-3">
      <span className="shrink-0">{children}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </h2>
  );
}

// The day-grouped list itself. Callers own loading / empty / error states and
// pass the resolved notes; this renders only the grouped sections. Day headers
// link into the single-day view at `/today?date=<key>`. Role tags (pinned /
// archived status on the shared row) resolve ONCE here, not per row.
export function RecentTimeline({ notes }: { notes: Note[] }) {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const { roles } = useTagRoles(activeVault?.id ?? null);
  const groups = useMemo(() => groupNotesByDay(notes), [notes]);
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.key}>
          <SectionLabel>
            <Link to={`/today?date=${g.key}`} className="hover:text-accent">
              {relativeDayLabel(g.key)}
            </Link>
          </SectionLabel>
          <NoteRowList>
            {g.notes.map((n) => (
              <NoteRow key={n.id} note={n} pinnedTag={roles.pinned} archivedTag={roles.archived} />
            ))}
          </NoteRowList>
        </section>
      ))}
    </div>
  );
}
