import { ErrorState } from "@/components/ui/ErrorState";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link, useLocation } from "react-router";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: (error: Error) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * ErrorBoundary — the standard React class-component idiom (no
 * react-error-boundary dependency in this repo). Catches a render-time throw
 * anywhere in `children` and swaps in `fallback` in place of React's default
 * behavior — unmounting the whole tree up to the nearest boundary, which
 * used to be none, so any surface's throw white-screened the entire app
 * (issue #48). `RouteErrorBoundary` and `AppErrorBoundary` below are the two
 * calibrated fallbacks this repo mounts; reach for this class directly only
 * for a third shape.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught a render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) return this.props.fallback(this.state.error);
    return this.props.children;
  }
}

function RouteErrorCard({ error }: { error: Error }) {
  return (
    <div className="page">
      <ErrorState
        title="Something went wrong"
        message={
          <>
            This page hit an unexpected error. You can head back to your notes.
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-fg-dim hover:text-fg-muted">
                Technical detail
              </summary>
              <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-fg-dim">
                {error.message}
              </p>
            </details>
          </>
        }
        action={
          <Link to="/notes" className="btn btn-secondary btn-touch">
            Back to notes
          </Link>
        }
      />
    </div>
  );
}

/**
 * RouteErrorBoundary — wraps one routed surface (NoteView, Settings, a view,
 * …) so a render-time throw shows the honest error card in place of that
 * surface only; the chrome mounted outside it in `AppShell` (Rail, Header,
 * BottomTabBar, footer) stays alive, and "Back to notes" gives a way out.
 *
 * Keyed by `location.key` — react-router's own per-navigation-entry id, not
 * `location.pathname`. React Router doesn't remount a Route's element when
 * only params or the search string change (`/n/1` → `/n/2` both match
 * `/n/:id`; ViewSurface's refinements, Calendar's `?month=`, and DayView's
 * `?date=` all update the SAME mounted element too), so a pathname-only key
 * missed those — a caught error under `/notes?view=pinned` would keep
 * showing over `/notes?view=archived`, same pathname, different content.
 * `location.key` changes on every push/replace (pathname, search, hash, or
 * even a repeat push to an identical URL), so it resets on strictly more
 * cases than any hand-assembled `pathname + search` string would.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary key={location.key} fallback={(error) => <RouteErrorCard error={error} />}>
      {children}
    </ErrorBoundary>
  );
}

function AppErrorCard({ error }: { error: Error }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-serif text-xl text-fg">Something went wrong</p>
      <p className="text-sm text-fg-muted">
        Parachute hit an unexpected error and couldn't recover on its own. Reloading usually fixes
        it.
      </p>
      <details className="w-full text-left">
        <summary className="cursor-pointer text-xs text-fg-dim hover:text-fg-muted">
          Technical detail
        </summary>
        <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-fg-dim">
          {error.message}
        </p>
      </details>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="btn btn-primary btn-touch"
      >
        Reload
      </button>
    </div>
  );
}

/**
 * AppErrorBoundary — the last net, mounted above the router in `App()` so it
 * also catches a throw from the chrome itself (Rail, Header, a provider),
 * not just a routed surface. No "Back to notes" here — if this fired, the
 * whole tree below it (including the router) already unmounted, so the only
 * honest affordance is a full reload.
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary fallback={(error) => <AppErrorCard error={error} />}>{children}</ErrorBoundary>
  );
}
