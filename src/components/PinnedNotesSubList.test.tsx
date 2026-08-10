import { NavDrawer } from "@/components/NavDrawer";
import { NavSheet } from "@/components/NavSheet";
import { Rail } from "@/components/Rail";
import { NavBandsProvider } from "@/lib/nav/model";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderResult, act, fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The pinned-note sub-list under the Pinned row (app#131) across ALL THREE
// projections. #131 shipped the desktop rail's copy and said in its own commit
// message that "NavSheet parity is deliberately deferred to the tablet-sidebar
// work" — this file is that parity, pinned: the drawer and the sheet render
// the SAME five notes, in the SAME order, at THEIR row scale.
//
// Rail.test.tsx keeps the rail-specific clauses (#131's own: the five-note
// window, the request params, the collapsed rail hiding it). What lives here
// is what only exists once there is more than one projection — parity, scale,
// and the shared cache.

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
    vaults: { a: makeVault({ id: "a", url: "http://localhost:1940", name: "gardening" }) },
    activeVaultId: "a",
  });
  localStorage.setItem(
    "lens:token:a",
    JSON.stringify({ accessToken: "pvt_test", scope: "full", vault: "default" }),
  );
}

/** The same fetch shape Rail.test.tsx installs for #131's own clauses. */
function installPinnedFetch(notes: unknown[]) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = url.includes("settings")
      ? {
          id: "settings",
          path: ".parachute/notes/settings",
          metadata: {
            notes: {
              schemaVersion: 1,
              tagRoles: {
                pinned: "pinned",
                archived: "archived",
                captureVoice: "capture",
                captureText: "capture",
                view: "view",
              },
            },
          },
        }
      : url.includes("/api/notes") && url.includes("tag=pinned")
        ? notes
        : url.includes("/api/notes") || url.includes("/api/tags")
          ? []
          : { notes: [], vaults: [], services: [] };
    return { ok: true, status: 200, json: async () => body, text: async () => "" } as Response;
  });
  global.fetch = fetchImpl as unknown as typeof fetch;
  return fetchImpl;
}

const PINNED = [
  {
    id: "folder/first note",
    path: "Ideas/First pinned.md",
    tags: ["pinned"],
    createdAt: "2026-04-22T10:00:00.000Z",
    updatedAt: "2026-04-22T11:00:00.000Z",
  },
  {
    id: "second",
    path: "Ideas/Second pinned.md",
    tags: ["pinned"],
    createdAt: "2026-04-22T09:00:00.000Z",
    updatedAt: "2026-04-22T10:00:00.000Z",
  },
];

async function renderIn(ui: ReactNode, client?: QueryClient): Promise<RenderResult> {
  const qc = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result!: RenderResult;
  await act(async () => {
    result = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <NavBandsProvider>{ui}</NavBandsProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return result;
}

/** Slide the drawer out — its rooms (and so its sub-list) only exist open. */
async function openDrawer(container: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(within(container).getByRole("button", { name: /open the navigation drawer/i }));
  });
}

/** [title, href] for every row of a projection's pinned sub-list. */
async function pinnedRows(container: HTMLElement): Promise<string[][]> {
  const list = await within(container).findByRole("list", { name: "Pinned notes" });
  return within(list)
    .getAllByRole("link")
    .map((a) => [a.textContent ?? "", a.getAttribute("href") ?? ""]);
}

describe("the pinned-note sub-list, across all three nav projections (app#131 parity)", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    installPinnedFetch(PINNED);
    seedVault();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("the tablet drawer carries it — same notes, same order, same hrefs as the rail", async () => {
    const { container: railC } = await renderIn(<Rail />);
    const { container: drawerC } = await renderIn(<NavDrawer />);
    await openDrawer(drawerC);

    const rail = await pinnedRows(railC);
    const drawer = await pinnedRows(drawerC);
    expect(rail).toEqual([
      ["First pinned", "/n/folder%2Ffirst%20note"],
      ["Second pinned", "/n/second"],
    ]);
    expect(drawer).toEqual(rail);
  });

  it("the phone sheet carries it too — the parity #131 deferred to this work", async () => {
    const { container: railC } = await renderIn(<Rail />);
    const { container: sheetC } = await renderIn(<NavSheet open onClose={() => {}} />);
    expect(await pinnedRows(sheetC)).toEqual(await pinnedRows(railC));
  });

  it("hangs under the Pinned ROW, inside the notes band, in every projection", async () => {
    const { container: drawerC } = await renderIn(<NavDrawer />);
    await openDrawer(drawerC);
    const { container: sheetC } = await renderIn(<NavSheet open onClose={() => {}} />);

    for (const container of [drawerC, sheetC]) {
      const band = container.querySelector('[data-nav-band="notes"]');
      expect(band, "the notes band must exist").not.toBeNull();
      const list = await within(band as HTMLElement).findByRole("list", { name: "Pinned notes" });
      // Immediately AFTER the Pinned row and BEFORE the Archive one — the
      // sub-list belongs to the room above it, not to the band's foot.
      const rows = within(band as HTMLElement).getAllByRole("link");
      const order = rows.map((row) => row.getAttribute("data-nav-item") ?? "pinned-note");
      const pinnedAt = order.indexOf("pinned");
      const archiveAt = order.indexOf("archive");
      expect(pinnedAt).toBeGreaterThanOrEqual(0);
      expect(archiveAt).toBeGreaterThan(pinnedAt);
      // Every row BETWEEN Pinned and Archive is a pinned note, and there is at
      // least one — i.e. the list hangs off the room above it, not off the
      // band's foot.
      const between = order.slice(pinnedAt + 1, archiveAt);
      expect(between.length).toBeGreaterThan(0);
      expect(new Set(between)).toEqual(new Set(["pinned-note"]));
      // …and those rows are exactly the sub-list's own.
      expect(within(list).getAllByRole("link")).toHaveLength(between.length);
    }
  });

  it("the touch projections' rows clear the 44px floor; the rail's stay mouse scale", async () => {
    const { container: railC } = await renderIn(<Rail />);
    const { container: drawerC } = await renderIn(<NavDrawer />);
    await openDrawer(drawerC);

    // Wait the lists in before reading classes off them — the window is a
    // fetch, so a bare query races it.
    await within(railC).findByRole("list", { name: "Pinned notes" });
    await within(drawerC).findByRole("list", { name: "Pinned notes" });
    const railRow = railC.querySelector('a[data-pinned-note="second"]');
    const drawerRow = drawerC.querySelector('a[data-pinned-note="second"]');
    expect(railRow).not.toBeNull();
    expect(drawerRow).not.toBeNull();
    // jsdom can't measure — the sizing utility IS the assertion, same as the
    // rest of the breakpoint/touch contract.
    expect(drawerRow?.className).toMatch(/\bmin-h-11\b/);
    expect(drawerRow?.className).toMatch(/\btext-sm\b/);
    expect(railRow?.className).toMatch(/\btext-xs\b/);
    expect(railRow?.className).not.toMatch(/\bmin-h-11\b/);
    // Both indent under the room row's icon column, so the list reads as
    // hanging off Pinned rather than as a sibling room.
    expect(railRow?.className).toMatch(/\bpl-11\b/);
    expect(drawerRow?.className).toMatch(/\bpl-11\b/);
  });

  it("tapping a pinned note slides the drawer shut (a destination is a destination)", async () => {
    const { container } = await renderIn(<NavDrawer />);
    await openDrawer(container);
    const row = await within(container).findByRole("link", { name: "Second pinned" });

    await act(async () => {
      row.click();
    });

    expect(
      container.querySelector('[data-nav-projection="drawer"]')?.getAttribute("data-drawer-open"),
    ).toBe("false");
  });

  it("the CLOSED drawer shows no pinned notes — the 56px rail is a handle, not a list", async () => {
    const { container } = await renderIn(<NavDrawer />);
    // Give the query the same room to settle the open case gets, so this is an
    // "it isn't rendered" verdict and not an "it hasn't arrived yet" one.
    await new Promise((r) => setTimeout(r, 50));
    expect(within(container).queryByRole("list", { name: "Pinned notes" })).toBeNull();
    await openDrawer(container);
    expect(await within(container).findByRole("list", { name: "Pinned notes" })).toBeTruthy();
  });

  it("no pinned notes ⇒ no list, no empty shell, in any projection", async () => {
    installPinnedFetch([]);
    const { container: railC } = await renderIn(<Rail />);
    const { container: drawerC } = await renderIn(<NavDrawer />);
    await openDrawer(drawerC);
    const { container: sheetC } = await renderIn(<NavSheet open onClose={() => {}} />);

    await waitFor(() => {
      for (const container of [railC, drawerC, sheetC]) {
        expect(within(container).queryByRole("list", { name: "Pinned notes" })).toBeNull();
      }
    });
  });

  it("three projections in one tree share ONE pinned fetch (they read one cache key)", async () => {
    const fetchImpl = installPinnedFetch(PINNED);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = await renderIn(
      <>
        <Rail />
        <NavDrawer />
        <NavSheet open onClose={() => {}} />
      </>,
      client,
    );
    await openDrawer(container);
    // All three really rendered their list…
    await waitFor(() =>
      expect(within(container).getAllByRole("list", { name: "Pinned notes" })).toHaveLength(3),
    );
    // …off a single request. The breakpoint contract is CSS-only, so the two
    // projections outside the current band are mounted-but-hidden: a per-
    // projection fetch would mean paying three times at every width.
    const pinnedFetches = fetchImpl.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("/api/notes") && url.includes("tag=pinned"));
    expect(pinnedFetches.length).toBe(1);
  });

  it("renders nothing at all with no active vault", async () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    const { container } = await renderIn(
      <>
        <Rail />
        <NavSheet open onClose={() => {}} />
      </>,
    );
    expect(within(container).queryByRole("list", { name: "Pinned notes" })).toBeNull();
  });
});
