import { Header } from "@/components/Header";
import { NavBandsProvider } from "@/lib/nav/model";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A test-only trigger for a route change, standing in for a nav-link tap.
function GoElsewhere({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      go-elsewhere
    </button>
  );
}

function makeVault(partial: Partial<VaultRecord> & Pick<VaultRecord, "id" | "url">): VaultRecord {
  return {
    name: "",
    issuer: partial.url,
    clientId: "client-test",
    scope: "full",
    addedAt: "2026-04-18T00:00:00.000Z",
    lastUsedAt: "2026-04-18T00:00:00.000Z",
    ...partial,
  };
}

function renderHeader() {
  // The header hosts the VaultSwitcher, whose plan/account reads are TanStack
  // queries (lazy — enabled only while its panel is open), so the tree needs a
  // QueryClient like the Rail's tests.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {/* The ☰ opens the NavSheet, which reads the nav model from
            context (app#110). */}
        <NavBandsProvider>
          <Header />
        </NavBandsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function seedVault() {
  useVaultStore.setState({
    vaults: { a: makeVault({ id: "a", url: "http://localhost:1940", name: "default" }) },
    activeVaultId: "a",
  });
}

describe("Header vault label fallback", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    // Stub fetch so the popover's well-known fetcher doesn't escape into a
    // real network call during component render.
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ vaults: [], services: [] }),
        }) as Response,
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    vi.restoreAllMocks();
  });

  it("renders the vault name when present", () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "http://localhost:1940", name: "default" }) },
      activeVaultId: "a",
    });
    renderHeader();
    expect(screen.getByRole("button", { name: /active vault: default/i })).toBeInTheDocument();
  });

  it("falls back to the URL host when name is empty", () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "https://vault.example.com:8443/api", name: "" }) },
      activeVaultId: "a",
    });
    renderHeader();
    expect(
      screen.getByRole("button", { name: /active vault: vault\.example\.com:8443/i }),
    ).toBeInTheDocument();
  });

  it("falls back to the raw URL when both name and URL are unparseable", () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "not a url", name: "" }) },
      activeVaultId: "a",
    });
    renderHeader();
    expect(screen.getByRole("button", { name: /active vault: not a url/i })).toBeInTheDocument();
  });
});

// W2-5: the header is the mobile/tablet top bar only — the desktop spine is
// the left Rail. The bar leads with the vault switcher pill; the old ☰
// dropdown junk-drawer (F14's mobile half) is gone — ☰ AND the pill both
// open the NavSheet, which renders the same `useNavBands()` bands as the Rail.
describe("Header mobile shell (W2-5 — NavSheet entry points)", () => {
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
  });

  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    vi.restoreAllMocks();
  });

  // Three-band amendment (notes#147): `md:hidden`, not `lg:hidden`. At md–lg
  // the NavDrawer is the spine and carries the vault switcher itself, so
  // leaving this bar up would double the switcher and leave a ☰ pointing at a
  // `md:hidden` NavSheet — a button that does nothing.
  it("is a PHONE-only top bar (md:hidden) — the NavDrawer is the tablet spine, the Rail the desktop one", () => {
    seedVault();
    const { container } = renderHeader();
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header?.className).toContain("md:hidden");
    expect(header?.className).not.toContain("lg:hidden");
  });

  it("leads with the vault switcher when a vault is connected", () => {
    seedVault();
    renderHeader();
    expect(screen.getByRole("button", { name: /active vault: default/i })).toBeInTheDocument();
  });

  it("shows the Parachute wordmark with no vault — the 'No vault connected' noise is gone (F21)", () => {
    // `/` is the signed-out arrival route, where the bar suppresses itself
    // entirely (see the test below) — Landing's own Shell renders the
    // wordmark there instead (UI-audit #8, avoiding a duplicate lockup
    // stacked at the top of the screen). Render at a representative
    // NON-arrival no-vault route to keep exercising this bar's own
    // wordmark fallback.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/add"]}>
          <NavBandsProvider>
            <Header />
          </NavBandsProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("link", { name: /^parachute$/i })).toBeInTheDocument();
    expect(screen.queryByText(/no vault connected/i)).not.toBeInTheDocument();
  });

  it("suppresses its own bar on the signed-out arrival route (`/`, no vault) — Landing's Shell owns the wordmark there (UI-audit #8)", () => {
    const { container } = renderHeader();
    expect(container.querySelector("header")).toBeNull();
  });

  it("☰ opens the NavSheet carrying BOTH zones — Tags and Vaults reachable on mobile (F14)", async () => {
    seedVault();
    renderHeader();
    const menuButton = screen.getByRole("button", { name: /open menu/i });
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog", { name: /^menu$/i })).not.toBeInTheDocument();

    fireEvent.click(menuButton);
    expect(menuButton).toHaveAttribute("aria-expanded", "true");
    const sheet = within(await screen.findByRole("dialog", { name: /^menu$/i }));

    // The two zones, by name.
    expect(sheet.getByText(/^your notes$/i)).toBeInTheDocument();
    expect(sheet.getByText(/^your parachute$/i)).toBeInTheDocument();
    // The F14 headliners — reachable on mobile for the first time.
    expect(sheet.getByRole("link", { name: /^tags$/i })).toHaveAttribute("href", "/tags");
    expect(sheet.getByRole("link", { name: /^vaults$/i })).toHaveAttribute("href", "/vaults");
    // The rest of the old ☰ vocabulary, now living in the bands + foot.
    expect(sheet.getByRole("link", { name: /^calendar$/i })).toHaveAttribute("href", "/calendar");
    expect(sheet.getByRole("link", { name: /^activity$/i })).toHaveAttribute("href", "/activity");
    expect(sheet.getByRole("link", { name: /^settings$/i })).toHaveAttribute("href", "/settings");
    expect(sheet.getByRole("link", { name: /account & plan/i })).toHaveAttribute(
      "href",
      "/account",
    );
  });

  it("the vault pill opens the SAME sheet (one surface, two entry points)", async () => {
    seedVault();
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: /active vault: default/i }));
    const sheet = within(await screen.findByRole("dialog", { name: /^menu$/i }));
    // The switcher band renders inline at the top (rows, not a popover).
    expect(sheet.getByText(/on this device/i)).toBeInTheDocument();
    expect(sheet.getByText(/manage vaults/i)).toBeInTheDocument();
  });

  it("the sheet closes on scrim tap", async () => {
    seedVault();
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    await screen.findByRole("dialog", { name: /^menu$/i });
    fireEvent.click(screen.getByRole("button", { name: /close menu/i }));
    expect(screen.queryByRole("dialog", { name: /^menu$/i })).not.toBeInTheDocument();
  });

  it("the sheet closes on Escape", async () => {
    seedVault();
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    await screen.findByRole("dialog", { name: /^menu$/i });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /^menu$/i })).not.toBeInTheDocument();
  });

  it("the sheet closes on route change — a nav tap must not leave it open over the destination (§2.3)", async () => {
    seedVault();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/"]}>
          <NavBandsProvider>
            <Header />
          </NavBandsProvider>
          <GoElsewhere to="/tags" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    await screen.findByRole("dialog", { name: /^menu$/i });
    // Navigating (as tapping a band link would) changes location.pathname —
    // the owner's effect must close the sheet.
    fireEvent.click(screen.getByRole("button", { name: /go-elsewhere/i }));
    expect(screen.queryByRole("dialog", { name: /^menu$/i })).not.toBeInTheDocument();
  });
});
