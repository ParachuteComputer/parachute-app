import { NavDrawer } from "@/components/NavDrawer";
import { NavBandsProvider } from "@/lib/nav/model";
import { useQuickSwitchOpen } from "@/lib/quick-switch/open-store";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tablet projection's own clauses live here, alongside Rail.test.tsx and
// NavSheet.test.tsx. The shared navigation-breakpoint-contract test owns the
// cross-projection sweep; this file owns behavior that only makes sense at the
// drawer boundary: its band gate, search handoff, and lens active state.

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

function seedVault() {
  useVaultStore.setState({
    vaults: { a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) },
    activeVaultId: "a",
  });
}

// The drawer is CSS-hidden outside the tablet band, never unmounted, so it
// listens for the band boundary itself (`matchMedia`, mirroring the
// `md:flex lg:hidden` breakpoints) to force-close on resize out. jsdom can't
// do real layout, so this stub hands back a `MediaQueryList`-shaped object
// whose `addEventListener("change", …)` calls are captured, letting the test
// fire a synthetic "left the band" change event by hand.
function stubTabletBandMatchMedia() {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches: true,
    media: "(min-width: 768px) and (max-width: 1023.98px)",
    onchange: null,
    addEventListener: (_type: string, listener: (e: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (e: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
  return {
    /** Simulate the viewport leaving the tablet band, in either direction. */
    leaveTabletBand: () => {
      const event = { matches: false } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    },
  };
}

async function renderDrawer(path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <NavBandsProvider>
            <NavDrawer />
          </NavBandsProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return result;
}

describe("NavDrawer (tablet projection, notes#147)", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useQuickSwitchOpen.setState({ open: false });
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ notes: [], vaults: [], services: [] }),
        }) as Response,
    ) as unknown as typeof fetch;
    seedVault();
  });

  afterEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useQuickSwitchOpen.setState({ open: false });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("is the tablet-only primary projection, with its handle present while closed", async () => {
    const { container } = await renderDrawer();
    const root = container.querySelector('[data-nav-projection="drawer"]');

    expect(root).not.toBeNull();
    expect(root?.className).toMatch(/\bhidden\b/);
    expect(root?.className).toMatch(/\bmd:flex\b/);
    expect(root?.className).toMatch(/\blg:hidden\b/);
    expect(root?.className).not.toMatch(/\blg:flex\b/);

    const landmark = within(container).getByRole("navigation", { name: /vault navigation/i });
    const handle = within(landmark).getByRole("button", {
      name: /open the navigation drawer/i,
    });
    expect(handle).toHaveAttribute("aria-expanded", "false");
    expect(landmark).toContainElement(handle);
  });

  it("uses the shared search-aware lens grammar for active rows", async () => {
    const { container } = await renderDrawer("/notes?view=pinned");
    await act(async () => {
      fireEvent.click(
        within(container).getByRole("button", { name: /open the navigation drawer/i }),
      );
    });

    expect(within(container).getByRole("link", { name: /^pinned$/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(container).getByRole("link", { name: /^all notes$/i })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("hands Search to QuickSwitch, then closes its own docked panel", async () => {
    const { container } = await renderDrawer();
    await act(async () => {
      fireEvent.click(
        within(container).getByRole("button", { name: /open the navigation drawer/i }),
      );
    });

    expect(useQuickSwitchOpen.getState().open).toBe(false);
    await act(async () => {
      fireEvent.click(within(container).getByRole("button", { name: /^search/i }));
    });

    expect(useQuickSwitchOpen.getState().open).toBe(true);
    expect(
      container.querySelector('[data-nav-projection="drawer"]')?.getAttribute("data-drawer-open"),
    ).toBe("false");
  });

  it("force-closes when the viewport leaves the tablet band (open state must not survive a resize out and back)", async () => {
    const { leaveTabletBand } = stubTabletBandMatchMedia();
    const { container } = await renderDrawer();
    await act(async () => {
      fireEvent.click(
        within(container).getByRole("button", { name: /open the navigation drawer/i }),
      );
    });

    const root = container.querySelector('[data-nav-projection="drawer"]');
    expect(root?.getAttribute("data-drawer-open")).toBe("true");
    expect(container.querySelector("#nav-drawer-panel")).not.toBeNull();

    // Leaving the band — either narrower to phone or wider to desktop — must
    // force the drawer shut. It is CSS-hidden, not unmounted, the moment the
    // band changes, so if `open` survived, resizing back into the tablet band
    // would hand the surface a docked panel it never asked for.
    await act(async () => {
      leaveTabletBand();
    });

    expect(root?.getAttribute("data-drawer-open")).toBe("false");
    expect(container.querySelector("#nav-drawer-panel")).toBeNull();
  });
});
