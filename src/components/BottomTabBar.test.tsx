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

describe("BottomTabBar (D6 four-slot, LZ-2 interim dress)", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useQuickSwitchOpen.setState({ open: false });
    seedVault();
  });

  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useQuickSwitchOpen.setState({ open: false });
  });

  it("renders Recent · Notes · [+] · Search when a vault is active (LZ-2 relabels the D6 slots)", () => {
    renderAt("/");
    const nav = screen.getByRole("navigation", { name: /primary/i });
    // LZ-2: the `/` tab reads "Recent" — the rail's lens name — so the two
    // projections never disagree about what `/` is called (the F14 lesson).
    expect(within(nav).getByLabelText(/^recent$/i)).toBeInTheDocument();
    expect(within(nav).queryByLabelText(/^today$/i)).toBeNull();
    expect(within(nav).getByLabelText(/^notes$/i)).toBeInTheDocument();
    // The centre capture action (the raised + disc).
    expect(within(nav).getByLabelText(/new note/i)).toBeInTheDocument();
    expect(within(nav).getByLabelText(/search/i)).toBeInTheDocument();
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

  it("is hidden on lg+ viewports via lg:hidden class (matches the Rail's lg:flex gate — notes#147)", () => {
    renderAt("/");
    const nav = screen.getByRole("navigation", { name: /primary/i });
    expect(nav.className).toMatch(/\blg:hidden\b/);
    // Guard against regressing back to `md:hidden` — at 768-1023px that would
    // hide the bar while the Rail (lg:flex) is still hidden too, leaving
    // tablet users with no primary navigation.
    expect(nav.className).not.toMatch(/\bmd:hidden\b/);
  });

  it("marks Recent active on / and on a note (/n/:id stays under Recent)", () => {
    renderAt("/");
    expect(screen.getByLabelText(/^recent$/i)).toHaveAttribute("aria-current", "page");
    renderAt("/n/abc");
    const recents = screen.getAllByLabelText(/^recent$/i);
    expect(recents.some((el) => el.getAttribute("aria-current") === "page")).toBe(true);
  });

  it("marks Recent active on the day drill-in (/today?date=)", () => {
    renderAt("/today?date=2026-04-18");
    expect(screen.getByLabelText(/^recent$/i)).toHaveAttribute("aria-current", "page");
  });

  it("marks Notes active on /notes (W2-7 rename)", () => {
    renderAt("/notes");
    expect(screen.getByLabelText(/^notes$/i)).toHaveAttribute("aria-current", "page");
  });

  it("lights NO tab on the Pinned/Archive lenses — they're not in the interim 4-slot set (LZ-2)", () => {
    // The tab bar shares the nav model's matchers verbatim: /notes?view=pinned
    // is the Pinned lens (rail + NavSheet highlight Pinned), not All notes —
    // so the Notes tab must not claim it. LZ-5's 3-slot bar resolves this.
    renderAt("/notes?view=pinned");
    expect(screen.getByLabelText(/^notes$/i)).not.toHaveAttribute("aria-current");
    expect(screen.getByLabelText(/^recent$/i)).not.toHaveAttribute("aria-current");
  });

  it("opens the quick-switch via the Search tab", () => {
    renderAt("/");
    expect(useQuickSwitchOpen.getState().open).toBe(false);
    fireEvent.click(screen.getByLabelText(/search/i));
    expect(useQuickSwitchOpen.getState().open).toBe(true);
  });

  it("the centre + navigates to /new (the unified create surface)", () => {
    renderAt("/");
    expect(screen.getByLabelText(/new note/i)).toHaveAttribute("href", "/new");
  });
});
