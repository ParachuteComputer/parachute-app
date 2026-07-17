import { App } from "@/app/App";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #48: zero ErrorBoundaries meant any render-time throw white-screened
// the whole app. Settings is one of the lazy-loaded surfaces App.tsx wraps
// in a RouteErrorBoundary (App.tsx's lazy route table); mocked here (via
// vi.doMock, scoped to this test — Settings is pulled in through
// React.lazy's dynamic import(), so a doMock registered before that import()
// fires is honored) to throw on render, proving the boundary that actually
// ships, not just the ErrorBoundary unit in isolation (see
// src/components/ErrorBoundary.test.tsx for that).

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

describe("RouteErrorBoundary wired into App", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    seedVault();
    stubFetch404();
    useToastStore.setState({ toasts: [] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("@/app/routes/Settings", () => ({
      Settings: () => {
        throw new Error("settings blew up");
      },
    }));
  });

  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.doUnmock("@/app/routes/Settings");
  });

  it("a lazy surface's render-time throw shows the honest card, chrome stays mounted, and navigating away recovers", async () => {
    window.history.replaceState({}, "", "/settings");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
    // The chrome mounted outside the route-level boundary (mobile bottom
    // tab bar, always present once a vault is active) is unaffected — this
    // is the difference between a route-scoped net and the whole shell
    // going down with it.
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /back to notes/i }));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/notes");
    });
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });
});
