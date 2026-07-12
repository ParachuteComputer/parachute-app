import { NoteRow, NoteRowList } from "@/components/NoteRow";
import { SectionLabel } from "@/components/RecentTimeline";
import { EmptyState, ErrorState, OfflineRibbon, Skeleton } from "@/components/ui";
import { formatLongDate, parseDateKey, shiftDay, toDateKey, todayKey } from "@/lib/dates";
import { useHistoryAwareBack } from "@/lib/nav/history";
import { useNotesForDateViews, useTagRoles, useVaultStore } from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import type { Note } from "@/lib/vault/types";
import { useMemo } from "react";
import { Link, Navigate, useSearchParams } from "react-router";

// The day drill-in (F8 / W2-3): notes created or edited on one target day,
// reached from Calendar cells and Home's day-header links
// (`/today?date=YYYY-MM-DD`). This route used to ALSO render a no-param
// front-door timeline that duplicated Home almost note-for-note (two rooms,
// two names — DESIGN-SPEC F8); that timeline now lives solely at `/` (Home
// absorbed it), so a bare `/today` is a redirect shim, not a page of its own.
export function DayView() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get("date");

  // NAVIGATION.md: route guard, no active vault — replace.
  if (!activeVault) return <Navigate to="/" replace />;
  // NAVIGATION.md: `/today` (no-param) shim → `/` — replace. (a) The
  // front-door timeline this used to render now lives solely at Home; a bare
  // `/today` was never really "a place" of its own once the merge landed.
  if (dateParam === null) return <Navigate to="/" replace />;

  return <SingleDay dateParam={dateParam} />;
}

// ---------------------------------------------------------------------------
// Single day: notes created / edited on the target day.
// ---------------------------------------------------------------------------

function SingleDay({ dateParam }: { dateParam: string }) {
  // The history-aware escape (NAVIGATION.md § "The history-aware escape
  // rule"): prefers landing back wherever the user actually came from
  // (Calendar, Home's day headers, another day) and only falls back to Home
  // when there's genuinely nothing behind this entry (a deep link).
  const back = useHistoryAwareBack("/");

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
        <Link to="/" className="text-sm text-accent hover:underline">
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
      <nav className="mb-6 text-sm text-fg-dim">
        <button type="button" onClick={back} className="hover:text-accent">
          ← Back
        </button>
      </nav>

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
            <Link to="/" className="btn btn-secondary btn-sm">
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
  // Same shared row + list shape as Recent and /notes (W2-11 / F9 — one
  // anatomy everywhere). Role tags resolve once per list, not per row.
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const { roles } = useTagRoles(activeVault?.id ?? null);
  return (
    <section>
      <SectionLabel>
        {title} ({notes.length})
      </SectionLabel>
      <NoteRowList>
        {notes.map((n) => (
          <NoteRow key={n.id} note={n} pinnedTag={roles.pinned} archivedTag={roles.archived} />
        ))}
      </NoteRowList>
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
