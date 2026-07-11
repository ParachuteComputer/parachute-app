import {
  NoteTimelineRow,
  RecentTimeline,
  SectionLabel,
  groupNotesByDay,
} from "@/components/RecentTimeline";
import { EmptyState, ErrorState, OfflineRibbon, Skeleton } from "@/components/ui";
import { formatLongDate, parseDateKey, shiftDay, toDateKey, todayKey } from "@/lib/dates";
import { useNotesForDateViews, useVaultStore } from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import type { Note } from "@/lib/vault/types";
import { useMemo } from "react";
import { Link, Navigate, useSearchParams } from "react-router";

// Re-exported so existing importers of the grouping helper (and its unit test)
// keep resolving it from this module after the list itself moved into the
// shared RecentTimeline component.
export { groupNotesByDay };

// The front door. With no `?date` it renders a day-grouped timeline of recent
// notes (the calm daily driver at `/`); with `?date=YYYY-MM-DD` it renders the
// single-day view a Calendar cell drills into. Empty days never render — the
// timeline only shows days that actually hold notes.
export function Today() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get("date");

  // NAVIGATION.md: route guard, no active vault — replace.
  if (!activeVault) return <Navigate to="/" replace />;
  if (dateParam !== null) return <SingleDay dateParam={dateParam} />;
  return <Timeline vaultName={activeVault.name} />;
}

// ---------------------------------------------------------------------------
// Front-door timeline: recent notes grouped by their most-recent-activity day.
// The grouped list itself lives in the shared RecentTimeline component (also
// used by the guided home at `/`); this wrapper adds Today's header + states.
// ---------------------------------------------------------------------------

function Timeline({ vaultName }: { vaultName: string }) {
  const notes = useNotesForDateViews();
  const groups = useMemo(() => groupNotesByDay(notes.data ?? []), [notes.data]);

  return (
    <div className="page-prose">
      <header className="mb-8">
        <p className="eyebrow">{vaultName}</p>
        <h1 className="page-title">Today</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
          <Link to="/new" className="text-accent hover:underline">
            + Capture
          </Link>
          <Link to="/all" className="hover:text-accent">
            All notes
          </Link>
          <Link to="/calendar" className="hover:text-accent">
            Calendar
          </Link>
        </div>
      </header>

      {notes.isPending ? (
        <TimelineSkeleton />
      ) : notes.isError && !notes.data ? (
        // Only a genuinely empty cache falls through to the error block — when
        // a background refetch fails but we still hold notes, keep showing them.
        <ErrorBlock error={notes.error} />
      ) : groups.length === 0 ? (
        <TimelineEmpty />
      ) : (
        <>
          {notes.isError ? <OfflineRibbon /> : null}
          <RecentTimeline notes={notes.data ?? []} />
        </>
      )}
    </div>
  );
}

function TimelineEmpty() {
  return (
    <EmptyState
      title={<span className="font-serif text-lg text-fg">A quiet, empty page.</span>}
      description="Your notes will gather here, newest day first."
      action={
        <Link to="/new" className="btn btn-primary btn-touch">
          Capture the first one
        </Link>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Single day (Calendar drill-in): notes created / edited on the target day.
// ---------------------------------------------------------------------------

function SingleDay({ dateParam }: { dateParam: string }) {
  const todayStr = todayKey();
  const targetKey = dateParam || todayStr;
  const parsed = parseDateKey(targetKey);

  const notes = useNotesForDateViews();

  const buckets = useMemo(() => {
    const created: Note[] = [];
    const edited: Note[] = [];
    if (!notes.data || !parsed) return { created, edited };
    for (const n of notes.data) {
      const ck = toDateKey(n.createdAt);
      const uk = toDateKey(n.updatedAt ?? n.createdAt);
      if (ck === targetKey) created.push(n);
      if (uk === targetKey && ck !== targetKey) edited.push(n);
    }
    return { created, edited };
  }, [notes.data, parsed, targetKey]);

  if (!parsed) {
    return (
      <div className="page-prose">
        <p className="text-sm text-danger">Invalid date in URL: {targetKey}</p>
        <Link to="/today" className="text-sm text-accent hover:underline">
          Back to today
        </Link>
      </div>
    );
  }

  const isToday = targetKey === todayStr;
  const prev = shiftDay(targetKey, -1);
  const next = shiftDay(targetKey, 1);
  const monthKey = targetKey.slice(0, 7);

  return (
    <div className="page-prose">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="eyebrow">{isToday ? "Today" : "On"}</p>
          <h1 className="page-title">{formatLongDate(targetKey)}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            to={`/today?date=${prev}`}
            className="btn btn-secondary btn-sm"
            aria-label="Previous day"
          >
            ← {prev}
          </Link>
          {!isToday ? (
            <Link to="/today" className="btn btn-secondary btn-sm">
              Today
            </Link>
          ) : null}
          <Link
            to={`/today?date=${next}`}
            className="btn btn-secondary btn-sm"
            aria-label="Next day"
          >
            {next} →
          </Link>
          <Link to={`/calendar?month=${monthKey}`} className="btn btn-secondary btn-sm">
            Calendar
          </Link>
          <Link to="/new" className="btn btn-primary btn-sm">
            + New note
          </Link>
        </div>
      </header>

      {notes.isPending ? (
        <TimelineSkeleton />
      ) : notes.isError && !notes.data ? (
        <ErrorBlock error={notes.error} />
      ) : buckets.created.length === 0 && buckets.edited.length === 0 ? (
        <EmptyBlock isToday={isToday} targetKey={targetKey} />
      ) : (
        <div className="space-y-8">
          {notes.isError ? <OfflineRibbon /> : null}
          {buckets.created.length > 0 ? (
            <Section
              title={isToday ? "Created today" : `Created on ${targetKey}`}
              notes={buckets.created}
            />
          ) : null}
          {buckets.edited.length > 0 ? (
            <Section
              title={isToday ? "Edited today" : `Edited on ${targetKey}`}
              notes={buckets.edited}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function Section({ title, notes }: { title: string; notes: Note[] }) {
  return (
    <section>
      <SectionLabel>
        {title} ({notes.length})
      </SectionLabel>
      <ol className="divide-y divide-border rounded-md border border-border bg-card">
        {notes.map((n) => (
          <NoteTimelineRow key={n.id} note={n} />
        ))}
      </ol>
    </section>
  );
}

function EmptyBlock({ isToday, targetKey }: { isToday: boolean; targetKey: string }) {
  return (
    <EmptyState
      title={isToday ? "Nothing yet today — start capturing." : `Nothing on ${targetKey}.`}
      action={
        isToday ? (
          <Link to="/new" className="btn btn-primary">
            New note
          </Link>
        ) : undefined
      }
    />
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-14 rounded-xl" />
      ))}
    </div>
  );
}

function ErrorBlock({ error }: { error: Error }) {
  const isAuth = error instanceof VaultAuthError;
  return (
    <ErrorState
      title={isAuth ? "Session expired" : "Could not load notes"}
      message={error.message}
      action={
        isAuth ? (
          <Link to="/add" className="btn btn-primary">
            Reconnect vault
          </Link>
        ) : undefined
      }
    />
  );
}
