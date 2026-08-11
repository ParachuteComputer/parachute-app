import { AmbientMapFab } from "@/components/AmbientMapFab";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { useViewModifiedBar } from "@/lib/views/modified-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function makeVault(id: string, url: string): VaultRecord {
  return {
    id,
    url,
    name: "gardening",
    issuer: url,
    clientId: "c",
    scope: "full",
    addedAt: "2026-04-22T00:00:00.000Z",
    lastUsedAt: "2026-04-22T00:00:00.000Z",
  };
}

function renderFab(path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AmbientMapFab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AmbientMapFab", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useViewModifiedBar.setState({ shown: false });
  });
  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useViewModifiedBar.setState({ shown: false });
  });

  it("renders nothing with no active vault", () => {
    const { container } = renderFab();
    expect(container.querySelector("a")).toBeNull();
  });

  it("opens the graph when a vault is active and the Map is unearned — on BOTH form factors", () => {
    useVaultStore.setState({
      vaults: { a: makeVault("a", "http://localhost:1940") },
      activeVaultId: "a",
    });
    renderFab("/");
    const fab = screen.getByRole("link", { name: /open the relational map/i });
    expect(fab).toHaveAttribute("href", "/map");
    // Pre-earn the FAB is the ambient door everywhere — no breakpoint gate.
    expect(fab.className).not.toMatch(/\blg:hidden\b/);
  });

  // Three-band amendment (notes#147): the FAB's bottom clearance exists to
  // clear the BottomTabBar, so it tracks the BAR's gate, not the Rail's. The
  // bar is `md:hidden` since the tablet band became the NavDrawer's — holding
  // this at `lg:` would float the FAB 80px above nothing on a tablet.
  it("drops to the corner as soon as the bottom bar is gone (md:, not lg:)", () => {
    useVaultStore.setState({
      vaults: { a: makeVault("a", "http://localhost:1940") },
      activeVaultId: "a",
    });
    renderFab("/");
    const fab = screen.getByRole("link", { name: /open the relational map/i });
    // Phone: raised above the bar. From md up: the true corner.
    expect(fab.className).toMatch(/\bbottom-20\b/);
    expect(fab.className).toMatch(/\bmd:bottom-6\b/);
    expect(fab.className).not.toMatch(/\blg:bottom-6\b/);
  });

  it("is hidden on the map route itself (W2-7 rename)", () => {
    useVaultStore.setState({
      vaults: { a: makeVault("a", "http://localhost:1940") },
      activeVaultId: "a",
    });
    const { container } = renderFab("/map");
    expect(container.querySelector("a")).toBeNull();
  });

  // Views train B (review must-fix): the "View modified — Save / Revert" bar
  // docks in the same corner at the same z — the FAB yields while it's up so
  // it never paints over / steals taps from Save.
  it("yields while a view's modified bar is shown", () => {
    useVaultStore.setState({
      vaults: { a: makeVault("a", "http://localhost:1940") },
      activeVaultId: "a",
    });
    useViewModifiedBar.setState({ shown: true });
    const { container } = renderFab("/");
    expect(container.querySelector("a")).toBeNull();
  });

  it("disappears entirely once the Map is earned — the nav row takes over on BOTH form factors (W2-5 / route-map row 11)", () => {
    useVaultStore.setState({
      vaults: {
        a: makeVault("a", "http://localhost:1940"),
        b: makeVault("b", "http://localhost:1941"),
      },
      activeVaultId: "a",
    });
    const { container } = renderFab("/");
    expect(container.querySelector("a")).toBeNull();
  });
});
