import { App } from "@/app/App";
import { useVaultStore } from "@/lib/vault/store";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// W2-7 route renames: /all -> /notes, /graph -> /map. Both pre-rename
// addresses become query-preserving `replace` shims (App.tsx's
// `ShimPreservingQuery`) — a bookmark to `/all?view=pinned` must land on
// `/notes?view=pinned` with the query string intact, and leave no trace in
// `window.history` (NAVIGATION.md: (a) redirect shims — replace throughout).
// Rendered through the REAL <App/> (BrowserRouter, real window.history) so a
// `window.history.length` delta is meaningful, mirroring nav-history.test.tsx's
// methodology.
//
// /map renders the real VaultGraph route, which lazily pulls in
// react-force-graph-2d (canvas) and calls `new ResizeObserver` on mount —
// neither exists in jsdom, so both are stubbed exactly as VaultGraph.test.tsx
// does for its own direct-render suite.
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

function seedVault() {
  // Both destination rooms (Notes, VaultGraph) guard on an active vault
  // (NAVIGATION.md's route-guard row) — seed one so the shim's landing spot
  // renders instead of bouncing again to "/".
  useVaultStore.setState({
    vaults: {
      v1: {
        id: "v1",
        url: "http://localhost:1940",
        name: "default",
        issuer: "http://localhost:1940",
        clientId: "c",
        scope: "full",
        addedAt: "2026-04-20T00:00:00.000Z",
        lastUsedAt: "2026-04-20T00:00:00.000Z",
      },
    },
    activeVaultId: "v1",
  });
}

function stubFetch404() {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response("{}", { status: 404 })),
  );
}

describe("W2-7 route-rename shims — /all→/notes, /graph→/map", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    seedVault();
    stubFetch404();
    // jsdom has no ResizeObserver; VaultGraph (mounted at /map) constructs
    // one on mount.
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      class MockResizeObserver {
        observe() {}
        disconnect() {}
        unobserve() {}
      } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("/all?view=pinned lands on /notes?view=pinned via replace (query preserved, no history growth)", async () => {
    window.history.replaceState({}, "", "/all?view=pinned");
    const baseline = window.history.length;
    render(<App />);
    await waitFor(() => {
      expect(window.location.pathname).toBe("/notes");
      expect(window.location.search).toBe("?view=pinned");
    });
    // replace, not push — the shim leaves no trace in history.
    expect(window.history.length).toBe(baseline);
  });

  it("/graph?focus=abc lands on /map?focus=abc via replace (query preserved, no history growth)", async () => {
    window.history.replaceState({}, "", "/graph?focus=abc");
    const baseline = window.history.length;
    render(<App />);
    await waitFor(() => {
      expect(window.location.pathname).toBe("/map");
      expect(window.location.search).toBe("?focus=abc");
    });
    expect(window.history.length).toBe(baseline);
  });

  it("bare /all (no query) lands on /notes via replace", async () => {
    // Search isn't asserted to be empty here: Notes.tsx normalizes its own
    // filter state into the query string on mount (a second, unrelated
    // `replace` — the shim's own query-preservation is already pinned by the
    // `?view=pinned` case above). Both are `replace`, so history still
    // shouldn't grow.
    window.history.replaceState({}, "", "/all");
    const baseline = window.history.length;
    render(<App />);
    await waitFor(() => {
      expect(window.location.pathname).toBe("/notes");
    });
    expect(window.history.length).toBe(baseline);
  });

  it("bare /graph (no query) lands on bare /map via replace", async () => {
    window.history.replaceState({}, "", "/graph");
    const baseline = window.history.length;
    render(<App />);
    await waitFor(() => {
      expect(window.location.pathname).toBe("/map");
      expect(window.location.search).toBe("");
    });
    expect(window.history.length).toBe(baseline);
  });
});
