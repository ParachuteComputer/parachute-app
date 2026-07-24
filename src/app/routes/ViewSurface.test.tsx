import { ViewSurface } from "@/app/routes/ViewSurface";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ViewSurface (views-wave-1, VIEWS-RENDER-SPEC): the rendering pipeline —
// decode → (+ refinements) → execute → partition → list. Fetch-stub style
// mirrors VaultSurface.savedViews.test.tsx: one fetchImpl differentiating
// by URL shape, since `getNote` and `queryNotes` both hit `/api/notes` with
// different query params.

function base64url(obj: unknown): string {
  const json = JSON.stringify(obj);
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fakeJwt(sub: string): string {
  return `${base64url({ alg: "none" })}.${base64url({ sub })}.sig`;
}

function seedStore(token = "pvt_abc") {
  useVaultStore.setState({
    vaults: {
      dev: {
        id: "dev",
        url: "http://localhost:1940",
        name: "dev",
        issuer: "http://localhost:1940",
        clientId: "client-test",
        scope: "full",
        addedAt: "2026-04-25T00:00:00.000Z",
        lastUsedAt: "2026-04-25T00:00:00.000Z",
      },
    },
    activeVaultId: "dev",
  });
  localStorage.setItem(
    "lens:token:dev",
    JSON.stringify({ accessToken: token, scope: "full", vault: "default" }),
  );
}

interface FetchState {
  note: Record<string, unknown>;
  results: Record<string, unknown>[];
}

function installFetch(state: FetchState) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PATCH") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ...state.note, ...JSON.parse((init?.body as string) ?? "{}") }),
        text: async () => "",
      } as Response;
    }
    if (method === "POST" && url.includes("/api/notes")) {
      const body = JSON.parse((init?.body as string) ?? "{}");
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "new-view-id", createdAt: "2026-07-17T00:00:00Z", ...body }),
        text: async () => "",
      } as Response;
    }
    if (url.includes("id=v1")) {
      return {
        ok: true,
        status: 200,
        json: async () => [state.note],
        text: async () => "",
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => state.results,
      text: async () => "",
    } as Response;
  });
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/views/v1"]}>
        <Routes>
          <Route path="/views/:id" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderViewSurface() {
  return render(<ViewSurface />, {
    wrapper: ({ children }) => (<Wrapper>{children}</Wrapper>) as never,
  });
}

describe("ViewSurface", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders a well-formed list view's results, pinned notes grouped above the rest", async () => {
    installFetch({
      note: {
        id: "v1",
        path: "Views/Active projects",
        tags: ["view"],
        metadata: { kind: "list", query: JSON.stringify({ tag: "project" }) },
      },
      results: [
        { id: "n1", path: "Alpha", tags: ["project"], createdAt: "2026-07-01T00:00:00Z" },
        {
          id: "n2",
          path: "Beta",
          tags: ["project", "pinned"],
          createdAt: "2026-07-02T00:00:00Z",
        },
      ],
    });

    renderViewSurface();

    await screen.findByRole("heading", { name: "Active projects" });
    const pinnedSection = await screen.findByRole("region", { name: "Pinned" });
    expect(pinnedSection.textContent).toContain("Beta");
    const resultsSection = screen.getByRole("region", { name: "Results" });
    expect(resultsSection.textContent).toContain("Alpha");
    expect(resultsSection.textContent).not.toContain("Beta");
  });

  it("malformed query: shows the problems banner and never fetches results", async () => {
    const fetchImpl = installFetch({
      note: {
        id: "v1",
        path: "Views/Broken",
        tags: ["view"],
        metadata: { kind: "list", query: "{not json" },
      },
      results: [],
    });

    renderViewSurface();

    await screen.findByText(/didn't parse/i);
    await screen.findByText(/nothing is being shown/i);

    // No queryNotes call for the (unparseable) view — only the view note
    // itself and the vault-settings note (role-tag resolution) were fetched.
    const resultsCalls = fetchImpl.mock.calls.filter(
      ([u]) => !String(u).includes("id=v1") && !String(u).includes("settings"),
    );
    expect(resultsCalls).toHaveLength(0);
  });

  it("dropped unknown query keys: banner names them, results still render from the understood remainder", async () => {
    installFetch({
      note: {
        id: "v1",
        path: "Views/Nearby",
        tags: ["view"],
        metadata: { kind: "list", query: JSON.stringify({ tag: "project", near: { id: "x" } }) },
      },
      results: [{ id: "n1", path: "Alpha", createdAt: "2026-07-01T00:00:00Z" }],
    });

    renderViewSurface();

    await screen.findByText(/"near"/);
    await screen.findByText("Alpha");
  });

  // Regression (reviewer-caught, PR #47): a malformed `metadata` operator
  // clause used to throw uncaught inside useViewResults' useMemo — with no
  // app-wide ErrorBoundary, that white-screened the whole component instead
  // of degrading. The view still mounts, the problems banner names it, and
  // the rest of the query (a plain `tag`) still runs.
  it("malformed metadata operator degrades to a problem instead of crashing the surface", async () => {
    installFetch({
      note: {
        id: "v1",
        path: "Views/Bad Metadata",
        tags: ["view"],
        metadata: {
          kind: "list",
          query: JSON.stringify({ tag: "project", metadata: { priority: { badOp: "x" } } }),
        },
      },
      results: [{ id: "n1", path: "Alpha", createdAt: "2026-07-01T00:00:00Z" }],
    });

    renderViewSurface();

    await screen.findByRole("heading", { name: "Bad Metadata" });
    await screen.findByText(/badOp/i);
    await screen.findByText("Alpha");
  });

  it("Save sheet defaults to Update when the signed-in principal created the view", async () => {
    const sub = "user-1";
    seedStore(fakeJwt(sub));
    installFetch({
      note: {
        id: "v1",
        path: "Views/Mine",
        tags: ["view"],
        createdBy: sub,
        metadata: { kind: "list", query: JSON.stringify({ tag: "project" }) },
      },
      results: [],
    });

    renderViewSurface();
    await screen.findByRole("heading", { name: "Mine" });

    // Add a refinement so the Save button appears.
    const addTagInput = await screen.findByLabelText(/add a tag filter/i);
    fireEvent.change(addTagInput, { target: { value: "urgent" } });
    fireEvent.keyDown(addTagInput, { key: "Enter" });

    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    const dialog = await screen.findByRole("dialog", { name: /save this view/i });
    expect(screen.getByLabelText(/update this view/i)).toBeChecked();
    void dialog;
  });

  it("Save sheet defaults to fork when the note wasn't created by the signed-in principal", async () => {
    seedStore(fakeJwt("user-1"));
    installFetch({
      note: {
        id: "v1",
        path: "Views/Someone Else's",
        tags: ["view"],
        createdBy: "user-2",
        metadata: { kind: "list", query: JSON.stringify({ tag: "project" }) },
      },
      results: [],
    });

    renderViewSurface();
    await screen.findByRole("heading", { name: "Someone Else's" });

    const addTagInput = await screen.findByLabelText(/add a tag filter/i);
    fireEvent.change(addTagInput, { target: { value: "urgent" } });
    fireEvent.keyDown(addTagInput, { key: "Enter" });

    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    await screen.findByRole("dialog", { name: /save this view/i });
    expect(screen.getByLabelText(/save as new view/i)).toBeChecked();
  });

  // --- Wave 2b: the board / gallery / calendar kinds ---------------------

  it("board kind: lanes notes by laneBy, a note lands in its lane, uncategorized last", async () => {
    installFetch({
      note: {
        id: "v1",
        path: "Views/Projects",
        tags: ["view"],
        metadata: {
          kind: "board",
          lane_by: "status",
          query: JSON.stringify({ tag: "project" }),
        },
      },
      results: [
        {
          id: "n1",
          path: "Alpha",
          metadata: { status: "active" },
          createdAt: "2026-07-01T00:00:00Z",
        },
        {
          id: "n2",
          path: "Beta",
          metadata: { status: "incubating" },
          createdAt: "2026-07-02T00:00:00Z",
        },
        { id: "n3", path: "Gamma", createdAt: "2026-07-03T00:00:00Z" }, // no status
      ],
    });

    renderViewSurface();
    await screen.findByRole("heading", { name: "Projects" });

    // A note with the field renders inside its lane's region.
    const activeLane = await screen.findByRole("region", { name: "active" });
    expect(activeLane.textContent).toContain("Alpha");
    const incubatingLane = screen.getByRole("region", { name: "incubating" });
    expect(incubatingLane.textContent).toContain("Beta");

    // The uncategorized lane is present, labelled "No status", and LAST.
    const lanes = screen.getAllByRole("region");
    const uncategorized = screen.getByRole("region", { name: "No status" });
    expect(uncategorized.textContent).toContain("Gamma");
    expect(lanes[lanes.length - 1]).toBe(uncategorized);

    // Board is not the list — no Pinned/Results partition bands.
    expect(screen.queryByRole("region", { name: "Results" })).toBeNull();
  });

  it("gallery kind: renders the results as cards, not the list partition", async () => {
    installFetch({
      note: {
        id: "v1",
        path: "Views/Shelf",
        tags: ["view"],
        metadata: { kind: "gallery", query: JSON.stringify({ tag: "reference" }) },
      },
      results: [
        { id: "n1", path: "Reference A", createdAt: "2026-07-01T00:00:00Z" },
        { id: "n2", path: "Reference B", createdAt: "2026-07-02T00:00:00Z" },
      ],
    });

    renderViewSurface();
    await screen.findByRole("heading", { name: "Shelf" });

    // Each result is a card linking to its note.
    expect(await screen.findByRole("link", { name: /Reference A/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Reference B/ })).toBeTruthy();
    // Gallery, not list — no Results partition band.
    expect(screen.queryByRole("region", { name: "Results" })).toBeNull();
  });

  it("calendar kind: places a dated note on its day and omits undated notes with a footnote", async () => {
    installFetch({
      note: {
        id: "v1",
        path: "Views/Meetings",
        tags: ["view"],
        metadata: {
          kind: "calendar",
          date_field: "meeting_date",
          query: JSON.stringify({ tag: "meeting" }),
        },
      },
      results: [
        {
          id: "n1",
          path: "Weekly sync",
          metadata: { meeting_date: "2026-07-14" },
          createdAt: "2026-07-01T00:00:00Z",
        },
        {
          id: "n2",
          path: "Undated chat",
          metadata: {},
          createdAt: "2026-07-02T00:00:00Z",
        },
      ],
    });

    renderViewSurface();
    await screen.findByRole("heading", { name: "Meetings" });
    // Wait for the results to fetch + the calendar to render (the footnote only
    // exists once CalendarView has mounted with data).
    await screen.findByText(/no meeting_date date/i);

    // The dated note appears on the July-14 cell (the cell's button carries
    // both the day number and the note's title chip).
    const cell = screen.getAllByRole("button").find((b) => b.textContent?.includes("Weekly sync"));
    expect(cell).toBeTruthy();
    expect(cell?.textContent).toContain("14");

    // The undated note is not plotted onto the grid.
    expect(screen.queryByText("Undated chat")).toBeNull();
  });

  it("calendar kind with NO date field mounts the read-only createdAt calendar, never the list (train F)", async () => {
    // Local-time construction — the expected day (July 14) holds in any TZ.
    const createdAt = new Date(2026, 6, 14, 12, 0).toISOString();
    installFetch({
      note: {
        id: "v1",
        path: "Views/Meetings",
        tags: ["view"],
        metadata: {
          kind: "calendar",
          // No date_field — pre-train-F this fell through to the list.
          query: JSON.stringify({ tag: "meeting" }),
        },
      },
      results: [{ id: "n1", path: "Weekly sync", metadata: {}, createdAt }],
    });

    renderViewSurface();
    await screen.findByRole("heading", { name: "Meetings" });

    // The read-only calendar mounted: the hint is its signature.
    await screen.findByText(/showing by created date — set a date field to schedule/i);

    // The note is plotted on its createdAt day (the cell carries the day
    // number and the chip).
    const cell = screen.getAllByRole("button").find((b) => b.textContent?.includes("Weekly sync"));
    expect(cell).toBeTruthy();
    expect(cell?.textContent).toContain("14");

    // Not the list — no Results partition band, no undated footnote.
    expect(screen.queryByRole("region", { name: "Results" })).toBeNull();
    expect(screen.queryByText(/aren't shown|isn't shown/)).toBeNull();
  });

  it("table kind (train D): columns from the view's field set, cells editable, title links out", async () => {
    installFetch({
      note: {
        id: "v1",
        path: "Views/Grid",
        tags: ["view"],
        metadata: {
          kind: "table",
          fields: JSON.stringify(["status"]),
          query: JSON.stringify({ tag: "project" }),
        },
      },
      results: [
        {
          id: "n1",
          path: "Alpha",
          metadata: { status: "active" },
          createdAt: "2026-07-01T00:00:00Z",
        },
      ],
    });

    renderViewSurface();
    await screen.findByRole("heading", { name: "Grid" });

    await screen.findByRole("table");
    // Title column first, then the resolved field set in view order.
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Note",
      "status",
    ]);
    // The title cell navigates; the field cell is the shared click-to-edit control.
    expect(screen.getByRole("link", { name: /Alpha/ })).toHaveAttribute("href", "/n/n1");
    expect(screen.getByRole("button", { name: "Edit status" }).textContent).toBe("active");
    // Table, not list — no Results partition band.
    expect(screen.queryByRole("region", { name: "Results" })).toBeNull();
  });

  it("unknown kind still degrades to the list renderer", async () => {
    installFetch({
      note: {
        id: "v1",
        path: "Views/Mystery",
        tags: ["view"],
        metadata: { kind: "mystery", query: JSON.stringify({ tag: "project" }) },
      },
      results: [{ id: "n1", path: "Alpha", createdAt: "2026-07-01T00:00:00Z" }],
    });

    renderViewSurface();
    await screen.findByRole("heading", { name: "Mystery" });
    // The list's Results band is the tell it fell back to list rendering.
    const results = await screen.findByRole("region", { name: "Results" });
    expect(results.textContent).toContain("Alpha");
  });

  it("board kind without lane_by degrades to the list renderer", async () => {
    installFetch({
      note: {
        id: "v1",
        path: "Views/Laneless",
        tags: ["view"],
        metadata: { kind: "board", query: JSON.stringify({ tag: "project" }) },
      },
      results: [{ id: "n1", path: "Alpha", createdAt: "2026-07-01T00:00:00Z" }],
    });

    renderViewSurface();
    await screen.findByRole("heading", { name: "Laneless" });
    const results = await screen.findByRole("region", { name: "Results" });
    expect(results.textContent).toContain("Alpha");
  });
});
