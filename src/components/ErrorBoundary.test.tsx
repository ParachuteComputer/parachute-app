import { AppErrorBoundary, RouteErrorBoundary } from "@/components/ErrorBoundary";
import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useParams, useSearchParams } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function Bomb({ message = "kaboom" }: { message?: string }): never {
  throw new Error(message);
}

describe("RouteErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the honest error card (with the technical detail collapsed) in place of a throwing surface", () => {
    render(
      <MemoryRouter initialEntries={["/n/bad-note"]}>
        <Routes>
          <Route
            path="/n/:id"
            element={
              <RouteErrorBoundary>
                <Bomb message="metadata operator exploded" />
              </RouteErrorBoundary>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to notes/i })).toHaveAttribute("href", "/notes");
    // The wire-level message is present but tucked behind <details> — not
    // asserting on `hidden`/visibility (jsdom renders <details> content in
    // the a11y tree either way); the collapsed <summary> is the contract.
    expect(screen.getByText("Technical detail")).toBeInTheDocument();
    expect(screen.getByText(/metadata operator exploded/)).toBeInTheDocument();
  });

  it("leaves sibling chrome outside the boundary mounted when the wrapped surface throws", () => {
    render(
      <MemoryRouter initialEntries={["/n/bad-note"]}>
        <nav aria-label="Primary">chrome</nav>
        <Routes>
          <Route
            path="/n/:id"
            element={
              <RouteErrorBoundary>
                <Bomb />
              </RouteErrorBoundary>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it("resets on navigation to a different note (same route pattern) — a fresh note doesn't inherit the last one's crash", () => {
    // Same Route pattern (`/n/:id`) for both notes — React Router keeps
    // Harness mounted across the param change (it never remounts on its
    // own), so this only recovers because RouteErrorBoundary keys its inner
    // boundary on `location.key`. A real in-router navigation (clicking
    // a Link, not swapping MemoryRouter's `initialEntries` via rerender —
    // that prop is read only on first mount) is required to prove it.
    function Harness() {
      const { id } = useParams<{ id: string }>();
      return (
        <RouteErrorBoundary>
          {id === "bad-note" ? <Bomb /> : <p>note rendered fine</p>}
        </RouteErrorBoundary>
      );
    }

    render(
      <MemoryRouter initialEntries={["/n/bad-note"]}>
        <Link to="/n/good-note">go to good note</Link>
        <Routes>
          <Route path="/n/:id" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /go to good note/i }));

    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    expect(screen.getByText("note rendered fine")).toBeInTheDocument();
  });

  it("resets on a search-only navigation under the SAME pathname — review-caught regression (?view=pinned → ?view=archived)", () => {
    // Same pathname (`/notes`) both times, only the `?view=` search param
    // changes — React Router keeps the matched Route's element mounted for
    // a search-only change exactly as it does for a params-only one, so a
    // pathname-only key (the bug an earlier version of this file shipped)
    // would miss this: the pinned page's caught error would keep showing
    // over the archived page's otherwise-fine content. This is the same
    // shape as ViewSurface's refinements, Calendar's `?month=`, and
    // DayView's `?date=` — all wrapped routes whose content moves under a
    // fixed pathname.
    function Harness() {
      const [searchParams] = useSearchParams();
      const view = searchParams.get("view");
      return (
        <RouteErrorBoundary>
          {view === "pinned" ? <Bomb /> : <p>{`view: ${view}`}</p>}
        </RouteErrorBoundary>
      );
    }

    render(
      <MemoryRouter initialEntries={["/notes?view=pinned"]}>
        <Link to="/notes?view=archived">switch to archived</Link>
        <Routes>
          <Route path="/notes" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /switch to archived/i }));

    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    expect(screen.getByText("view: archived")).toBeInTheDocument();
  });
});

describe("AppErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("catches a chrome-level throw and offers a full-page reload affordance", () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(
      <AppErrorBoundary>
        <Bomb message="header blew up" />
      </AppErrorBoundary>,
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/reloading usually fixes it/i)).toBeInTheDocument();
    const reloadButton = screen.getByRole("button", { name: /reload/i });
    fireEvent.click(reloadButton);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
