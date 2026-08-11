import { BottomTabBar } from "@/components/BottomTabBar";
import { LensStrip } from "@/components/LensStrip";
import { NavDrawer } from "@/components/NavDrawer";
import { NavSheet } from "@/components/NavSheet";
import { Rail } from "@/components/Rail";
import { SpeedDial } from "@/components/SpeedDial";
import { HAS_USER_NOTE_PAGE } from "@/lib/home/use-has-user-note";
import { NavBandsProvider } from "@/lib/nav/model";
import { saveToken } from "@/lib/vault/storage";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  type RenderResult,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A test-only trigger for a route change, standing in for navigation that did
// not originate from one of the drawer's own rows.
function GoElsewhere({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      go-elsewhere
    </button>
  );
}

// Contract test (notes#147, re-homed to Rail↔BottomTabBar in Phase 3a; band
// parity added in W2-5; AMENDED from two bands to THREE when the tablet
// NavDrawer landed): at every viewport EXACTLY ONE primary-navigation
// projection shows. What changed in the amendment is the number of bands, not
// the invariant.
//
//   BAND      WIDTH        PROJECTION                      GATE
//   phone     <768px       BottomTabBar + modal NavSheet    `md:hidden`
//   tablet    768–1023px   the docked NavDrawer             `hidden md:flex lg:hidden`
//   desktop   >=1024px     the Rail                        `hidden lg:flex`
//
// WHY the amendment (the gap it closes): the contract used to be BINARY — Rail
// at lg+, BottomTabBar + NavSheet below it — so 768–1023px, i.e. every iPad in
// portrait, got a phone's treatment: NO persistent nav at all, tap ☰ for a
// modal bottom sheet. The old version of this test pinned that binary shape
// deliberately, so widening it is a real amendment and not a bug fix; it is
// intentional and approved. The failure mode the old test guarded — ONE side
// drifting to `md:` and leaving 768–1023px with no primary nav — is still
// guarded, and now by construction rather than by a hand-written "never `md:`"
// blacklist: the three-band sweep below computes what is visible in each band
// and fails on both an empty band and a doubled one.
//
// NOT counted as a primary-nav projection: the LensStrip (an on-surface filter
// control that spans phone AND tablet — see its own clause below) and the
// SpeedDial (a capture affordance, not navigation — its own clause too).
//
// JSDOM can't compute layout, so visibility is resolved at the class-name
// level by `visibleAt()` below, which models Tailwind's min-width cascade.
// `visibleAt` has its own positive/negative controls as the first test in the
// file: if those fail, the resolver is broken and every verdict below it is
// worthless.

// ---------------------------------------------------------------------------
// The class-level visibility resolver.
// ---------------------------------------------------------------------------

type Band = "phone" | "tablet" | "desktop";
const BANDS: Band[] = ["phone", "tablet", "desktop"];

/** Which Tailwind variants are in force in each band (min-width = cumulative). */
const ACTIVE_VARIANTS: Record<Band, string[]> = {
  phone: ["base"],
  tablet: ["base", "md"],
  desktop: ["base", "md", "lg"],
};
/** Cascade order — a later variant's rule wins in the generated stylesheet. */
const VARIANT_RANK: Record<string, number> = { base: 0, md: 1, lg: 2 };

/** Only `md:`/`lg:` are modelled; `ONLY_KNOWN_VARIANTS` below pins that. */
const DISPLAY_UTILITY = /^(?:(md|lg):)?(hidden|flex|block|grid|inline-flex|inline-block)$/;
/**
 * Any responsive display variant this resolver does NOT model — named
 * breakpoints other than md/lg, container/print variants, AND arbitrary ones
 * (`min-[900px]:hidden`, `max-[820px]:flex`). Without this guard a gate the
 * resolver silently ignores would read as "no gate", i.e. a false green.
 */
const UNMODELLED_DISPLAY_VARIANT =
  /(?:\b(?:sm|xl|2xl|max-\w+|print|@\w+)|\[[^\]]+\]):(?:hidden|flex|block|grid|inline-flex|inline-block)\b/;

/** The winning `display` for a className in a given band. */
function displayAt(className: string, band: Band): string {
  const active = ACTIVE_VARIANTS[band];
  // No display utility at all ⇒ the element's own default (block for
  // div/nav/aside/header), which is visible.
  let winner = { rank: -1, value: "element-default" };
  for (const cls of className.trim().split(/\s+/)) {
    const match = DISPLAY_UTILITY.exec(cls);
    if (!match) continue;
    const variant = match[1] ?? "base";
    if (!active.includes(variant)) continue;
    const rank = VARIANT_RANK[variant];
    if (rank >= winner.rank) winner = { rank, value: match[2] };
  }
  return winner.value;
}

function visibleAt(className: string, band: Band): boolean {
  return displayAt(className, band) !== "hidden";
}

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

// The drawer's two widths — 56px closed, 288px open — carry NO safe-area
// inset of their own: `body` already pays `padding-left:
// env(safe-area-inset-left)` once for every normal-flow element
// (src/styles/index.css), and this drawer is `position: sticky` in normal
// flow, same as the Rail. Baking the inset into the width TOO would
// double-pay it — on a notched device in landscape (≥768px CSS px lands in
// the tablet band) the rail would render wider than its design width and the
// open drawer would eat extra content it never needed. Do not add the inset
// back here if a future regression makes these fail — fix the drawer, not
// the test.
const CLOSED_WIDTH = /\bw-14\b/;
const OPEN_WIDTH = /\bw-72\b/;

/** Render the drawer and slide it out — the docked panel only exists open. */
async function openDrawer(container: HTMLElement): Promise<void> {
  const handle = within(container).getByRole("button", { name: /open the navigation drawer/i });
  await act(async () => {
    fireEvent.click(handle);
  });
}

describe("the three-band navigation contract (notes#147, amended for tablet)", () => {
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

  // -------------------------------------------------------------------------
  // Control first: the resolver every verdict below depends on.
  // -------------------------------------------------------------------------

  it("CONTROL — the class-level visibility resolver models Tailwind's min-width cascade", () => {
    // Desktop gate (the Rail's).
    expect(visibleAt("hidden lg:flex", "phone")).toBe(false);
    expect(visibleAt("hidden lg:flex", "tablet")).toBe(false);
    expect(visibleAt("hidden lg:flex", "desktop")).toBe(true);
    // Tablet-band gate (the NavDrawer's) — the one shape the old two-band
    // contract had no way to express.
    expect(visibleAt("hidden md:flex lg:hidden", "phone")).toBe(false);
    expect(visibleAt("hidden md:flex lg:hidden", "tablet")).toBe(true);
    expect(visibleAt("hidden md:flex lg:hidden", "desktop")).toBe(false);
    // Phone gate (the bar's / the sheet's) — `md:hidden` keeps biting at lg.
    expect(visibleAt("fixed inset-x-0 md:hidden", "phone")).toBe(true);
    expect(visibleAt("fixed inset-x-0 md:hidden", "tablet")).toBe(false);
    expect(visibleAt("fixed inset-x-0 md:hidden", "desktop")).toBe(false);
    // No display utility ⇒ the element default, which is visible everywhere.
    expect(BANDS.map((b) => visibleAt("border-t border-border", b))).toEqual([true, true, true]);
    // And the OLD two-band gate, to show what the amendment actually moved:
    // `lg:hidden` on the bar left the tablet band sharing the phone's
    // projection, which is exactly the gap the drawer closes.
    expect(visibleAt("fixed inset-x-0 lg:hidden", "tablet")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // The invariant itself.
  // -------------------------------------------------------------------------

  /** Root className of every primary-nav projection, by surface name. */
  async function projectionRoots(): Promise<Record<string, string>> {
    const { container: railC } = await renderWithClient(<Rail />);
    const { container: drawerC } = await renderWithClient(<NavDrawer />);
    const { container: barC } = await renderWithClient(<BottomTabBar />);
    const { container: sheetC } = await renderWithClient(<NavSheet open onClose={() => {}} />);

    const rail = railC.querySelector("aside");
    const drawer = drawerC.querySelector('[data-nav-projection="drawer"]');
    const bar = barC.querySelector('nav[aria-label="Primary"]');
    const sheet = sheetC.firstElementChild;

    expect(rail, "Rail <aside> must render when a vault is active").not.toBeNull();
    expect(drawer, "NavDrawer root must render when a vault is active").not.toBeNull();
    expect(bar, "BottomTabBar primary nav must exist when a vault is active").not.toBeNull();
    expect(sheet, "NavSheet must render when open").not.toBeNull();

    return {
      rail: rail?.className ?? "",
      drawer: drawer?.className ?? "",
      tabbar: bar?.className ?? "",
      sheet: sheet?.className ?? "",
    };
  }

  /** Which band each nav surface belongs to. */
  const OWNER: Record<string, Band> = {
    tabbar: "phone",
    sheet: "phone",
    drawer: "tablet",
    rail: "desktop",
  };

  it("EXACTLY ONE projection per band — no empty band, no doubled band", async () => {
    const roots = await projectionRoots();

    for (const band of BANDS) {
      const visible = Object.keys(roots).filter((name) => visibleAt(roots[name], band));
      const owners = [...new Set(visible.map((name) => OWNER[name]))];
      // Something must carry navigation at every width — an empty set is the
      // 768–1023px hole this amendment exists to close.
      expect(visible, `${band}: some primary nav must be visible`).not.toEqual([]);
      // …and everything visible must belong to ONE band's projection: no
      // tablet drawer beside a phone bar, no rail beside a drawer.
      expect(owners, `${band}: exactly one projection may show`).toEqual([band]);
    }
  });

  it("the gates are exactly the three the contract names (and only md:/lg: variants)", async () => {
    const roots = await projectionRoots();

    // Desktop unchanged by the amendment.
    expect(roots.rail).toMatch(/\bhidden\b/);
    expect(roots.rail).toMatch(/\blg:flex\b/);
    expect(roots.rail).not.toMatch(/\bmd:(?:flex|hidden)\b/);
    // The tablet band: visible from md, gone again at lg.
    expect(roots.drawer).toMatch(/\bhidden\b/);
    expect(roots.drawer).toMatch(/\bmd:flex\b/);
    expect(roots.drawer).toMatch(/\blg:hidden\b/);
    // The phone band: both surfaces yield at md now, not at lg.
    expect(roots.tabbar).toMatch(/\bmd:hidden\b/);
    expect(roots.tabbar).not.toMatch(/\blg:hidden\b/);
    expect(roots.sheet).toMatch(/\bmd:hidden\b/);
    expect(roots.sheet).not.toMatch(/\blg:hidden\b/);

    // CONTROL for the resolver's blind spot: a gate on a breakpoint it does
    // not model (`sm:`, `xl:`, `min-[900px]:`, …) would be silently ignored
    // above, so pin that none of the roots uses one…
    for (const [name, className] of Object.entries(roots)) {
      expect(className, `${name}: unmodelled responsive display variant`).not.toMatch(
        UNMODELLED_DISPLAY_VARIANT,
      );
    }
    // …and that the guard itself actually bites (a regex that matched nothing
    // would pass the loop above vacuously).
    expect("hidden min-[900px]:flex").toMatch(UNMODELLED_DISPLAY_VARIANT);
    expect("hidden sm:flex").toMatch(UNMODELLED_DISPLAY_VARIANT);
    expect("hidden md:flex lg:hidden").not.toMatch(UNMODELLED_DISPLAY_VARIANT);
  });

  it("the tablet band (768–1023px) is the drawer's alone — the hole is closed", async () => {
    const roots = await projectionRoots();
    expect(visibleAt(roots.drawer, "tablet")).toBe(true);
    expect(visibleAt(roots.rail, "tablet")).toBe(false);
    expect(visibleAt(roots.tabbar, "tablet")).toBe(false);
    expect(visibleAt(roots.sheet, "tablet")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // The drawer's own behaviour — the affordance the amendment buys.
  // -------------------------------------------------------------------------

  it("the drawer's handle is on screen AT REST — nav is discoverable without tapping ☰", async () => {
    const { container } = await renderWithClient(<NavDrawer />);
    const root = container.querySelector('[data-nav-projection="drawer"]');
    expect(root).not.toBeNull();

    // Nothing has been tapped: the drawer is closed…
    expect(root?.getAttribute("data-drawer-open")).toBe("false");
    expect(root?.className).toMatch(CLOSED_WIDTH); // 56px slim edge rail
    // …and yet the handle is already there, in a container that IS visible in
    // the tablet band (this is the whole point — the old tablet had nothing).
    expect(visibleAt(root?.className ?? "", "tablet")).toBe(true);
    const handle = within(container).getByRole("button", {
      name: /open the navigation drawer/i,
    });
    expect(handle).toBeInTheDocument();
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    // Touch-first: a 44px square (h-11/w-11 = 2.75rem). jsdom can't measure,
    // so the sizing utility is the assertion.
    expect(handle.className).toMatch(/\bh-11\b/);
    expect(handle.className).toMatch(/\bw-11\b/);
    // The landmark is permanent, so "jump to navigation" lands on the handle
    // rather than on nothing in the band where this is the only nav there is.
    const landmark = within(container).getByRole("navigation", { name: /vault navigation/i });
    expect(landmark).toContainElement(handle);
    // Closed means closed: no bands, no rooms leaking into the tab order.
    expect(container.querySelectorAll("[data-nav-band]").length).toBe(0);
    expect(container.querySelector("#nav-drawer-panel")).toBeNull();
  });

  it("tapping the handle DOCKS the panel beside the content (reflow, not an overlay)", async () => {
    const { container } = await renderWithClient(<NavDrawer />);
    await openDrawer(container);

    const root = container.querySelector('[data-nav-projection="drawer"]');
    expect(root?.getAttribute("data-drawer-open")).toBe("true");
    expect(root?.className).toMatch(OPEN_WIDTH); // 288px docked panel
    expect(root?.className).not.toMatch(CLOSED_WIDTH);
    // No left-inset padding here: body single-pays it for every normal-flow
    // element on the page (including this sticky-in-flow drawer), so the
    // drawer must not add its own `pl-[env(...)]` on top — that would
    // double-pay the inset on a notched device in landscape.
    expect(root?.className).not.toMatch(/pl-\[env\(safe-area-inset-left\)\]/);
    // Docked = an in-flow flex sibling of the content column, so the content
    // reflows. NOT `fixed`/`absolute`, and NOT the sheet's `inset-0` overlay.
    expect(root?.className).toMatch(/\bsticky\b/);
    expect(root?.className).toMatch(/\bshrink-0\b/);
    expect(root?.className).not.toMatch(/\b(?:fixed|absolute)\b/);
    expect(root?.className).not.toMatch(/\binset-0\b/);
    // The disclosed panel really mounted, with the rooms in it, and the handle
    // points at it.
    const panel = container.querySelector("#nav-drawer-panel");
    expect(panel).not.toBeNull();
    const handle = within(container).getByRole("button", { name: /close the navigation drawer/i });
    expect(handle.getAttribute("aria-controls")).toBe("nav-drawer-panel");
    expect(container.querySelectorAll("[data-nav-band]").length).toBeGreaterThan(0);
    // And it is NOT a modal: no scrim, no dialog semantics — that is what
    // separates it from the NavSheet, which keeps both.
    expect(within(container).queryByRole("dialog")).toBeNull();
    expect(within(container).queryByRole("button", { name: /close menu/i })).toBeNull();
  });

  it("tapping the handle again slides it back in", async () => {
    const { container } = await renderWithClient(<NavDrawer />);
    await openDrawer(container);
    const close = within(container).getByRole("button", {
      name: /close the navigation drawer/i,
    });
    await act(async () => {
      fireEvent.click(close);
    });

    const root = container.querySelector('[data-nav-projection="drawer"]');
    expect(root?.getAttribute("data-drawer-open")).toBe("false");
    expect(root?.className).toMatch(CLOSED_WIDTH);
    expect(container.querySelectorAll("[data-nav-band]").length).toBe(0);
    // The handle survived the round trip — same button, so keyboard focus is
    // not thrown to the body on every toggle.
    expect(
      within(container).getByRole("button", { name: /open the navigation drawer/i }),
    ).toBeInTheDocument();
  });

  it("Escape slides it in too, and tapping a room closes it (a docked panel must not eat the content column)", async () => {
    const { container } = await renderWithClient(<NavDrawer />);
    await openDrawer(container);
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(
      container.querySelector('[data-nav-projection="drawer"]')?.getAttribute("data-drawer-open"),
    ).toBe("false");

    await openDrawer(container);
    const room = container.querySelector<HTMLElement>('a[data-nav-item="tags"]');
    expect(room, "the Tags room must be in the drawer").not.toBeNull();
    await act(async () => {
      room?.click();
    });
    expect(
      container.querySelector('[data-nav-projection="drawer"]')?.getAttribute("data-drawer-open"),
    ).toBe("false");
  });

  it("navigation from elsewhere closes the drawer via the pathname effect — back/forward or another in-app link must not leave an open panel eating the destination", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let result!: RenderResult;
    await act(async () => {
      result = render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/"]}>
            <NavBandsProvider>
              <NavDrawer />
            </NavBandsProvider>
            <GoElsewhere to="/tags" />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    await openDrawer(result.container);
    await act(async () => {
      fireEvent.click(within(result.container).getByRole("button", { name: /go-elsewhere/i }));
    });

    const root = result.container.querySelector('[data-nav-projection="drawer"]');
    expect(root?.getAttribute("data-drawer-open")).toBe("false");
    expect(root?.className).toMatch(CLOSED_WIDTH);
  });

  it("Escape hands focus back to the handle — the panel it unmounts must not drop it on <body>", async () => {
    const { container } = await renderWithClient(<NavDrawer />);
    await openDrawer(container);
    // Put focus INSIDE the panel, where a keyboard user would have it.
    const room = within(container).getByRole("link", { name: /^tags$/i });
    room.focus();
    expect(document.activeElement).toBe(room);

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    // Closed, and focus is on the element the drawer collapsed INTO — not on
    // the body, which would make a keyboard user tab in from the top again.
    const handle = within(container).getByRole("button", { name: /open the navigation drawer/i });
    expect(document.activeElement).toBe(handle);
  });

  it("Escape from OUTSIDE the drawer closes it without stealing the caret", async () => {
    const { container } = await renderWithClient(<NavDrawer />);
    await openDrawer(container);
    // Something else on the page owns focus — a field on the surface behind.
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    outside.focus();

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(
      container.querySelector('[data-nav-projection="drawer"]')?.getAttribute("data-drawer-open"),
    ).toBe("false");
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("an Escape already handled by an overlay above it leaves the drawer open", async () => {
    const { container } = await renderWithClient(<NavDrawer />);
    await openDrawer(container);

    // What the command palette (opened from the drawer's own Search) does with
    // its own Escape: handles it, and marks it handled.
    await act(async () => {
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
        bubbles: true,
      });
      event.preventDefault();
      document.dispatchEvent(event);
    });

    expect(
      container.querySelector('[data-nav-projection="drawer"]')?.getAttribute("data-drawer-open"),
    ).toBe("true");
  });

  it("the drawer's rows are TOUCH scale (>=44px), not the Rail's mouse scale", async () => {
    const { container: drawerC } = await renderWithClient(<NavDrawer />);
    await openDrawer(drawerC);
    const { container: railC } = await renderWithClient(<Rail />);

    const drawerRow = drawerC.querySelector('a[data-nav-item="tags"]');
    const railRow = railC.querySelector('a[data-nav-item="tags"]');
    expect(drawerRow).not.toBeNull();
    expect(railRow).not.toBeNull();
    // py-2.5 (10px) + text-base (24px line box) = 44px, the NavSheet's proven
    // thumb scale…
    expect(drawerRow?.className).toMatch(/\bpy-2\.5\b/);
    expect(drawerRow?.className).toMatch(/\btext-base\b/);
    // …and pointedly not the rail's py-2 / text-sm (36px) mouse rows.
    expect(railRow?.className).toMatch(/\bpy-2\b/);
    expect(railRow?.className).toMatch(/\btext-sm\b/);
  });

  it("the drawer renders nothing with no active vault (same rule as the Rail)", async () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    const { container } = await renderWithClient(<NavDrawer />);
    expect(container.querySelector('[data-nav-projection="drawer"]')).toBeNull();
  });

  it("Rail renders nothing with no active vault (the no-vault desktop view is full-width Landing)", async () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    const { container } = await renderWithClient(<Rail />);
    expect(container.querySelector("aside")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // The clauses about surfaces that are NOT primary-nav projections.
  // -------------------------------------------------------------------------

  // LZ-5 + the tablet amendment: the on-surface lens strip spans BOTH
  // sub-desktop bands (`lg:hidden`, unchanged). It is a filter control, not a
  // room list, so it is not one of the three projections counted above — and
  // on a tablet, where the drawer rests CLOSED, it is what keeps lens
  // switching to one tap. At lg+ the Rail is PERMANENT chrome and owns the
  // lens set, which is why the strip yields there and only there (rendering
  // the lens set twice against a permanent rail is the redundancy D2
  // rejected).
  it("LensStrip spans phone+tablet (lg:hidden) and yields to the Rail alone", async () => {
    const { container } = await renderWithClient(<LensStrip />);
    const strip = container.querySelector('nav[aria-label="Lenses"]');
    expect(strip, "LensStrip must render when a vault is active").not.toBeNull();
    const className = strip?.className ?? "";
    expect(className).toMatch(/\blg:hidden\b/);
    expect(className).not.toMatch(/\bmd:hidden\b/);
    expect(visibleAt(className, "phone")).toBe(true);
    expect(visibleAt(className, "tablet")).toBe(true);
    expect(visibleAt(className, "desktop")).toBe(false);
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

  // W2-9, re-gated by the tablet amendment: the capture affordances split by
  // form factor, and the split follows the BOTTOM BAR, not the rail. The bar
  // owns the raised centre [+] on a phone; the SpeedDial covers everything
  // above it — including the tablet band now, because the bar is `md:hidden`
  // there and the NavDrawer (like the Rail) carries no capture verb. Leaving
  // the dial at `lg:` would have left a tablet with no way to write.
  it("SpeedDial covers every band the bottom bar's [+] does not (hidden md:block), and the phone [+] still goes straight to /new", async () => {
    const { container: dialContainer } = await renderWithClient(<SpeedDial />);
    const { container: barContainer } = await renderWithClient(<BottomTabBar />);

    const dial = dialContainer.firstElementChild;
    expect(dial, "SpeedDial must render when a vault is active").not.toBeNull();
    const dialClass = dial?.className ?? "";
    expect(dialClass).toMatch(/\bhidden\b/);
    expect(dialClass).toMatch(/\bmd:block\b/);

    const centerCapture = barContainer.querySelector('a[aria-label="New note"]');
    expect(centerCapture, "the phone centre [+] must exist").not.toBeNull();
    expect(centerCapture?.getAttribute("href")).toBe("/new");

    // Exactly one capture affordance per band — the same shape of invariant as
    // the nav one, on the verb instead of the rooms.
    const barClass = barContainer.querySelector('nav[aria-label="Primary"]')?.className ?? "";
    for (const band of BANDS) {
      const captures = [visibleAt(dialClass, band), visibleAt(barClass, band)].filter(Boolean);
      expect(captures, `${band}: exactly one capture affordance`).toHaveLength(1);
    }
  });

  // -------------------------------------------------------------------------
  // Band parity (W2-5, the F14 guard): ALL THREE projections render the same
  // bands, items, labels, hrefs — in the same order. Three projections is
  // three chances to drift, so the amendment widens this half of the contract
  // too rather than leaving the drawer unpinned.
  // -------------------------------------------------------------------------

  function collectNav(container: HTMLElement): string[][] {
    return Array.from(container.querySelectorAll("[data-nav-band] a[data-nav-item]")).map((a) => [
      a.closest("[data-nav-band]")?.getAttribute("data-nav-band") ?? "",
      a.getAttribute("data-nav-item") ?? "",
      a.textContent ?? "",
      a.getAttribute("href") ?? "",
    ]);
  }

  it("Rail, NavDrawer and NavSheet render IDENTICAL bands/items/order/labels from the one nav model (F14)", async () => {
    const { container: railContainer } = await renderWithClient(<Rail />);
    const { container: drawerContainer } = await renderWithClient(<NavDrawer />);
    await openDrawer(drawerContainer);
    const { container: sheetContainer } = await renderWithClient(
      <NavSheet open onClose={() => {}} />,
    );

    const railNav = collectNav(railContainer);
    const drawerNav = collectNav(drawerContainer);
    const sheetNav = collectNav(sheetContainer).filter(([band]) => band !== "switcher");

    expect(railNav.length).toBeGreaterThan(0);
    expect(sheetNav).toEqual(railNav);
    expect(drawerNav).toEqual(railNav);

    // And the parity includes the F14 headliners: the manager zone's rooms.
    const ids = railNav.map(([, id]) => id);
    expect(ids).toContain("vaults");
    expect(ids).toContain("account");
    expect(ids).toContain("tags");
    expect(ids).toContain("calendar");

    // LZ-2: EVERY projection carries the lens band and the Explore band, with
    // the same items in the same order — the lens/destination split can't
    // exist on one form factor only.
    for (const nav of [railNav, drawerNav, sheetNav]) {
      expect(nav.filter(([band]) => band === "notes").map(([, id]) => id)).toEqual([
        "recent",
        "notes",
        "pinned",
        "archive",
      ]);
      expect(nav.filter(([band]) => band === "explore").map(([, id]) => id)).toEqual([
        "calendar",
        "tags",
        "activity",
      ]);
    }
    // The lens targets are today's exact URLs (LENS-SPEC §2, zero migration).
    const hrefById = new Map(railNav.map(([, id, , href]) => [id, href]));
    expect(hrefById.get("recent")).toBe("/");
    expect(hrefById.get("notes")).toBe("/notes");
    expect(hrefById.get("pinned")).toBe("/notes?view=pinned");
    expect(hrefById.get("archive")).toBe("/notes?view=archived");
  });

  it("band parity holds with the Map earned too (the gate flips on ALL THREE projections — F14)", async () => {
    useVaultStore.setState({
      vaults: {
        a: makeVault({ id: "a", url: "http://localhost:1940", name: "default" }),
        b: makeVault({ id: "b", url: "http://localhost:1941", name: "journal" }),
      },
      activeVaultId: "a",
    });
    const { container: railContainer } = await renderWithClient(<Rail />);
    const { container: drawerContainer } = await renderWithClient(<NavDrawer />);
    await openDrawer(drawerContainer);
    const { container: sheetContainer } = await renderWithClient(
      <NavSheet open onClose={() => {}} />,
    );

    const railNav = collectNav(railContainer);
    const drawerNav = collectNav(drawerContainer);
    const sheetNav = collectNav(sheetContainer).filter(([band]) => band !== "switcher");
    // Earned Map lands in EXPLORE (it's a destination, not a lens) — on all.
    expect(railNav.filter(([band]) => band === "explore").map(([, id]) => id)).toEqual([
      "calendar",
      "tags",
      "activity",
      "map",
    ]);
    expect(sheetNav).toEqual(railNav);
    expect(drawerNav).toEqual(railNav);
  });

  it("the drawer's foot carries the utility trio the phone sheet owns (they had no home above the sheet)", async () => {
    const { container } = await renderWithClient(<NavDrawer />);
    await openDrawer(container);
    const foot = container.querySelector('[data-nav-band="foot"]');
    expect(foot).not.toBeNull();
    // The drawer is h-dvh, so body-level safe-area padding is outside this
    // box. The foot pays the bottom inset itself; when env() resolves to zero,
    // calc(0.75rem + 0) is the existing p-3 spacing.
    expect(foot?.className).toMatch(/pb-\[calc\(0\.75rem\+env\(safe-area-inset-bottom\)\)\]/);
    // Settings, as in every projection…
    expect(foot?.querySelector('a[data-nav-item="settings"]')).not.toBeNull();
    // …plus the text-size and theme controls. Before the amendment these
    // lived ONLY in the NavSheet, so a tablet that no longer gets the sheet
    // would have lost them entirely (the Rail never carried them either).
    expect(within(foot as HTMLElement).getByRole("button", { name: /text size/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The OTHER half of the contract (app#110): everything above is CSS-only —
// `hidden lg:flex` / `hidden md:flex lg:hidden` / `md:hidden` hide a
// projection without unmounting it, so all three projections (and the sheet,
// when open) are live React trees at every viewport width. The nav model USED
// to carry a full-vault live subscription (`useNotesForDateViews`, limit=5000,
// ~1.25 MiB per socket at 2.6k notes), so per-projection derivation streamed
// the vault once per projection — ×2 at boot, a third full stream on one ☰
// tap. Two fixes, both pinned here:
//   - Finding A: the model derives in ONE place (`NavBandsProvider`);
//     projections can only read the context, and read outside it THROWS.
//   - Finding B piece 1: the model's only read of that stream was the
//     `hasUserAuthoredNote` boolean, now a BOUNDED existence check
//     (`use-has-user-note.ts`) — so the nav model opens ZERO full-vault
//     subscriptions at all, on every route.
// The tablet NavDrawer joins this half too: a third projection is a third
// would-be payer, and it reads the context like the rest.
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

  /** URLs the fetch mock served — the bounded probe shows up here, not as a socket. */
  const fetchedUrls = () =>
    (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
  const probeFetches = () =>
    fetchedUrls().filter(
      (u) => u.includes("exclude_tag=guide") && u.includes(`limit=${HAS_USER_NOTE_PAGE}`),
    );

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

  it("Rail + NavDrawer + LensStrip + an open NavSheet under one provider: ZERO dateviews subscriptions, ONE bounded probe", async () => {
    await renderWithClient(
      <>
        <Rail />
        <NavDrawer />
        <LensStrip />
        <NavSheet open onClose={() => {}} />
      </>,
    );
    // The first-note boolean arrives as a bounded fetch (tag half pushed
    // server-side)…
    await waitFor(() => expect(probeFetches().length).toBeGreaterThan(0));
    // Flush the microtask-queued snapshots so any late subscriber has fired.
    await new Promise((r) => setTimeout(r, 0));
    // …fired once for the whole tree, and the full-vault stream is GONE: no
    // projection (nor the model itself) opens a limit=5000 subscription.
    expect(probeFetches().length).toBe(1);
    expect(dateviewsSubs().length).toBe(0);
  });

  it("sliding the drawer OUT opens NO new subscription (it reads the provider, like every projection)", async () => {
    const { container } = await renderWithClient(
      <>
        <Rail />
        <NavDrawer />
      </>,
    );
    await waitFor(() => expect(probeFetches().length).toBeGreaterThan(0));
    const socketsBeforeOpen = openedSockets.length;
    const probesBeforeOpen = probeFetches().length;

    await act(async () => {
      fireEvent.click(
        within(container).getByRole("button", { name: /open the navigation drawer/i }),
      );
    });

    // The panel really mounted (bands and all)…
    expect(container.querySelector("#nav-drawer-panel")).not.toBeNull();
    // …without a single new socket or probe.
    expect(openedSockets.length).toBe(socketsBeforeOpen);
    expect(probeFetches().length).toBe(probesBeforeOpen);
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
    // Settled = the model's bounded probe has fired (there is no dateviews
    // socket to wait for anymore).
    await waitFor(() => expect(probeFetches().length).toBeGreaterThan(0));
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
    const outside = (ui: ReactNode) =>
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>{ui}</MemoryRouter>
        </QueryClientProvider>,
      );
    expect(() => outside(<Rail />)).toThrow(/NavBandsProvider/);
    // The new projection is held to the same rule.
    expect(() => outside(<NavDrawer />)).toThrow(/NavBandsProvider/);
    quiet.mockRestore();
  });
});
