import { App } from "@/app/App";
import { useFocusMode } from "@/lib/focus-mode";
import { MIRROR_FLAG_KEY } from "@/lib/mirror/flag";
import { useVaultStore } from "@/lib/vault/store";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The app-shell half of POLISH-WAVE PR 4 — Rail/Header/BottomTabBar/AppFooter/
// SpeedDial/AmbientMapFab all gate off `focusActive` in App.tsx's AppShell.
// This is an integration test against the REAL App (not a route-only
// harness) because the reviewer-focus items it's guarding are shell-level:
// safe-area-inset relocation, the isFocusablePath guard, and that nothing
// about the route/nav model itself changed.

interface FetchMap {
  [urlMatcher: string]: { status?: number; body: unknown };
}

function installFetch(map: FetchMap) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const matcher of Object.keys(map)) {
      if (url.includes(matcher)) {
        const entry = map[matcher]!;
        return {
          ok: (entry.status ?? 200) < 400,
          status: entry.status ?? 200,
          json: async () => entry.body,
          text: async () => "",
        } as Response;
      }
    }
    return { ok: false, status: 404, json: async () => null, text: async () => "" } as Response;
  });
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

function seedStore() {
  useVaultStore.setState({
    vaults: {
      dev: {
        id: "dev",
        url: "http://localhost:1940",
        name: "dev",
        issuer: "http://localhost:1940",
        clientId: "client-test",
        scope: "full",
        addedAt: "2026-04-18T00:00:00.000Z",
        lastUsedAt: "2026-04-18T00:00:00.000Z",
      },
    },
    activeVaultId: "dev",
  });
  localStorage.setItem(
    "lens:token:dev",
    JSON.stringify({ accessToken: "pvt_abc", scope: "full", vault: "default" }),
  );
}

const noteBody = {
  id: "abc-123",
  path: "Canon/Aaron",
  createdAt: "2026-04-16T00:00:00Z",
  updatedAt: "2026-04-17T00:00:00Z",
  content: "Teacher and builder.",
  tags: [],
  links: [],
  attachments: [],
};

describe("App shell — focus mode (POLISH-WAVE PR 4)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // This shell test mounts the REAL App + SyncProvider with a seeded vault.
    // The durable-offline mirror is now ON by default, which would spin up the
    // background hydration engine and race IndexedDB writes against per-test
    // teardown. This suite is about focus-mode chrome, not the mirror, so force
    // the mirror OFF to keep the shell behavior it asserts unchanged.
    localStorage.setItem(MIRROR_FLAG_KEY, "false");
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useFocusMode.setState({ on: false });
    seedStore();
    // `getNote(id)` hits `/api/notes?id=<id>&include_content=true` — matched
    // first (map key order) so it wins over the plainer list-query matcher
    // below. The Rail mounts `useNotesForDateViews` (`queryNotes`, no `id=`),
    // which expects a raw array back — an empty vault is fine for this suite.
    installFetch({
      "id=abc-123": { body: noteBody },
      "/api/notes": { body: [] },
    });
    window.history.replaceState({}, "", "/notes/n/abc-123");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useFocusMode.setState({ on: false });
  });

  it("Rail, NavDrawer, BottomTabBar, and the AGPL footer are present before focus mode", async () => {
    render(<App />);
    await screen.findByText("Teacher and builder.");
    // Rail is an <aside>, not a <nav> — role "complementary", not
    // "navigation" (BottomTabBar's <nav> shares the same aria-label
    // "Primary" by design, so role is what disambiguates them here).
    expect(screen.getByRole("complementary", { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
    // The tablet band's projection (notes#147's third band) is chrome too — at
    // rest it is just its handle, which is exactly what focus mode must drop.
    expect(screen.getByRole("button", { name: /open the navigation drawer/i })).toBeInTheDocument();
    expect(screen.getByText(/AGPL-3\.0/i)).toBeInTheDocument();
  });

  it("arming focus mode via the ghost button hides Rail, NavDrawer, BottomTabBar, the footer, and shows the exit chip", async () => {
    render(<App />);
    await screen.findByText("Teacher and builder.");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^focus/i }));
    });

    expect(screen.queryByRole("complementary", { name: /primary/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /primary/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /open the navigation drawer/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/AGPL-3\.0/i)).not.toBeInTheDocument();
    // The universal door out.
    expect(screen.getByRole("button", { name: /exit focus mode/i })).toBeInTheDocument();
    // The note itself is still on screen — the canvas, not the chrome, is
    // what focus mode is for.
    expect(screen.getByText("Teacher and builder.")).toBeInTheDocument();
  });

  it("clicking the exit chip restores every chrome element", async () => {
    render(<App />);
    await screen.findByText("Teacher and builder.");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^focus/i }));
    });
    expect(screen.queryByRole("complementary", { name: /primary/i })).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /exit focus mode/i }));
    });
    expect(screen.getByRole("complementary", { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open the navigation drawer/i })).toBeInTheDocument();
    expect(screen.getByText(/AGPL-3\.0/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /exit focus mode/i })).not.toBeInTheDocument();
  });

  it("the safe-area-inset-top moves onto the content wrapper once the Header is gone", async () => {
    // jsdom's CSSOM silently drops `env()` values (verified directly:
    // `el.style.paddingTop = "env(...)"` round-trips to `""`), so the actual
    // inline style can't be asserted here — only a real browser renders it.
    // `data-focus-safe-area` is the test hook App.tsx sets alongside the
    // style for exactly this reason; it pins WHEN the relocation applies.
    const { container } = render(<App />);
    await screen.findByText("Teacher and builder.");
    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main?.hasAttribute("data-focus-safe-area")).toBe(false);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^focus/i }));
    });
    expect(main?.getAttribute("data-focus-safe-area")).toBe("true");
  });

  it("the isFocusablePath guard blocks chrome from hiding even if the store is armed on a non-focusable route", async () => {
    // Belt-and-suspenders check, isolated from FocusModeMount's own
    // route-change reset: force `on: true` directly, then navigate to a
    // route AppShell must never treat as focusable.
    window.history.replaceState({}, "", "/notes/notes");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("complementary", { name: /primary/i })).toBeInTheDocument();
    });
    act(() => {
      useFocusMode.setState({ on: true });
    });
    // Still there — /notes isn't /n/:id or /n/:id/edit, so `focusActive`
    // never goes true regardless of the raw store flag.
    expect(screen.getByRole("complementary", { name: /primary/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /exit focus mode/i })).not.toBeInTheDocument();
  });
});
