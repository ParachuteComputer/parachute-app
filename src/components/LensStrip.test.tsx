import { LensStrip } from "@/components/LensStrip";
import { Rail } from "@/components/Rail";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderResult, act, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The mobile lens strip (LENS-SPEC §5.1, LZ-5) — the nav model's lens band
// projected onto the surface as a chip row. The two things that matter:
// SINGLE SOURCE (the chips are the same items, same order, same hrefs as the
// rail's lens band — no second vocabulary to drift, the F14 lesson) and the
// ACTIVE grammar (each chip lights by the model's own matcher, so the strip
// can never disagree with the rail about which lens a URL is).

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

// useNavBands reads react-query state (setup-shelf signals), so the strip
// needs a client + a stubbed fetch in scope, same as the contract test.
async function renderAt(ui: ReactNode, path = "/"): Promise<RenderResult> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result!: RenderResult;
  await act(async () => {
    result = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return result;
}

function chipStates(container: HTMLElement): Array<[string, string, string, boolean]> {
  const nav = container.querySelector('nav[aria-label="Lenses"]');
  if (!nav) return [];
  return Array.from(nav.querySelectorAll("a[data-nav-item]")).map((a) => [
    a.getAttribute("data-nav-item") ?? "",
    a.textContent ?? "",
    a.getAttribute("href") ?? "",
    a.getAttribute("aria-current") === "page",
  ]);
}

describe("LensStrip (LENS-SPEC §5.1)", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => [],
        }) as Response,
    ) as unknown as typeof fetch;
    seedVault();
  });

  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    vi.restoreAllMocks();
  });

  it("renders the four lens chips from the nav model — labels, hrefs, order", async () => {
    const { container } = await renderAt(<LensStrip />);
    expect(chipStates(container)).toEqual([
      ["recent", "Recent", "/", true],
      ["notes", "All notes", "/notes", false],
      ["pinned", "Pinned", "/notes?view=pinned", false],
      ["archive", "Archive", "/notes?view=archived", false],
    ]);
  });

  it("is the RAIL's lens band projected — same items, same order, same hrefs (single source, F14)", async () => {
    const { container: stripContainer } = await renderAt(<LensStrip />);
    const { container: railContainer } = await renderAt(<Rail />);

    const stripChips = chipStates(stripContainer).map(([id, label, href]) => [id, label, href]);
    const railLens = Array.from(
      railContainer.querySelectorAll('[data-nav-band="notes"] a[data-nav-item]'),
    ).map((a) => [
      a.getAttribute("data-nav-item") ?? "",
      a.textContent ?? "",
      a.getAttribute("href") ?? "",
    ]);

    expect(stripChips.length).toBeGreaterThan(0);
    expect(stripChips).toEqual(railLens);
  });

  it.each([
    ["/", "recent"],
    ["/today", "recent"],
    ["/n/abc", "recent"],
    ["/notes", "notes"],
    ["/notes?search=fog", "notes"],
    ["/notes?view=untagged", "notes"], // maintenance filters stay under All (§1)
    ["/notes?view=orphaned", "notes"],
    ["/notes?view=pinned", "pinned"],
    ["/notes?view=archived", "archive"],
  ])("at %s exactly the %s chip is active (the model's matchers, verbatim)", async (path, id) => {
    const { container } = await renderAt(<LensStrip />, path);
    const active = chipStates(container).filter(([, , , isActive]) => isActive);
    expect(active.map(([chipId]) => chipId)).toEqual([id]);
  });

  it("every lens is ONE tap from any other — all four chips are links, present on every lens", async () => {
    for (const path of ["/", "/notes", "/notes?view=pinned", "/notes?view=archived"]) {
      const { container, unmount } = await renderAt(<LensStrip />, path);
      const nav = container.querySelector('nav[aria-label="Lenses"]') as HTMLElement;
      expect(nav, `strip must render at ${path}`).not.toBeNull();
      expect(within(nav).getAllByRole("link")).toHaveLength(4);
      unmount();
    }
  });

  it("is mobile-only: lg:hidden on the root, never md: (the breakpoint contract)", async () => {
    const { container } = await renderAt(<LensStrip />);
    const nav = container.querySelector('nav[aria-label="Lenses"]');
    expect(nav).not.toBeNull();
    expect(nav?.className).toMatch(/\blg:hidden\b/);
    expect(nav?.className).not.toMatch(/\bmd:hidden\b/);
  });

  it("renders nothing with no active vault", async () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    const { container } = await renderAt(<LensStrip />);
    expect(container.querySelector('nav[aria-label="Lenses"]')).toBeNull();
  });
});
