import { NavSheet } from "@/components/NavSheet";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderResult, act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The mobile NavSheet (W2-5, DESIGN-SPEC §2.3) — the rail's bands as a bottom
// sheet, from the same `useNavBands()` model. The F14 headliners live here:
// Tags and Vaults reachable on mobile for the first time.

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
    vaults: { a: makeVault({ id: "a", url: "http://localhost:1940" }) },
    activeVaultId: "a",
  });
}

async function renderSheet(
  props: Partial<Parameters<typeof NavSheet>[0]> = {},
  path = "/",
): Promise<RenderResult> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result!: RenderResult;
  await act(async () => {
    result = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <NavSheet open onClose={() => {}} {...props} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return result;
}

describe("NavSheet (mobile projection, W2-5)", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
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
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders nothing when closed", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <NavSheet open={false} onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container.firstElementChild).toBeNull();
  });

  it("renders the rail's bands: switcher on top, all three zones, Settings foot (F14/F15)", async () => {
    await renderSheet();
    const sheet = within(screen.getByRole("dialog", { name: /^menu$/i }));

    // The hinge — the switcher band's inline rows.
    expect(sheet.getByText(/on this device/i)).toBeInTheDocument();

    // The three named zones (LZ-2 adds Explore).
    expect(sheet.getByText(/^your notes$/i)).toBeInTheDocument();
    expect(sheet.getByText(/^explore$/i)).toBeInTheDocument();
    expect(sheet.getByText(/^your parachute$/i)).toBeInTheDocument();

    // F14: Tags AND Vaults, reachable on mobile for the first time.
    expect(sheet.getByRole("link", { name: /^tags$/i })).toHaveAttribute("href", "/tags");
    expect(sheet.getByRole("link", { name: /^vaults$/i })).toHaveAttribute("href", "/vaults");

    // The lens set (LZ-2) — all four, at today's exact URLs.
    expect(sheet.getByRole("link", { name: /^recent$/i })).toHaveAttribute("href", "/");
    expect(sheet.getByRole("link", { name: /^all notes$/i })).toHaveAttribute("href", "/notes");
    expect(sheet.getByRole("link", { name: /^pinned$/i })).toHaveAttribute(
      "href",
      "/notes?view=pinned",
    );
    expect(sheet.getByRole("link", { name: /^archive$/i })).toHaveAttribute(
      "href",
      "/notes?view=archived",
    );

    // The Explore destinations.
    expect(sheet.getByRole("link", { name: /^calendar$/i })).toHaveAttribute("href", "/calendar");
    expect(sheet.getByRole("link", { name: /^activity$/i })).toHaveAttribute("href", "/activity");

    // The parachute band's other rooms.
    expect(sheet.getByRole("link", { name: /account & plan/i })).toHaveAttribute(
      "href",
      "/account",
    );
    expect(sheet.getByRole("link", { name: /^connect ai$/i })).toHaveAttribute("href", "/connect");
    expect(sheet.getByRole("link", { name: /^import notes$/i })).toHaveAttribute("href", "/import");

    // The foot: Settings + the ☰ era's extras.
    expect(sheet.getByRole("link", { name: /^settings$/i })).toHaveAttribute("href", "/settings");
    expect(sheet.getByRole("button", { name: /theme:/i })).toBeInTheDocument();
    expect(sheet.getByRole("button", { name: /text size/i })).toBeInTheDocument();
  });

  it("gates the Map row on earned — same rule as the rail (F14)", async () => {
    const unearned = await renderSheet();
    expect(screen.queryByRole("link", { name: /^map$/i })).toBeNull();
    unearned.unmount();

    useVaultStore.setState({
      vaults: {
        a: makeVault({ id: "a", url: "http://localhost:1940" }),
        b: makeVault({ id: "b", url: "http://localhost:1941", name: "journal" }),
      },
      activeVaultId: "a",
    });
    await renderSheet();
    expect(screen.getByRole("link", { name: /^map$/i })).toHaveAttribute("href", "/map");
  });

  it("marks the current room active", async () => {
    await renderSheet({}, "/vaults");
    expect(screen.getByRole("link", { name: /^vaults$/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /^recent$/i })).not.toHaveAttribute("aria-current");
  });

  it("marks the Pinned lens active on /notes?view=pinned (search-aware match — LZ-2)", async () => {
    await renderSheet({}, "/notes?view=pinned");
    expect(screen.getByRole("link", { name: /^pinned$/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /^all notes$/i })).not.toHaveAttribute("aria-current");
  });

  it("closes on scrim tap and on Escape", async () => {
    const onClose = vi.fn();
    await renderSheet({ onClose });
    fireEvent.click(screen.getByRole("button", { name: /close menu/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes on a swipe down from the sheet's top", async () => {
    const onClose = vi.fn();
    await renderSheet({ onClose });
    const dialog = screen.getByRole("dialog", { name: /^menu$/i });
    fireEvent.touchStart(dialog, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(dialog, { touches: [{ clientY: 200 }] });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lands focus on the switcher band for the vault-pill entry (initialFocus)", async () => {
    await renderSheet({ initialFocus: "switcher" });
    const active = document.activeElement as HTMLElement;
    expect(active.closest('[data-nav-band="switcher"]')).not.toBeNull();
  });

  it("Shift+Tab from the dialog container pulls focus back in — the trap never leaks to the scrim/page (B1)", async () => {
    await renderSheet();
    const dialog = screen.getByRole("dialog", { name: /^menu$/i });
    // On mount the container itself holds focus (tabIndex -1, outside the
    // focusable set). Shift+Tab from here must not walk out to the scrim.
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(dialog);
  });

  it("with no vaults: no bands, no switcher — just the utility foot (the old no-vault ☰)", async () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    await renderSheet();
    const sheet = within(screen.getByRole("dialog", { name: /^menu$/i }));
    expect(sheet.queryByText(/^your notes$/i)).toBeNull();
    expect(sheet.queryByText(/on this device/i)).toBeNull();
    expect(sheet.queryByRole("link", { name: /^settings$/i })).toBeNull();
    expect(sheet.getByRole("button", { name: /theme:/i })).toBeInTheDocument();
  });
});
