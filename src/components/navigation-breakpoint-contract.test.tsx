import { BottomTabBar } from "@/components/BottomTabBar";
import { LensStrip } from "@/components/LensStrip";
import { NavSheet } from "@/components/NavSheet";
import { Rail } from "@/components/Rail";
import { SpeedDial } from "@/components/SpeedDial";
import { NavBandsProvider } from "@/lib/nav/model";
import { saveToken } from "@/lib/vault/storage";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderResult, act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Contract test (notes#147, re-homed to Rail↔BottomTabBar in Phase 3a; band
// parity added in W2-5): the primary-navigation surface on desktop (the left
// Rail) and on mobile+tablet (the BottomTabBar + NavSheet) MUST share the same
// breakpoint and meet without a gap. The Rail is `hidden lg:flex` (only
// visible at >= lg); the BottomTabBar and NavSheet are `lg:hidden` (visible
// until >= lg). At any viewport width exactly one projection shows. The
// failure mode this guards is one side drifting to `md:` — that leaves the
// 768-1023px band with no primary navigation.
//
// W2-5 adds the BAND-PARITY half of the contract (F14): the Rail and the
// NavSheet both render `useNavBands()`, and this test pins that neither
// projection can grow (or lose) a room the other doesn't have — band ids,
// item ids, labels, and hrefs must be identical, in order.
//
// JSDOM can't compute layout, so the visibility assertions are at the
// class-name level.

function makeVault(partial: Partial<VaultRecord> & Pick<VaultRecord, "id" | "url">): VaultRecord {
  return {
    name: "default",
    issuer: partial.url,
    clientId: "client-test",
    scope: "full",
    addedAt: "2026-04-22T00:00:00.000Z",
    lastUsedAt: "2026-04-22T00:00:00.000Z",
    ...partial,
  };
}

function seedActiveVault() {
  useVaultStore.setState({
    vaults: { a: makeVault({ id: "a", url: "http://localhost:1940", name: "default" }) },
    activeVaultId: "a",
  });
}

// The Rail reads react-query data (setup-checklist signal), so it needs a
// client in scope. Retry off so the stubbed 200 settles immediately; async +
// act so the settled query doesn't leave a pending state update.
async function renderWithClient(ui: ReactNode): Promise<RenderResult> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result!: RenderResult;
  await act(async () => {
    result = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <NavBandsProvider>{ui}</NavBandsProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return result;
}

describe("Rail + BottomTabBar breakpoint contract (notes#147)", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ notes: [], vaults: [], services: [] }),
        }) as Response,
    ) as unknown as typeof fetch;
    seedActiveVault();
  });

  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    vi.restoreAllMocks();
  });

  it("Rail shows at lg+ and BottomTabBar hides at lg+ — same gate, opposite direction, no gap", async () => {
    const { container: railContainer } = await renderWithClient(<Rail />);
    const { container: barContainer } = await renderWithClient(<BottomTabBar />);

    // The Rail's root <aside> is `hidden lg:flex` (renders at >= lg).
    const rail = railContainer.querySelector("aside");
    expect(rail, "Rail <aside> must render when a vault is active").not.toBeNull();
    expect(rail?.className).toMatch(/\bhidden\b/);
    expect(rail?.className).toMatch(/\blg:flex\b/);

    // BottomTabBar's primary nav: `lg:hidden` (renders at < lg).
    const bar = barContainer.querySelector('nav[aria-label="Primary"]');
    expect(bar, "BottomTabBar primary nav must exist when a vault is active").not.toBeNull();
    expect(bar?.className).toMatch(/\blg:hidden\b/);

    // The hard contract: neither side may use `md:` for the visibility gate.
    expect(rail?.className).not.toMatch(/\bmd:flex\b/);
    expect(rail?.className).not.toMatch(/\bmd:hidden\b/);
    expect(bar?.className).not.toMatch(/\bmd:hidden\b/);
    expect(bar?.className).not.toMatch(/\bmd:flex\b/);
  });

  it("NavSheet is mobile-only (lg:hidden root) — at lg+ the Rail is the one projection", async () => {
    const { container } = await renderWithClient(<NavSheet open onClose={() => {}} />);
    const root = container.firstElementChild;
    expect(root, "NavSheet must render when open").not.toBeNull();
    expect(root?.className).toMatch(/\blg:hidden\b/);
    expect(root?.className).not.toMatch(/\bmd:hidden\b/);
  });

  // LZ-5: the on-surface lens strip joins the mobile side of the contract —
  // below lg the strip + bottom bar carry the lens set and the surface tab;
  // at lg+ the Rail owns both. Same gate, opposite direction, never both
  // (rendering the lens set twice on one viewport is the redundancy D2
  // rejected).
  it("LensStrip is mobile-only (lg:hidden) on the SAME gate the Rail flips on — exactly one lens projection per viewport", async () => {
    const { container } = await renderWithClient(<LensStrip />);
    const strip = container.querySelector('nav[aria-label="Lenses"]');
    expect(strip, "LensStrip must render when a vault is active").not.toBeNull();
    expect(strip?.className).toMatch(/\blg:hidden\b/);
    expect(strip?.className).not.toMatch(/\bmd:hidden\b/);
    expect(strip?.className).not.toMatch(/\bmd:flex\b/);
  });

  it("LensStrip projects EXACTLY the rail's lens band — same ids, labels, hrefs, order (single source, F14)", async () => {
    const { container: railContainer } = await renderWithClient(<Rail />);
    const { container: stripContainer } = await renderWithClient(<LensStrip />);

    const collect = (root: HTMLElement, selector: string) =>
      Array.from(root.querySelectorAll(selector)).map((a) => [
        a.getAttribute("data-nav-item") ?? "",
        a.textContent ?? "",
        a.getAttribute("href") ?? "",
      ]);
    const railLens = collect(railContainer, '[data-nav-band="notes"] a[data-nav-item]');
    const stripChips = collect(stripContainer, 'nav[aria-label="Lenses"] a[data-nav-item]');

    expect(stripChips.length).toBeGreaterThan(0);
    expect(stripChips).toEqual(railLens);
  });

  // W2-9: the capture affordances split by form factor on the SAME gate —
  // desktop gets the SpeedDial (top-right, `hidden lg:block`), mobile keeps
  // the BottomTabBar's raised centre [+] hopping straight to /new. Neither
  // side may drift to `md:`, and the mobile [+] must never become a menu.
  it("SpeedDial is desktop-only (hidden lg:block) and the mobile [+] still goes straight to /new (W2-9)", async () => {
    const { container: dialContainer } = await renderWithClient(<SpeedDial />);
    const { container: barContainer } = await renderWithClient(<BottomTabBar />);

    const dial = dialContainer.firstElementChild;
    expect(dial, "SpeedDial must render when a vault is active").not.toBeNull();
    expect(dial?.className).toMatch(/\bhidden\b/);
    expect(dial?.className).toMatch(/\blg:block\b/);
    expect(dial?.className).not.toMatch(/\bmd:block\b/);
    expect(dial?.className).not.toMatch(/\bmd:hidden\b/);

    const centerCapture = barContainer.querySelector('a[aria-label="New note"]');
    expect(centerCapture, "the mobile centre [+] must exist").not.toBeNull();
    expect(centerCapture?.getAttribute("href")).toBe("/new");
  });

  it("Rail renders nothing with no active vault (the no-vault desktop view is full-width Landing)", async () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    const { container } = await renderWithClient(<Rail />);
    expect(container.querySelector("aside")).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Band parity (W2-5, the F14 guard): both projections render the same
  // bands, items, labels, hrefs — in the same order.
  // ---------------------------------------------------------------------

  function collectNav(container: HTMLElement): string[][] {
    return Array.from(container.querySelectorAll("[data-nav-band] a[data-nav-item]")).map((a) => [
      a.closest("[data-nav-band]")?.getAttribute("data-nav-band") ?? "",
      a.getAttribute("data-nav-item") ?? "",
      a.textContent ?? "",
      a.getAttribute("href") ?? "",
    ]);
  }

  it("Rail and NavSheet render IDENTICAL bands/items/order/labels from the one nav model (F14)", async () => {
    const { container: railContainer } = await renderWithClient(<Rail />);
    const { container: sheetContainer } = await renderWithClient(
      <NavSheet open onClose={() => {}} />,
    );

    const railNav = collectNav(railContainer);
    const sheetNav = collectNav(sheetContainer).filter(([band]) => band !== "switcher");

    expect(railNav.length).toBeGreaterThan(0);
    expect(sheetNav).toEqual(railNav);

    // And the parity includes the F14 headliners: the manager zone's rooms.
    const ids = railNav.map(([, id]) => id);
    expect(ids).toContain("vaults");
    expect(ids).toContain("account");
    expect(ids).toContain("tags");
    expect(ids).toContain("calendar");

    // LZ-2: BOTH projections carry the lens band and the Explore band, with
    // the same items in the same order — the lens/destination split can't
    // exist on one form factor only.
    expect(railNav.filter(([band]) => band === "notes").map(([, id]) => id)).toEqual([
      "recent",
      "notes",
      "pinned",
      "archive",
    ]);
    expect(railNav.filter(([band]) => band === "explore").map(([, id]) => id)).toEqual([
      "calendar",
      "tags",
      "activity",
    ]);
    // The lens targets are today's exact URLs (LENS-SPEC §2, zero migration).
    const hrefById = new Map(railNav.map(([, id, , href]) => [id, href]));
    expect(hrefById.get("recent")).toBe("/");
    expect(hrefById.get("notes")).toBe("/notes");
    expect(hrefById.get("pinned")).toBe("/notes?view=pinned");
    expect(hrefById.get("archive")).toBe("/notes?view=archived");
  });

  it("band parity holds with the Map earned too (the gate flips on BOTH projections — F14)", async () => {
    useVaultStore.setState({
      vaults: {
        a: makeVault({ id: "a", url: "http://localhost:1940", name: "default" }),
        b: makeVault({ id: "b", url: "http://localhost:1941", name: "journal" }),
      },
      activeVaultId: "a",
    });
    const { container: railContainer } = await renderWithClient(<Rail />);
    const { container: sheetContainer } = await renderWithClient(
      <NavSheet open onClose={() => {}} />,
    );

    const railNav = collectNav(railContainer);
    const sheetNav = collectNav(sheetContainer).filter(([band]) => band !== "switcher");
    // Earned Map lands in EXPLORE (it's a destination, not a lens) — on both.
    expect(railNav.filter(([band]) => band === "explore").map(([, id]) => id)).toEqual([
      "calendar",
      "tags",
      "activity",
      "map",
    ]);
    expect(sheetNav).toEqual(railNav);
  });
});

// ---------------------------------------------------------------------------
// The OTHER half of the contract (app#110 Finding A): everything above is
// CSS-only — `hidden lg:flex` / `lg:hidden` hide a projection without
// unmounting it, so both projections (and the sheet, when open) are live
// React trees at every viewport width. The nav model carries a full-vault
// live subscription (`useNotesForDateViews`, limit=5000), so when each
// projection derived the model itself, every route streamed the vault once
// per projection — ×2 at boot, a third full stream on one ☰ tap (1.26 MiB
// each at 2.6k notes). These tests pin the fix: the model derives in ONE
// place (`NavBandsProvider`), however many projections mount.
// ---------------------------------------------------------------------------

describe("one nav-model derivation, N projections (app#110)", () => {
  /** Every WebSocket the app opened, by URL. */
  let openedSockets: string[] = [];

  // Minimal double for the slice of the WebSocket API ws-transport uses.
  // Mimics the vault's subscribe contract: after open, deliver an empty done
  // snapshot — these tests count sockets, not rows.
  class FakeVaultSocket {
    static OPEN = 1;
    url: string;
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: ((ev: { code: number }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      openedSockets.push(url);
      queueMicrotask(() => {
        if (this.readyState === 3) return;
        this.readyState = 1;
        this.onopen?.();
        this.onmessage?.({
          data: JSON.stringify({ type: "snapshot", notes: [], done: true }),
        });
      });
    }
    send(_data: string): void {}
    close(): void {
      this.readyState = 3;
      this.onclose?.({ code: 1000 });
    }
  }

  // The dateviews stream is the expensive one — the full-vault window.
  const dateviewsSubs = () => openedSockets.filter((u) => u.includes("limit=5000"));

  beforeEach(() => {
    localStorage.clear();
    openedSockets = [];
    seedActiveVault();
    // The live layer only subscribes with a token in scope.
    saveToken("a", { accessToken: "tok", scope: "full", vault: "http://localhost:1940" });
    vi.stubGlobal("WebSocket", FakeVaultSocket as unknown as typeof WebSocket);
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("Rail + LensStrip + an open NavSheet under one provider: ONE dateviews subscription", async () => {
    await renderWithClient(
      <>
        <Rail />
        <LensStrip />
        <NavSheet open onClose={() => {}} />
      </>,
    );
    await waitFor(() => expect(dateviewsSubs().length).toBeGreaterThan(0));
    // Flush the microtask-queued snapshots so any late subscriber has fired.
    await new Promise((r) => setTimeout(r, 0));
    expect(dateviewsSubs().length).toBe(1);
  });

  it("opening the NavSheet later opens NO new subscription (one ☰ tap used to stream the whole vault)", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (open: boolean) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <NavBandsProvider>
            <Rail />
            <NavSheet open={open} onClose={() => {}} />
          </NavBandsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    let view!: RenderResult;
    await act(async () => {
      view = render(ui(false));
    });
    await waitFor(() => expect(dateviewsSubs().length).toBe(1));
    const socketsBeforeOpen = openedSockets.length;

    await act(async () => {
      view.rerender(ui(true));
    });
    // The sheet really mounted (bands and all)…
    expect(screen.getByRole("dialog", { name: /^menu$/i })).toBeInTheDocument();
    // …without a single new socket: it reads the provider's model.
    expect(openedSockets.length).toBe(socketsBeforeOpen);
  });

  it("a projection outside the provider throws — it can't quietly re-open its own vault stream", () => {
    // React logs the render error before rethrowing; keep the output clean.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    expect(() =>
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <Rail />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    ).toThrow(/NavBandsProvider/);
    quiet.mockRestore();
  });
});
