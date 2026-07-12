import { BottomTabBar } from "@/components/BottomTabBar";
import { NavSheet } from "@/components/NavSheet";
import { Rail } from "@/components/Rail";
import { SpeedDial } from "@/components/SpeedDial";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderResult, act, render } from "@testing-library/react";
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
        <MemoryRouter>{ui}</MemoryRouter>
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
