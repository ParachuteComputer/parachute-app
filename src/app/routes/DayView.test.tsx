import { DayView } from "@/app/routes/DayView";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  id: string;
  path: string;
  createdAt: string;
  updatedAt?: string;
  tags?: string[];
  preview?: string;
}

function installFetch(notes: Row[]) {
  const impl = vi.fn<typeof fetch>(async () => {
    return {
      ok: true,
      status: 200,
      json: async () => notes,
      text: async () => "",
    } as Response;
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

function seedStore() {
  useVaultStore.setState({
    vaults: {
      v1: {
        id: "v1",
        url: "http://localhost:1940",
        name: "default",
        issuer: "http://localhost:1940",
        clientId: "c",
        scope: "full",
        addedAt: "2026-04-18T00:00:00.000Z",
        lastUsedAt: "2026-04-18T00:00:00.000Z",
      },
    },
    activeVaultId: "v1",
  });
  localStorage.setItem(
    "lens:token:v1",
    JSON.stringify({ accessToken: "t", scope: "full", vault: "default" }),
  );
}

function LocationSpy() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function Wrap({ children, initial = "/today" }: { children: ReactNode; initial?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <MemoryRouter initialEntries={[initial]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/today" element={children} />
          <Route path="/" element={<LocationSpy />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

// Local-time ISO for a date key. Tests fake the clock, so build ISOs from
// Date so host-timezone drift doesn't flip buckets.
function localIso(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour).toISOString();
}

describe("DayView — single day (?date drill-in)", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
    // Pin clock so todayKey() is stable across hosts.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 3, 18, 12, 0, 0));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  it("buckets notes into 'created today' and 'edited today' sections", async () => {
    installFetch([
      {
        id: "n1",
        path: "Morning.md",
        createdAt: localIso(2026, 4, 18, 9),
        updatedAt: localIso(2026, 4, 18, 9),
      },
      {
        id: "n2",
        path: "Earlier.md",
        createdAt: localIso(2026, 4, 15, 10),
        updatedAt: localIso(2026, 4, 18, 14),
      },
      {
        id: "n3",
        path: "Unrelated.md",
        createdAt: localIso(2026, 4, 10, 10),
      },
    ]);
    render(
      <Wrap initial="/today?date=2026-04-18">
        <DayView />
      </Wrap>,
    );

    // Rows show the human title (path leaf); a bare "Morning.md" doesn't
    // repeat as a mono metadata line since it differs from the title only by
    // the extension.
    await screen.findByText("Morning");
    expect(screen.getByText(/created today \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText("Earlier")).toBeInTheDocument();
    expect(screen.getByText(/edited today \(1\)/i)).toBeInTheDocument();
    expect(screen.queryByText("Unrelated")).not.toBeInTheDocument();
  });

  it("renders 'On <date>' header with date param", async () => {
    installFetch([
      {
        id: "n1",
        path: "Past.md",
        createdAt: localIso(2026, 4, 10, 9),
      },
    ]);
    render(
      <Wrap initial="/today?date=2026-04-10">
        <DayView />
      </Wrap>,
    );
    await screen.findByText("Past");
    expect(screen.getByText(/created on 2026-04-10 \(1\)/i)).toBeInTheDocument();
    // "Today" jump button is visible when not on today, and (F8/W2-3) points
    // straight at `/` now — the canonical room — rather than round-tripping
    // through the `/today` no-param shim.
    const todayJump = screen.getByRole("link", { name: /^today$/i });
    expect(todayJump).toBeInTheDocument();
    expect(todayJump).toHaveAttribute("href", "/");
  });

  it("shows empty state with a create link when today is empty", async () => {
    installFetch([]);
    render(
      <Wrap initial="/today?date=2026-04-18">
        <DayView />
      </Wrap>,
    );
    expect(await screen.findByText(/nothing yet today — start capturing/i)).toBeInTheDocument();
    // Empty-state CTA points at /new (unified create surface).
    expect(screen.getByRole("link", { name: /^new note$/i })).toBeInTheDocument();
  });

  it("shows dated empty copy (no create button) for a past day", async () => {
    installFetch([]);
    render(
      <Wrap initial="/today?date=2026-04-10">
        <DayView />
      </Wrap>,
    );
    expect(await screen.findByText(/nothing on 2026-04-10/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^new note$/i })).not.toBeInTheDocument();
  });

  it("prev/next links point to the neighbouring day", async () => {
    installFetch([]);
    render(
      <Wrap initial="/today?date=2026-04-10">
        <DayView />
      </Wrap>,
    );
    await screen.findByText(/nothing on 2026-04-10/i);
    expect(screen.getByRole("link", { name: /previous day/i })).toHaveAttribute(
      "href",
      "/today?date=2026-04-09",
    );
    expect(screen.getByRole("link", { name: /next day/i })).toHaveAttribute(
      "href",
      "/today?date=2026-04-11",
    );
  });

  it("renders an error block for invalid date param", async () => {
    installFetch([]);
    render(
      <Wrap initial="/today?date=not-a-date">
        <DayView />
      </Wrap>,
    );
    expect(await screen.findByText(/invalid date in url: not-a-date/i)).toBeInTheDocument();
    // The invalid-date escape also points straight at `/` (F8/W2-3).
    expect(screen.getByRole("link", { name: /back to today/i })).toHaveAttribute("href", "/");
  });

  it("redirects to / when there's no active vault", async () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    installFetch([]);
    render(
      <Wrap initial="/today?date=2026-04-18">
        <DayView />
      </Wrap>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/");
    });
  });
});

// F8/W2-3: `/today` with NO `?date=` used to render an almost-duplicate
// front-door timeline (the room Home absorbed — see Home.test.tsx and
// Home.offline.test.tsx for that coverage now). It's a redirect shim.
describe("DayView — /today (no date) shim", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  it("redirects a bare /today to / when a vault is active", async () => {
    installFetch([]);
    render(
      <Wrap initial="/today">
        <DayView />
      </Wrap>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/");
    });
  });

  it("redirects to / when there's no active vault either (guard takes precedence)", async () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    installFetch([]);
    render(
      <Wrap initial="/today">
        <DayView />
      </Wrap>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/");
    });
  });
});

// The history-aware "← Back" (NAVIGATION.md § "the history-aware escape
// rule", wired here per DESIGN-SPEC §4.3/§2.5 row 2). `useHistoryAwareBack`
// reads the browser's REAL `window.history.state.idx`, which a MemoryRouter
// can't drive (it keeps its own separate stack) — so, like
// `src/lib/nav/history.test.tsx`, these run through a real BrowserRouter.
describe("DayView — history-aware back (W2-3)", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
    installFetch([]);
    window.history.replaceState(null, "", "/calendar");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  function CalendarStub() {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate("/today?date=2026-04-10")}>
        Open day
      </button>
    );
  }

  function BrowserWrap() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return (
      <BrowserRouter>
        <QueryClientProvider client={qc}>
          <Routes>
            <Route path="/calendar" element={<CalendarStub />} />
            <Route path="/today" element={<DayView />} />
            <Route path="/" element={<LocationSpy />} />
          </Routes>
        </QueryClientProvider>
      </BrowserRouter>
    );
  }

  it("goes back to the real prior entry (e.g. Calendar) when one exists", async () => {
    render(<BrowserWrap />);
    fireEvent.click(screen.getByRole("button", { name: /open day/i }));
    const back = await screen.findByRole("button", { name: /← back/i });
    fireEvent.click(back);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /open day/i })).toBeInTheDocument(),
    );
  });

  it("falls back to / when there's nothing behind (a direct deep link)", async () => {
    window.history.replaceState(null, "", "/today?date=2026-04-10");
    render(<BrowserWrap />);
    const back = await screen.findByRole("button", { name: /← back/i });
    fireEvent.click(back);
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/"));
  });
});
