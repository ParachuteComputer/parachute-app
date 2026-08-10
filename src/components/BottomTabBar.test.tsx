import { BottomTabBar } from "@/components/BottomTabBar";
import { useQuickSwitchOpen } from "@/lib/quick-switch/open-store";
import { useVaultStore } from "@/lib/vault/store";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function seedVault() {
  useVaultStore.setState({
    vaults: {
      v1: {
        id: "v1",
        url: "http://localhost:1940",
        name: "dev",
        issuer: "http://localhost:1940",
        clientId: "c",
        scope: "full",
        addedAt: "2026-04-22T00:00:00.000Z",
        lastUsedAt: "2026-04-22T00:00:00.000Z",
      },
    },
    activeVaultId: "v1",
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BottomTabBar />
    </MemoryRouter>,
  );
}

describe("BottomTabBar (LENS-SPEC §5.2 — the 3-slot bar, ratified D2)", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useQuickSwitchOpen.setState({ open: false });
    seedVault();
  });

  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useQuickSwitchOpen.setState({ open: false });
  });

  it("renders EXACTLY three slots — Notes · [+] · Search — when a vault is active", () => {
    renderAt("/");
    const nav = screen.getByRole("navigation", { name: /primary/i });
    // One surface ⇒ one surface tab. The LZ-2 interim "Recent" tab is gone;
    // lens switching lives in the on-surface LensStrip, not the bar (the
    // redundancy D2 rejected).
    expect(within(nav).getByLabelText(/^notes$/i)).toBeInTheDocument();
    expect(within(nav).queryByLabelText(/^recent$/i)).toBeNull();
    expect(within(nav).queryByLabelText(/^today$/i)).toBeNull();
    // The centre capture action (the raised + disc) and the palette entry.
    expect(within(nav).getByLabelText(/new note/i)).toBeInTheDocument();
    expect(within(nav).getByLabelText(/search/i)).toBeInTheDocument();
    // The hard count: 3 slots, no more.
    expect(nav.querySelectorAll("li")).toHaveLength(3);
  });

  it("the Notes tab goes to / (the Recent lens is the front door)", () => {
    renderAt("/settings");
    expect(screen.getByLabelText(/^notes$/i)).toHaveAttribute("href", "/");
  });

  it("no longer carries Tags or Settings tabs (they moved off the bottom bar)", () => {
    renderAt("/");
    const nav = screen.getByRole("navigation", { name: /primary/i });
    expect(within(nav).queryByLabelText(/^tags$/i)).toBeNull();
    expect(within(nav).queryByLabelText(/^settings$/i)).toBeNull();
  });

  it("does not render when no active vault", () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    renderAt("/");
    expect(screen.queryByRole("navigation", { name: /primary/i })).toBeNull();
  });

  it("is PHONE-only via md:hidden (the tablet band belongs to the NavDrawer — notes#147, three bands)", () => {
    renderAt("/");
    const nav = screen.getByRole("navigation", { name: /primary/i });
    expect(nav.className).toMatch(/\bmd:hidden\b/);
    // Guard against drifting BACK to `lg:hidden`: at 768-1023px that would put
    // this bar on screen beside the NavDrawer (`hidden md:flex lg:hidden`) —
    // two primary-nav projections in one band, which is the thing the contract
    // forbids. The gap this gate used to guard against (nothing at all in
    // 768-1023px) is now filled by the drawer, not by this bar.
    expect(nav.className).not.toMatch(/\blg:hidden\b/);
  });

  // The one surface tab lights across the WHOLE surface (§5.2): every lens
  // URL plus the drill-ins that stay under it.
  it.each(["/", "/notes", "/n/abc", "/today", "/today?date=2026-04-18"])(
    "marks Notes active on %s",
    (path) => {
      renderAt(path);
      expect(screen.getByLabelText(/^notes$/i)).toHaveAttribute("aria-current", "page");
    },
  );

  it("marks Notes active on the Pinned/Archive lenses — one surface, one tab, no separate lens tabs", () => {
    // LZ-2's interim bar lit NO tab here (Pinned/Archive weren't in the
    // 4-slot set). The 3-slot bar resolves it: `?view=` dresses are the same
    // surface, so the one surface tab claims them; WHICH lens is the
    // LensStrip's job.
    renderAt("/notes?view=pinned");
    expect(screen.getByLabelText(/^notes$/i)).toHaveAttribute("aria-current", "page");
    renderAt("/notes?view=archived");
    const tabs = screen.getAllByLabelText(/^notes$/i);
    expect(tabs.some((el) => el.getAttribute("aria-current") === "page")).toBe(true);
  });

  it("marks Notes inactive off the surface (a destination is not a lens)", () => {
    for (const path of ["/calendar", "/tags", "/activity", "/settings", "/account"]) {
      const { unmount } = renderAt(path);
      expect(screen.getByLabelText(/^notes$/i)).not.toHaveAttribute("aria-current");
      unmount();
    }
  });

  it("opens the quick-switch via the Search tab", () => {
    renderAt("/");
    expect(useQuickSwitchOpen.getState().open).toBe(false);
    fireEvent.click(screen.getByLabelText(/search/i));
    expect(useQuickSwitchOpen.getState().open).toBe(true);
  });

  it("the centre + navigates to /new in one tap (capture speed sacred — unchanged by LZ-5)", () => {
    renderAt("/");
    expect(screen.getByLabelText(/new note/i)).toHaveAttribute("href", "/new");
  });
});
