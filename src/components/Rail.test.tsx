import { Rail } from "@/components/Rail";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderResult, act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Async so the setup-checklist query settles inside act() — the Rail reads
// react-query data, so a bare render leaves a pending state update.
async function renderRail(path = "/"): Promise<RenderResult> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result!: RenderResult;
  await act(async () => {
    result = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Rail />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return result;
}

function seedVaults(entries: Record<string, VaultRecord>) {
  const first = Object.keys(entries)[0] ?? null;
  useVaultStore.setState({ vaults: entries, activeVaultId: first });
}

describe("Rail (two-zone desktop spine, W2-5)", () => {
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
  });

  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders nothing with no active vault", async () => {
    const { container } = await renderRail();
    expect(container.querySelector("aside")).toBeNull();
  });

  it("is a desktop-only spine (hidden lg:flex)", async () => {
    seedVaults({ a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) });
    const { container } = await renderRail();
    const aside = container.querySelector("aside");
    expect(aside?.className).toMatch(/\bhidden\b/);
    expect(aside?.className).toMatch(/\blg:flex\b/);
  });

  it("renders the three labeled zones with their rooms in spec order (LENS-SPEC §4)", async () => {
    seedVaults({ a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) });
    const { container } = await renderRail();

    // All three band labels present.
    expect(screen.getByText(/^your notes$/i)).toBeInTheDocument();
    expect(screen.getByText(/^explore$/i)).toBeInTheDocument();
    expect(screen.getByText(/^your parachute$/i)).toBeInTheDocument();

    // YOUR NOTES is the lens set — Recent · All notes · Pinned · Archive,
    // every target an existing URL (§2 zero migration).
    const notesBand = container.querySelector('[data-nav-band="notes"]');
    const notesLinks = Array.from(notesBand?.querySelectorAll("a[data-nav-item]") ?? []).map(
      (a) => [a.textContent, a.getAttribute("href")],
    );
    expect(notesLinks).toEqual([
      ["Recent", "/"],
      ["All notes", "/notes"],
      ["Pinned", "/notes?view=pinned"],
      ["Archive", "/notes?view=archived"],
    ]);

    // EXPLORE — the destinations, in order (Map absent — unearned).
    const exploreBand = container.querySelector('[data-nav-band="explore"]');
    const exploreLinks = Array.from(exploreBand?.querySelectorAll("a[data-nav-item]") ?? []).map(
      (a) => [a.textContent, a.getAttribute("href")],
    );
    expect(exploreLinks).toEqual([
      ["Calendar", "/calendar"],
      ["Tags", "/tags"],
      ["Activity", "/activity"],
    ]);

    // YOUR PARACHUTE rooms, in order (F14/F15: the manager zone, named).
    const parachuteBand = container.querySelector('[data-nav-band="parachute"]');
    const parachuteLinks = Array.from(
      parachuteBand?.querySelectorAll("a[data-nav-item]") ?? [],
    ).map((a) => [a.textContent, a.getAttribute("href")]);
    expect(parachuteLinks).toEqual([
      ["Account & plan", "/account"],
      ["Vaults", "/vaults"],
      ["Connect AI", "/connect"],
      ["Import notes", "/import"],
    ]);
  });

  it("leads with the vault switcher and pins Settings to the foot", async () => {
    seedVaults({ a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) });
    await renderRail();
    expect(screen.getByRole("button", { name: /active vault: gardening/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^settings$/i })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("button", { name: /theme:/i })).toBeInTheDocument();
  });

  it("the old label vocabulary is gone ('Today' → 'Recent', 'Notes' → 'All notes'; no foot Account row)", async () => {
    seedVaults({ a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) });
    await renderRail();
    // LZ-2: the name "Today" died with the lens model (LENS-SPEC §6), and
    // "Notes" grew back into "All notes" — the lens is honest about scope.
    expect(screen.queryByRole("link", { name: /^today$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^notes$/i })).toBeNull();
    // Account lives in the parachute band as "Account & plan" now.
    expect(screen.getByRole("link", { name: /account & plan/i })).toHaveAttribute(
      "href",
      "/account",
    );
    expect(screen.queryByRole("link", { name: /^account$/i })).toBeNull();
  });

  it("hides the Map row until it's earned (one vault, no linked notes)", async () => {
    seedVaults({ a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) });
    await renderRail();
    expect(screen.queryByRole("link", { name: /^map$/i })).toBeNull();
  });

  it("shows the Map row once earned (≥2 vaults)", async () => {
    seedVaults({
      a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }),
      b: makeVault({ id: "b", url: "http://localhost:1941", name: "journal" }),
    });
    await renderRail();
    expect(screen.getByRole("link", { name: /^map$/i })).toHaveAttribute("href", "/map");
  });

  it("marks the current room active (aria-current on the matching row only)", async () => {
    seedVaults({ a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) });
    await renderRail("/tags");
    expect(screen.getByRole("link", { name: /^tags$/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /^recent$/i })).not.toHaveAttribute("aria-current");
  });

  it("marks All notes active on /notes (the bare lens)", async () => {
    seedVaults({ a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) });
    await renderRail("/notes");
    expect(screen.getByRole("link", { name: /^all notes$/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /^pinned$/i })).not.toHaveAttribute("aria-current");
  });

  // LZ-2's search-aware active state — the rendered-rail half of the model's
  // active-state matrix: the `?view=` lenses light their own row, and the
  // maintenance filters stay under All notes.
  it("marks Pinned active on /notes?view=pinned — and All notes goes quiet", async () => {
    seedVaults({ a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) });
    await renderRail("/notes?view=pinned");
    expect(screen.getByRole("link", { name: /^pinned$/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /^all notes$/i })).not.toHaveAttribute("aria-current");
  });

  it("marks Archive active on /notes?view=archived — and All notes goes quiet", async () => {
    seedVaults({ a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) });
    await renderRail("/notes?view=archived");
    expect(screen.getByRole("link", { name: /^archive$/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /^all notes$/i })).not.toHaveAttribute("aria-current");
  });

  it("keeps the maintenance filters under All notes (/notes?view=untagged highlights All)", async () => {
    seedVaults({ a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) });
    await renderRail("/notes?view=untagged");
    expect(screen.getByRole("link", { name: /^all notes$/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /^pinned$/i })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /^archive$/i })).not.toHaveAttribute("aria-current");
  });

  it("keeps reading a note under the Recent lens (/n/:id highlights Recent)", async () => {
    seedVaults({ a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) });
    await renderRail("/n/some-note");
    expect(screen.getByRole("link", { name: /^recent$/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /^all notes$/i })).not.toHaveAttribute("aria-current");
  });

  it("keeps the day drill-in under the Recent lens (/today?date= highlights Recent)", async () => {
    seedVaults({ a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) });
    await renderRail("/today?date=2026-04-18");
    expect(screen.getByRole("link", { name: /^recent$/i })).toHaveAttribute("aria-current", "page");
  });

  it("marks Map active on /map, once earned (W2-7 rename)", async () => {
    seedVaults({
      a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }),
      b: makeVault({ id: "b", url: "http://localhost:1941", name: "journal" }),
    });
    await renderRail("/map");
    expect(screen.getByRole("link", { name: /^map$/i })).toHaveAttribute("aria-current", "page");
  });

  it("collapses to the icon rail (labels hidden, tooltips carry them) and persists", async () => {
    seedVaults({ a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) });
    const { container } = await renderRail();

    const aside = container.querySelector("aside");
    expect(aside?.className).toMatch(/\bw-60\b/);

    fireEvent.click(screen.getByRole("button", { name: /collapse the sidebar/i }));
    expect(aside?.className).toMatch(/\bw-16\b/);
    // Section labels hide; rows keep accessible names via aria-label + title.
    expect(screen.queryByText(/^your notes$/i)).toBeNull();
    const tags = screen.getByRole("link", { name: /^tags$/i });
    expect(tags).toHaveAttribute("title", "Tags");
    // Persisted for the next mount.
    expect(localStorage.getItem("parachute.rail-collapsed")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: /expand the sidebar/i }));
    expect(aside?.className).toMatch(/\bw-60\b/);
    expect(localStorage.getItem("parachute.rail-collapsed")).toBe("0");
  });

  it("restores the collapsed state from localStorage on mount", async () => {
    localStorage.setItem("parachute.rail-collapsed", "1");
    seedVaults({ a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) });
    const { container } = await renderRail();
    expect(container.querySelector("aside")?.className).toMatch(/\bw-16\b/);
  });

  // Folded review nits (#192): things the old desktop ⋯ overflow carried that
  // lost their desktop home — Activity gets a rail room, appearance gets the foot.
  it("gives Activity a desktop room and the theme toggle a home in the foot", async () => {
    seedVaults({ a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) });
    await renderRail();
    expect(screen.getByRole("link", { name: /^activity$/i })).toHaveAttribute("href", "/activity");
    expect(screen.getByRole("button", { name: /theme:/i })).toBeInTheDocument();
  });
});
