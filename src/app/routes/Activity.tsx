import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  type ActivityEvent,
  BUCKET_LABELS,
  BUCKET_ORDER,
  buildActivityEvents,
  groupEventsByBucket,
} from "@/lib/activity/events";
import { localDayBoundaryIso, shiftDay, todayKey } from "@/lib/dates";
import { relativeTime } from "@/lib/time";
import { DATE_VIEW_QUERY_LIMIT, useNotesForDateViews, useVaultStore } from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router";

const PAGE_SIZE = 50;
const ACTIVITY_WINDOW_DAYS = 30;

// The reflective "what happened" view — a calm timeline grouped into
// Today / Yesterday / This week / Older, each an eyebrow-labelled section
// over a warm card of rows. Reading-width (page-prose) since it's a linear
// scan, not a working list.
export function Activity() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const floorKey = shiftDay(todayKey(), -(ACTIVITY_WINDOW_DAYS - 1));
  const notes = useNotesForDateViews({
    field: "updated_at",
    from: localDayBoundaryIso(floorKey)!,
    limit: DATE_VIEW_QUERY_LIMIT,
  });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const events = useMemo(() => {
    if (!notes.data) return [];
    return buildActivityEvents(notes.data);
  }, [notes.data]);

  const visibleEvents = useMemo(() => events.slice(0, visibleCount), [events, visibleCount]);
  const grouped = useMemo(() => groupEventsByBucket(visibleEvents), [visibleEvents]);
  const remaining = events.length - visibleEvents.length;

  // NAVIGATION.md: route guard, no active vault — replace.
  if (!activeVault) return <Navigate to="/" replace />;

  return (
    <div className="page-prose">
      <header className="mb-8">
        <p className="eyebrow mb-1">Activity</p>
        <h1 className="page-title">Recent changes</h1>
        <p className="mt-2 text-fg-muted">
          Last 30 days, newest first. Deletions aren't tracked yet.
        </p>
      </header>

      {notes.isPending ? (
        <ActivitySkeleton />
      ) : notes.isError ? (
        <ErrorBlock error={notes.error} retry={() => notes.refetch()} />
      ) : events.length === 0 ? (
        <EmptyBlock />
      ) : (
        <>
          <div className="space-y-8">
            {BUCKET_ORDER.map((bucket) =>
              grouped[bucket].length > 0 ? (
                <Section key={bucket} title={BUCKET_LABELS[bucket]} events={grouped[bucket]} />
              ) : null,
            )}
          </div>
          {remaining > 0 ? (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                className="btn btn-secondary btn-touch"
              >
                Load more ({remaining} remaining)
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Section({ title, events }: { title: string; events: ActivityEvent[] }) {
  return (
    <section>
      <h2 className="eyebrow mb-3">
        {title} ({events.length})
      </h2>
      <ol className="card shadow-soft divide-y divide-border rounded-xl">
        {events.map((ev) => (
          <li key={ev.id}>
            <Link
              to={`/n/${encodeURIComponent(ev.noteId)}`}
              className="focus-ring block px-5 py-4 transition-colors hover:bg-bg-soft"
            >
              <div className="flex items-baseline justify-between gap-4">
                <div className="flex min-w-0 items-baseline gap-2">
                  <KindBadge kind={ev.kind} />
                  <span className="truncate font-mono text-sm text-fg">{ev.noteName}</span>
                </div>
                <span className="shrink-0 text-xs text-fg-dim">{relativeTime(ev.at)}</span>
              </div>
              {ev.preview ? (
                <p className="mt-1 truncate text-sm text-fg-muted">{ev.preview}</p>
              ) : null}
              {ev.tags && ev.tags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ev.tags.map((tag) => (
                    <span key={tag} className="chip chip-tag max-w-full break-all">
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function KindBadge({ kind }: { kind: "created" | "updated" }) {
  if (kind === "created") {
    return <span className="chip chip-tag shrink-0">Created</span>;
  }
  return <span className="chip shrink-0">Edited</span>;
}

function EmptyBlock() {
  return (
    <EmptyState
      title="No activity in the last 30 days."
      action={
        <Link to="/new" className="btn btn-primary">
          New note
        </Link>
      }
    />
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  );
}

function ErrorBlock({ error, retry }: { error: Error; retry: () => void }) {
  const isAuth = error instanceof VaultAuthError;
  return (
    <ErrorState
      title={isAuth ? "Session expired" : "Could not load activity"}
      message={error.message}
      action={
        isAuth ? (
          <Link to="/add" className="btn btn-primary">
            Reconnect vault
          </Link>
        ) : (
          <button type="button" onClick={retry} className="btn btn-secondary">
            Retry
          </button>
        )
      }
    />
  );
}
