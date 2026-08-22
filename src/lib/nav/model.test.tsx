import {
  NavBandsProvider,
  type NavLocation,
  buildNavBands,
  matchAllNotes,
  matchArchive,
  matchPinned,
  matchRecent,
  matchVaultSurface,
  useNavBands,
} from "@/lib/nav/model";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The shared nav model (DESIGN-SPEC §2.1; LENS-SPEC §4 in LZ-2) — the single
// source both the Rail and the NavSheet render. These tests pin the F14 fix
// at its root — the zones, their exact items/order/labels, and the gates —
// plus LZ-2's active-state matrix: which lens lights up for which URL,
// including the `?view=` search dimension.

/** "/notes?view=pinned" → { pathname, search } the way react-router splits it. */
function loc(url: string): NavLocation {
  const [pathname = "", query] = url.split("?");
  return { pathname, search: query ? `?${query}` : "" };
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

describe("buildNavBands (pure)", () => {
  const base = { mapEarned: false, trialDaysLeft: null, setup: null, viewItems: [] };

  it("produces the lens set, the Views band, the Explore band, and the manager zone — items, order, labels, routes (LENS-SPEC §4)", () => {
    const bands = buildNavBands(base);
    expect(bands.map((b) => b.id)).toEqual(["notes", "views", "explore", "parachute", "foot"]);

    // YOUR NOTES is the lens set now — four dresses over the one collection,
    // every target an EXISTING route (§2's zero-migration URL scheme).
    const notes = bands[0];
    expect(notes.label).toBe("Your notes");
    expect(notes.items.map((i) => [i.id, i.label, i.to])).toEqual([
      ["recent", "Recent", "/"],
      ["notes", "All notes", "/notes"],
      ["pinned", "Pinned", "/notes?view=pinned"],
      ["archive", "Archive", "/notes?view=archived"],
    ]);

    // VIEWS (views-wave-1, VIEWS-RENDER-SPEC §6) — no views yet, so just the
    // permanent "New view" affordance.
    const views = bands.find((b) => b.id === "views");
    expect(views?.label).toBe("Views");
    expect(views?.items.map((i) => [i.id, i.label, i.to])).toEqual([
      ["new-view", "New view", "/views/new"],
    ]);

    // EXPLORE — the destinations, moved out of YOUR NOTES unchanged (D3).
    const explore = bands.find((b) => b.id === "explore");
    expect(explore?.label).toBe("Explore");
    expect(explore?.items.map((i) => [i.id, i.label, i.to])).toEqual([
      ["calendar", "Calendar", "/calendar"],
      ["tags", "Tags", "/tags"],
      ["activity", "Activity", "/activity"],
    ]);

    const parachute = bands.find((b) => b.id === "parachute");
    expect(parachute?.label).toBe("Your parachute");
    expect(parachute?.items.map((i) => [i.id, i.label, i.to])).toEqual([
      ["account", "Account & plan", "/account"],
      ["vaults", "Vaults", "/vaults"],
      ["connect", "Connect AI", "/connect"],
      ["import", "Import notes", "/import"],
      ["export", "Export notes", "/export"],
    ]);

    const foot = bands.find((b) => b.id === "foot");
    expect(foot?.label).toBeUndefined();
    expect(foot?.items.map((i) => [i.id, i.to])).toEqual([["settings", "/settings"]]);
  });

  it("Views band shows the decoded view items ahead of the permanent New-view row", () => {
    const viewItem = {
      id: "view-abc",
      label: "Active projects",
      to: "/views/abc",
      icon: null,
      match: () => false,
    };
    const bands = buildNavBands({ ...base, viewItems: [viewItem] });
    const views = bands.find((b) => b.id === "views");
    expect(views?.items.map((i) => i.id)).toEqual(["view-abc", "new-view"]);
  });

  it("shows no counts on any lens (LENS-SPEC §1 — no rail counts in v1)", () => {
    for (const item of buildNavBands(base)[0].items) {
      expect(item.badge, `${item.id} must not carry a badge`).toBeUndefined();
    }
  });

  it("gates the Map row on earned — absent before, last EXPLORE row after (gate logic unchanged)", () => {
    expect(
      buildNavBands(base)
        .find((b) => b.id === "explore")
        ?.items.some((i) => i.id === "map"),
    ).toBe(false);
    const earned = buildNavBands({ ...base, mapEarned: true }).find((b) => b.id === "explore");
    expect(earned?.items.map((i) => i.id)).toEqual(["calendar", "tags", "activity", "map"]);
    expect(earned?.items.at(-1)?.to).toBe("/map");
    expect(earned?.items.at(-1)?.label).toBe("Map");
    // The lens band never carries Map — it's a destination, not a lens.
    expect(
      buildNavBands({ ...base, mapEarned: true })
        .find((b) => b.id === "notes")
        ?.items.some((i) => i.id === "map"),
    ).toBe(false);
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
    // W3: `write` is the only tracked step left (state-derived — `connect`
    // dropped for no cross-device signal, `import` folded in, `install`
    // moved to its own always-separate per-device nudge).
    const withSetup = buildNavBands({
      ...base,
      setup: { steps: ["write"], done: 0, total: 1 },
    });
    const shelf = withSetup.find((b) => b.id === "setup");
    expect(shelf).toBeDefined();
    expect(shelf?.label).toBe("Set up");
    expect(shelf?.sublabel).toBe("0 of 1");
    expect(shelf?.items.map((i) => [i.label, i.to])).toEqual([["Write a note", "/new"]]);
    // The shelf sits between the parachute band and the foot (§2.2).
    expect(withSetup.map((b) => b.id)).toEqual([
      "notes",
      "views",
      "explore",
      "parachute",
      "setup",
      "foot",
    ]);

    expect(buildNavBands(base).find((b) => b.id === "setup")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // The LZ-2 active-state matrix (LENS-SPEC §4 / §7's done-when): which item
  // lights up for which URL. Exactly ONE item may match each location — a
  // lens set with two live highlights (or none on a lens URL) is a bug.
  // -------------------------------------------------------------------------

  /** Every item id whose match rule claims the given URL, across all bands. */
  function activeIds(url: string): string[] {
    const l = loc(url);
    return buildNavBands({ mapEarned: true, trialDaysLeft: null, setup: null, viewItems: [] })
      .flatMap((b) => b.items)
      .filter((i) => i.match(l))
      .map((i) => i.id);
  }

  it("active-state matrix: each lens/destination URL lights exactly its own row", () => {
    // The lens set.
    expect(activeIds("/")).toEqual(["recent"]);
    expect(activeIds("/notes")).toEqual(["notes"]);
    expect(activeIds("/notes?view=pinned")).toEqual(["pinned"]);
    expect(activeIds("/notes?view=archived")).toEqual(["archive"]);

    // Drill-ins stay under Recent — reading a note and the day view both
    // inherit the home lens (matchRecent, the old matchToday grammar).
    expect(activeIds("/n/some-note")).toEqual(["recent"]);
    expect(activeIds("/today")).toEqual(["recent"]);
    expect(activeIds("/today?date=2026-04-18")).toEqual(["recent"]);

    // Maintenance filters and search/tag dresses are NOT lenses — they stay
    // under All notes (LENS-SPEC §1: the rail highlights All while active).
    expect(activeIds("/notes?view=untagged")).toEqual(["notes"]);
    expect(activeIds("/notes?view=orphaned")).toEqual(["notes"]);
    expect(activeIds("/notes?search=moss&tag=daily")).toEqual(["notes"]);

    // A destination lights only itself — no lens stays lit underneath.
    expect(activeIds("/calendar")).toEqual(["calendar"]);
    expect(activeIds("/map")).toEqual(["map"]);

    // The pre-rename address is a shim (`/all` → `/notes` via <Navigate
    // replace>) — active-state never claims it in its own right.
    expect(activeIds("/all")).toEqual([]);
  });

  it("exposes the lens matchers with the search-aware signature (shared with the tab bar)", () => {
    expect(matchRecent(loc("/"))).toBe(true);
    expect(matchRecent(loc("/notes"))).toBe(false);
    expect(matchAllNotes(loc("/notes"))).toBe(true);
    expect(matchAllNotes(loc("/notes?view=pinned"))).toBe(false);
    expect(matchAllNotes(loc("/notes?view=archived"))).toBe(false);
    expect(matchAllNotes(loc("/notes?view=untagged"))).toBe(true);
    expect(matchPinned(loc("/notes?view=pinned"))).toBe(true);
    expect(matchPinned(loc("/?view=pinned"))).toBe(false); // param needs the /notes room
    expect(matchArchive(loc("/notes?view=archived"))).toBe(true);
    expect(matchArchive(loc("/notes"))).toBe(false);
  });

  // LZ-5: the 3-slot bar's one surface tab lights on the union of the lens
  // territory — matchVaultSurface must claim exactly what the four lens
  // matchers claim between them, and nothing a destination owns.
  it("matchVaultSurface claims the whole one-surface footprint and nothing else (LENS-SPEC §5.2)", () => {
    for (const url of [
      "/",
      "/notes",
      "/notes?view=pinned",
      "/notes?view=archived",
      "/notes?view=untagged",
      "/notes?search=moss&tag=daily",
      "/n/some-note",
      "/today",
      "/today?date=2026-04-18",
    ]) {
      expect(matchVaultSurface(loc(url)), `${url} is the surface`).toBe(true);
    }
    for (const url of [
      "/calendar",
      "/tags",
      "/activity",
      "/map",
      "/account",
      "/vaults",
      "/connect",
      "/import",
      "/export",
      "/settings",
      "/new",
      "/all", // the pre-rename shim redirects; active-state never claims it
    ]) {
      expect(matchVaultSurface(loc(url)), `${url} is not the surface`).toBe(false);
    }
  });
});

describe("useNavBands (hook)", () => {
  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // `useNavBands` reads the model from context now (app#110) — the
    // derivation itself is module-private, so these hook tests go through
    // the provider exactly like the projections do.
    return (
      <QueryClientProvider client={client}>
        <NavBandsProvider>{children}</NavBandsProvider>
      </QueryClientProvider>
    );
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
    // The shelf renders only on a RESOLVED "no user note" — unknown
    // (pending/offline/no token) deliberately shows nothing (see
    // use-has-user-note.ts). So this test needs a live client + an empty
    // vault answer for the bounded probe to resolve `false`.
    localStorage.setItem(
      "lens:token:a",
      JSON.stringify({ accessToken: "t", scope: "full", vault: "default" }),
    );
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    })) as unknown as typeof fetch;
    const { result } = renderHook(() => useNavBands(), { wrapper });
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    // A fresh vault has incomplete guided steps → the shelf shows, once the
    // probe RESOLVES false (the bands render before it lands, without it).
    await waitFor(() => expect(result.current.map((b) => b.id)).toContain("setup"));
    const ids = result.current.map((b) => b.id);
    expect(ids).toContain("notes");
    expect(ids).toContain("explore");
    expect(ids).toContain("parachute");
    expect(ids).toContain("foot");
  });

  // THE CRUX (W3): the shelf must never resurface for an established vault on
  // a brand-new device. Before this rework, `connect`/`import` were per-device
  // localStorage ticks and `dismissed` was too — so a real account, viewed
  // from a browser with empty storage, looked un-onboarded. Now the ONLY
  // tracked signal is a real note in the vault, so a fresh browser (empty
  // localStorage, seeded here only with the vault + its access token — never
  // a checklist blob) reads the SAME "done" a device that did the onboarding
  // would.
  it("W3: an established vault (a real user note) never shows the SET UP shelf — even with empty localStorage", async () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "http://localhost:1940" }) },
      activeVaultId: "a",
    });
    localStorage.setItem(
      "lens:token:a",
      JSON.stringify({ accessToken: "t", scope: "full", vault: "default" }),
    );
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: "u1",
          path: "My real note",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useNavBands(), { wrapper });
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    // Guard against a vacuous pass: "no setup band" is also what an
    // UNRESOLVED probe renders, so first prove THE PROBE ran — a fetch
    // carrying the probe's own signature (`exclude_tag=guide`), not any
    // fetch at all. The model fetches views/tag-roles too, so an any-fetch
    // guard was itself vacuous: it held even with the probe stubbed to
    // never fire (#117 review).
    await waitFor(() =>
      expect(
        (global.fetch as ReturnType<typeof vi.fn>).mock.calls
          .map((c) => String(c[0]))
          .some((u) => u.includes("exclude_tag=guide")),
      ).toBe(true),
    );
    await new Promise((r) => setTimeout(r, 0));
    // No setup band at all — not "hidden", not "dismissed": state-derived
    // means it was never a candidate to show in the first place.
    await waitFor(() => expect(result.current.map((b) => b.id)).not.toContain("setup"));
    // And nothing was ever read from or written to the old per-device key —
    // there's no checklist storage left to check.
    expect(localStorage.getItem("notes:home-checklist:a")).toBeNull();
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
    const explore = result.current.find((b) => b.id === "explore");
    expect(explore?.items.some((i) => i.id === "map")).toBe(true);
  });

  // The Views band (views-wave-1, VIEWS-RENDER-SPEC §6): fed by a `tag=view`
  // query, the four shipped default-page paths excluded. §8's legacy
  // `{kind:"saved-view"}` adapter is void (scope cut, 2026-07-17) — a
  // legacy-shaped note is excluded from the band outright, not admitted.
  it("Views band lists tag=view notes, excludes default-page paths and legacy saved-view notes", async () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "http://localhost:1940" }) },
      activeVaultId: "a",
    });
    localStorage.setItem(
      "lens:token:a",
      JSON.stringify({ accessToken: "t", scope: "full", vault: "default" }),
    );
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("tag=view")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { id: "v1", path: "Views/Active projects", tags: ["view"], metadata: {} },
            // A shipped default page — excluded from the band (it already
            // has a Rail row under "Your notes").
            { id: "v2", path: "Views/Pinned", tags: ["view"], metadata: {} },
            // Vault paths are case-sensitive, but the human-facing reserved
            // names are not. This must dedup with the same rule as dialogs.
            { id: "v4", path: "views/recent", tags: ["view"], metadata: {} },
            // A legacy saved-view — §8 is void; excluded from the band.
            {
              id: "v3",
              path: "UI/Views/Daily",
              tags: ["view"],
              metadata: { kind: "saved-view", filters: {} },
            },
          ],
        } as Response;
      }
      return { ok: true, status: 200, json: async () => [] } as Response;
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useNavBands(), { wrapper });
    await waitFor(() => {
      const views = result.current.find((b) => b.id === "views");
      expect(views?.items.map((i) => i.id)).toContain("view-v1");
    });
    const views = result.current.find((b) => b.id === "views");
    const ids = views?.items.map((i) => i.id) ?? [];
    expect(ids).toContain("view-v1");
    expect(ids).not.toContain("view-v2"); // Views/Pinned is a default page
    expect(ids).not.toContain("view-v4"); // case variant of Views/Recent
    expect(ids).not.toContain("view-v3"); // legacy saved-view — §8 void
    expect(ids.at(-1)).toBe("new-view"); // the permanent trailing affordance
  });
});
