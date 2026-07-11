import { buildNavBands, matchNotes, matchToday, useNavBands } from "@/lib/nav/model";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The shared nav model (DESIGN-SPEC §2.1) — the single source both the Rail
// and the NavSheet render. These tests pin the F14 fix at its root: the two
// zones, their exact items/order/labels, and the gates.

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

describe("buildNavBands (pure)", () => {
  const base = { mapEarned: false, trialDaysLeft: null, setup: null };

  it("produces the two named zones with the §2.2 items, order, labels, and routes", () => {
    const bands = buildNavBands(base);
    expect(bands.map((b) => b.id)).toEqual(["notes", "parachute", "foot"]);

    const notes = bands[0];
    expect(notes.label).toBe("Your notes");
    expect(notes.items.map((i) => [i.id, i.label, i.to])).toEqual([
      ["today", "Today", "/"],
      ["notes", "Notes", "/all"],
      ["calendar", "Calendar", "/calendar"],
      ["tags", "Tags", "/tags"],
      ["activity", "Activity", "/activity"],
    ]);

    const parachute = bands[1];
    expect(parachute.label).toBe("Your parachute");
    expect(parachute.items.map((i) => [i.id, i.label, i.to])).toEqual([
      ["account", "Account & plan", "/account"],
      ["vaults", "Vaults", "/vaults"],
      ["connect", "Connect AI", "/connect"],
      ["import", "Import notes", "/import"],
    ]);

    const foot = bands[2];
    expect(foot.label).toBeUndefined();
    expect(foot.items.map((i) => [i.id, i.to])).toEqual([["settings", "/settings"]]);
  });

  it("gates the Map row on earned — absent before, last notes-band row after", () => {
    expect(
      buildNavBands(base)
        .find((b) => b.id === "notes")
        ?.items.some((i) => i.id === "map"),
    ).toBe(false);
    const earned = buildNavBands({ ...base, mapEarned: true }).find((b) => b.id === "notes");
    expect(earned?.items.at(-1)?.id).toBe("map");
    expect(earned?.items.at(-1)?.to).toBe("/graph");
    expect(earned?.items.at(-1)?.label).toBe("Map");
  });

  it("hangs the trial chip on Account & plan only while trialing (§3.1 ambience slot 3)", () => {
    const noTrial = buildNavBands(base)
      .find((b) => b.id === "parachute")
      ?.items.find((i) => i.id === "account");
    expect(noTrial?.badge).toBeUndefined();

    const trialing = buildNavBands({ ...base, trialDaysLeft: 5 })
      .find((b) => b.id === "parachute")
      ?.items.find((i) => i.id === "account");
    expect(trialing?.badge).toBeDefined();
  });

  it("renders the SET UP shelf with only incomplete steps + the n-of-m count; hides it when null", () => {
    const withSetup = buildNavBands({
      ...base,
      setup: { steps: ["connect", "import"], done: 2, total: 4 },
    });
    const shelf = withSetup.find((b) => b.id === "setup");
    expect(shelf).toBeDefined();
    expect(shelf?.label).toBe("Set up");
    expect(shelf?.sublabel).toBe("2 of 4");
    expect(shelf?.items.map((i) => [i.label, i.to])).toEqual([
      ["Connect your AI", "/connect"],
      ["Bring notes over", "/import"],
    ]);
    // The shelf sits between the parachute band and the foot (§2.2).
    expect(withSetup.map((b) => b.id)).toEqual(["notes", "parachute", "setup", "foot"]);

    expect(buildNavBands(base).find((b) => b.id === "setup")).toBeUndefined();
  });

  it("active-state rules: Today owns /, /today and /n/*; Notes owns /all", () => {
    expect(matchToday("/")).toBe(true);
    expect(matchToday("/today")).toBe(true);
    expect(matchToday("/n/some-note")).toBe(true);
    expect(matchToday("/all")).toBe(false);
    expect(matchNotes("/all")).toBe(true);
    expect(matchNotes("/")).toBe(false);
  });
});

describe("useNavBands (hook)", () => {
  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

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

  it("returns no bands with no active vault", () => {
    const { result } = renderHook(() => useNavBands(), { wrapper });
    expect(result.current).toEqual([]);
  });

  it("returns both zones + foot with an active vault (setup shelf included while incomplete)", async () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "http://localhost:1940" }) },
      activeVaultId: "a",
    });
    const { result } = renderHook(() => useNavBands(), { wrapper });
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    const ids = result.current.map((b) => b.id);
    expect(ids).toContain("notes");
    expect(ids).toContain("parachute");
    expect(ids).toContain("foot");
    // A fresh vault has incomplete guided steps → the shelf shows.
    expect(ids).toContain("setup");
  });

  it("drops the SET UP shelf once the checklist is dismissed", async () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "http://localhost:1940" }) },
      activeVaultId: "a",
    });
    localStorage.setItem(
      "notes:home-checklist:a",
      JSON.stringify({ dismissed: true, overrides: {} }),
    );
    const { result } = renderHook(() => useNavBands(), { wrapper });
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    expect(result.current.map((b) => b.id)).not.toContain("setup");
  });

  it("earns the Map row at ≥2 vaults — the one gate both projections share (F14)", async () => {
    useVaultStore.setState({
      vaults: {
        a: makeVault({ id: "a", url: "http://localhost:1940" }),
        b: makeVault({ id: "b", url: "http://localhost:1941", name: "journal" }),
      },
      activeVaultId: "a",
    });
    const { result } = renderHook(() => useNavBands(), { wrapper });
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    const notes = result.current.find((b) => b.id === "notes");
    expect(notes?.items.some((i) => i.id === "map")).toBe(true);
  });
});
