import { App } from "@/app/App";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #48's other net: a throw from the chrome itself (Header, Rail, a
// provider — anything above/outside a single route) has no RouteErrorBoundary
// to catch it; only the top-level AppErrorBoundary in App.tsx does. Header is
// a static import in App.tsx, so — unlike the lazy Settings route in
// App.error-boundary.route.test.tsx — the mock has to be a hoisted
// `vi.mock()` in its own file: App.tsx binds its Header reference when the
// module graph first loads, before any in-test `vi.doMock()` could run.
vi.mock("@/components/Header", () => ({
  Header: () => {
    throw new Error("header blew up");
  },
}));

function seedVault() {
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

describe("AppErrorBoundary wired into App", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    seedVault();
    stubFetch404();
    useToastStore.setState({ toasts: [] });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a chrome-level throw (outside any single route) is caught by the top-level net", async () => {
    window.history.replaceState({}, "", "/settings");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
    // The last net's fallback is full-page + reload, not "Back to notes" —
    // Header throwing unwinds the whole AppShell (Rail, Routes/Settings,
    // BottomTabBar included), so there's no router subtree left to navigate
    // within, and no "Primary" nav chrome survives either.
    expect(screen.queryByRole("link", { name: /back to notes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /primary/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
  });
});
