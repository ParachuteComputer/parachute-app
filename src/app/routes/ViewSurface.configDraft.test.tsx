import { ViewSurface } from "@/app/routes/ViewSurface";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The explore-then-save config draft (views train B): the in-place lens
// switcher, the ONE "View modified" bar covering both axes (config draft +
// query refinements), Save-as-partial-patch, Revert-without-a-write, and the
// fork-carries-full-config regression pin. Harness style mirrors
// ViewSurface.test.tsx (one fetchImpl differentiating by URL shape), plus a
// `/api/tags/:name` handler so the tag schema (lens-switch defaults) resolves.

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
  /** TagRecord served for `GET /api/tags/:name` (the primary tag's schema). */
  tag?: Record<string, unknown>;
}

interface Captured {
  patches: { body: Record<string, unknown> }[];
  creates: { body: Record<string, unknown> }[];
}

function installFetch(state: FetchState): {
  fetchImpl: ReturnType<typeof vi.fn>;
  captured: Captured;
} {
  const captured: Captured = { patches: [], creates: [] };
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PATCH") {
      const body = JSON.parse((init?.body as string) ?? "{}");
      captured.patches.push({ body });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ...state.note, ...body }),
        text: async () => "",
      } as Response;
    }
    if (method === "POST" && url.includes("/api/notes")) {
      const body = JSON.parse((init?.body as string) ?? "{}");
      captured.creates.push({ body });
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "new-view-id", createdAt: "2026-07-24T00:00:00Z", ...body }),
        text: async () => "",
      } as Response;
    }
    if (url.includes("/api/tags/")) {
      return {
        ok: true,
        status: 200,
        json: async () => state.tag ?? { name: "project" },
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
  return { fetchImpl, captured };
}

/** Result-set fetches only — the view-note, settings, and tag-schema reads excluded. */
function resultFetchCount(fetchImpl: ReturnType<typeof vi.fn>): number {
  return fetchImpl.mock.calls.filter(([u]) => {
    const s = String(u);
    return !s.includes("id=v1") && !s.includes("settings") && !s.includes("/api/tags/");
  }).length;
}

function Wrapper({ children, entry }: { children: ReactNode; entry: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/views/:id" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderViewSurface(entry = "/views/v1") {
  return render(<ViewSurface />, {
    wrapper: ({ children }) => (<Wrapper entry={entry}>{children}</Wrapper>) as never,
  });
}

const PROJECT_TAG_SCHEMA = {
  name: "project",
  fields: {
    title: { type: "string" },
    status: { type: "string", enum: ["active", "done"] },
    due: { type: "date" },
  },
};

function listViewNote(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    path: "Views/Projects",
    tags: ["view"],
    updatedAt: "2026-07-20T00:00:00Z",
    metadata: { kind: "list", query: JSON.stringify({ tag: "project" }) },
    ...overrides,
  };
}

const PROJECT_RESULTS = [
  {
    id: "n1",
    path: "Alpha",
    tags: ["project"],
    metadata: { status: "active" },
    createdAt: "2026-07-01T00:00:00Z",
  },
  {
    id: "n2",
    path: "Beta",
    tags: ["project"],
    metadata: { status: "done" },
    createdAt: "2026-07-02T00:00:00Z",
  },
];

/** Mounted + tag schema resolved (the field chips name the schema's fields). */
async function awaitReady() {
  await screen.findByRole("heading", { name: "Projects" });
  await screen.findByRole("region", { name: "Results" });
  await waitFor(() => expect(screen.getAllByText("status").length).toBeGreaterThan(0));
}

/** V3: the lens is a dropdown — open the pill, pick the kind from its menu. */
async function switchLens(kind: string) {
  fireEvent.click(screen.getByRole("button", { name: /^lens:/i }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: kind }));
}

describe("ViewSurface config draft (views train B)", () => {
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

  it("clean view: no modified bar, and the lens switcher marks the saved kind", async () => {
    installFetch({ note: listViewNote(), results: PROJECT_RESULTS, tag: PROJECT_TAG_SCHEMA });
    renderViewSurface();
    await awaitReady();

    expect(screen.queryByText("View modified")).toBeNull();
    // The lens pill wears the saved kind on its face…
    fireEvent.click(screen.getByRole("button", { name: "Lens: List" }));
    // …and its menu marks it current.
    expect(await screen.findByRole("menuitemradio", { name: "List" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Board" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("lens switch: board defaults its group-by to the first enum field, shows the bar, and does NOT refetch", async () => {
    const { fetchImpl } = installFetch({
      note: listViewNote(),
      results: PROJECT_RESULTS,
      tag: PROJECT_TAG_SCHEMA,
    });
    renderViewSurface();
    await awaitReady();

    const before = resultFetchCount(fetchImpl);
    // Positive control: the count filter provably sees the initial fetch —
    // otherwise "no new fetches" would pass vacuously.
    expect(before).toBeGreaterThan(0);
    await switchLens("Board");

    // The SAME cached result set re-renders as lanes — grouped by `status`
    // (the first enum-typed field; `title` has no enum), uncategorized none.
    const activeLane = await screen.findByRole("region", { name: "active" });
    expect(activeLane.textContent).toContain("Alpha");
    expect(screen.getByRole("region", { name: "done" }).textContent).toContain("Beta");

    // One bar covers the divergence — wearing its V6 voice (state + what Save
    // does, not just that state exists) and the pulse dot…
    expect(screen.getByText("View modified")).toBeTruthy();
    expect(screen.getByText(/you're exploring\. Save to keep this layout\./)).toBeTruthy();
    expect(document.querySelector(".view-modified-pulse")).not.toBeNull();
    // …and the switch was lossless: zero new result fetches.
    expect(resultFetchCount(fetchImpl)).toBe(before);
  });

  // Review must-fix regression: Board auto-adds a group-by; switching back
  // to List must shed it too, or the bar stays up forever with zero visual
  // divergence (the Gallery variant below never trips this — gallery
  // auto-adds nothing — so BOTH lens paths are pinned).
  it("peek at Board and back to List leaves no residue — the bar disappears", async () => {
    const { captured } = installFetch({
      note: listViewNote(),
      results: PROJECT_RESULTS,
      tag: PROJECT_TAG_SCHEMA,
    });
    renderViewSurface();
    await awaitReady();

    await switchLens("Board");
    await screen.findByRole("region", { name: "active" });
    expect(screen.getByText("View modified")).toBeTruthy();

    await switchLens("List");
    await screen.findByRole("region", { name: "Results" });
    await waitFor(() => expect(screen.queryByText("View modified")).toBeNull());
    // And nothing was written by the round trip.
    expect(captured.patches).toHaveLength(0);
    expect(captured.creates).toHaveLength(0);
  });

  // Review should-fix: the draft is normalized on READ too — a shared link
  // whose params equal the saved config is no divergence.
  it("a shared link carrying config equal to the saved view raises no bar", async () => {
    installFetch({ note: listViewNote(), results: PROJECT_RESULTS, tag: PROJECT_TAG_SCHEMA });
    renderViewSurface("/views/v1?kind=list");
    await awaitReady();
    expect(screen.queryByText("View modified")).toBeNull();
  });

  it("switching back to the saved lens clears the draft — the bar disappears (normalization)", async () => {
    installFetch({ note: listViewNote(), results: PROJECT_RESULTS, tag: PROJECT_TAG_SCHEMA });
    renderViewSurface();
    await awaitReady();

    await switchLens("Gallery");
    expect(await screen.findByText("View modified")).toBeTruthy();

    await switchLens("List");
    await waitFor(() => expect(screen.queryByText("View modified")).toBeNull());
  });

  it("refinements alone raise the same bar; clearing them lowers it", async () => {
    installFetch({ note: listViewNote(), results: PROJECT_RESULTS, tag: PROJECT_TAG_SCHEMA });
    renderViewSurface();
    await awaitReady();

    const addTagInput = screen.getByLabelText(/add a tag filter/i);
    fireEvent.change(addTagInput, { target: { value: "urgent" } });
    fireEvent.keyDown(addTagInput, { key: "Enter" });
    expect(await screen.findByText("View modified")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /remove refinement \+#urgent/i }));
    await waitFor(() => expect(screen.queryByText("View modified")).toBeNull());
  });

  it("Revert discards the exploration without any write", async () => {
    const { captured } = installFetch({
      note: listViewNote(),
      results: PROJECT_RESULTS,
      tag: PROJECT_TAG_SCHEMA,
    });
    renderViewSurface();
    await awaitReady();

    await switchLens("Board");
    await screen.findByRole("region", { name: "active" });

    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    // Back to the saved list rendering, bar gone…
    await screen.findByRole("region", { name: "Results" });
    expect(screen.queryByText("View modified")).toBeNull();
    // …and nothing was written.
    expect(captured.patches).toHaveLength(0);
    expect(captured.creates).toHaveLength(0);
  });

  it("Save (update) writes the partial patch — kind + query + only the overridden config keys — with if_updated_at, then clears the draft", async () => {
    const sub = "user-1";
    seedStore(fakeJwt(sub));
    const { captured } = installFetch({
      note: listViewNote({ createdBy: sub }),
      results: PROJECT_RESULTS,
      tag: PROJECT_TAG_SCHEMA,
    });
    renderViewSurface();
    await awaitReady();

    await switchLens("Board");
    await screen.findByRole("region", { name: "active" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog", { name: /save this view/i });
    expect(screen.getByLabelText(/update this view/i)).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(captured.patches).toHaveLength(1));
    const body = captured.patches[0].body;
    expect(body.metadata).toEqual({
      kind: "board",
      query: JSON.stringify({ tag: "project" }),
      group_by: "status",
    });
    expect(body.if_updated_at).toBe("2026-07-20T00:00:00Z");
    // Saved → the draft params are cleared and the bar stands down.
    await waitFor(() => expect(screen.queryByText("View modified")).toBeNull());
    expect(captured.creates).toHaveLength(0);
  });

  // Regression pin (the train-B fix): fork used to write only kind+query,
  // silently DROPPING group_by/date_field/fields — forking a board lost its
  // lanes. Fork now writes the FULL effective config.
  it("fork carries the full effective config — a forked board keeps its lanes and field set", async () => {
    seedStore(fakeJwt("user-1"));
    const { captured } = installFetch({
      note: listViewNote({
        path: "Views/Team board",
        createdBy: "user-2",
        metadata: {
          kind: "board",
          group_by: "status",
          date_field: "due",
          fields: JSON.stringify(["status", "due"]),
          query: JSON.stringify({ tag: "project" }),
        },
      }),
      results: PROJECT_RESULTS,
      tag: PROJECT_TAG_SCHEMA,
    });
    renderViewSurface();
    await screen.findByRole("heading", { name: "Team board" });
    await screen.findByRole("region", { name: "active" });

    // Diverge on the QUERY axis only — no config draft in play.
    const addTagInput = screen.getByLabelText(/add a tag filter/i);
    fireEvent.change(addTagInput, { target: { value: "urgent" } });
    fireEvent.keyDown(addTagInput, { key: "Enter" });

    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog", { name: /save this view/i });
    expect(screen.getByLabelText(/save as new view/i)).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(captured.creates).toHaveLength(1));
    const body = captured.creates[0].body;
    expect(body.tags).toEqual(["view"]);
    const metadata = body.metadata as Record<string, string>;
    expect(metadata.kind).toBe("board");
    expect(metadata.group_by).toBe("status");
    expect(metadata.date_field).toBe("due");
    expect(metadata.fields).toBe(JSON.stringify(["status", "due"]));
    expect(JSON.parse(metadata.query)).toEqual({ tag: ["project", "urgent"], tag_match: "all" });
    expect(captured.patches).toHaveLength(0);
  });

  // --- The Fields control (views train C) — the field-set axis of the same
  // draft: edits write the ordered list into the URL, the one bar governs
  // Save/Revert, Save writes `fields` as a JSON-string array (the decoder's
  // wire shape).

  it("Fields control: unchecking a schema field writes the ordered draft, raises the bar, and Save patches `fields` as a JSON-string array", async () => {
    const sub = "user-1";
    seedStore(fakeJwt(sub));
    const { captured } = installFetch({
      note: listViewNote({ createdBy: sub }),
      results: PROJECT_RESULTS,
      tag: PROJECT_TAG_SCHEMA,
    });
    renderViewSurface();
    await awaitReady();

    fireEvent.click(screen.getByRole("button", { name: /^fields/i }));
    const dialog = await screen.findByRole("dialog", { name: "Fields" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "title" }));

    // The draft is live: the bar raises, and the unchecked field drops to
    // the hidden (uncheckable-back) section of the still-open panel.
    expect(await screen.findByText("View modified")).toBeTruthy();
    await waitFor(() =>
      expect(
        (within(dialog).getByRole("checkbox", { name: "title" }) as HTMLInputElement).checked,
      ).toBe(false),
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const sheet = await screen.findByRole("dialog", { name: /save this view/i });
    fireEvent.click(within(sheet).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(captured.patches).toHaveLength(1));
    // Ordered, schema-order-preserving, JSON-string wire shape — and ONLY
    // the fields key overridden beyond the kind+query baseline.
    expect(captured.patches[0].body.metadata).toEqual({
      kind: "list",
      query: JSON.stringify({ tag: "project" }),
      fields: JSON.stringify(["status", "due"]),
    });
  });

  it("Fields control: up/down reorder round-trips through the URL draft into the saved order", async () => {
    const sub = "user-1";
    seedStore(fakeJwt(sub));
    const { captured } = installFetch({
      note: listViewNote({ createdBy: sub }),
      results: PROJECT_RESULTS,
      tag: PROJECT_TAG_SCHEMA,
    });
    renderViewSurface();
    await awaitReady();

    fireEvent.click(screen.getByRole("button", { name: /^fields/i }));
    const dialog = await screen.findByRole("dialog", { name: "Fields" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move status up" }));
    expect(await screen.findByText("View modified")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const sheet = await screen.findByRole("dialog", { name: /save this view/i });
    fireEvent.click(within(sheet).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(captured.patches).toHaveLength(1));
    const metadata = captured.patches[0].body.metadata as Record<string, string>;
    expect(JSON.parse(metadata.fields)).toEqual(["status", "title", "due"]);
  });

  it("the Fields control rides the config row for every lens kind", async () => {
    installFetch({ note: listViewNote(), results: PROJECT_RESULTS, tag: PROJECT_TAG_SCHEMA });
    renderViewSurface();
    await awaitReady();

    expect(screen.getByRole("button", { name: /^fields/i })).toBeTruthy();
    await switchLens("Board");
    await screen.findByRole("region", { name: "active" });
    expect(screen.getByRole("button", { name: /^fields/i })).toBeTruthy();
    await switchLens("Calendar");
    await screen.findByRole("button", { name: /^by date/i });
    expect(screen.getByRole("button", { name: /^fields/i })).toBeTruthy();
    await switchLens("Gallery");
    expect(screen.getByRole("button", { name: /^fields/i })).toBeTruthy();
  });

  it("calendar lens exposes the By-date pill; board's Group-by pill lists the schema fields", async () => {
    installFetch({ note: listViewNote(), results: PROJECT_RESULTS, tag: PROJECT_TAG_SCHEMA });
    renderViewSurface();
    await awaitReady();

    await switchLens("Calendar");
    // Defaulted to the first date-typed field — worn on the pill's face.
    await screen.findByRole("button", { name: "By date due" });
    expect(screen.queryByRole("button", { name: /^group by/i })).toBeNull();

    await switchLens("Board");
    const groupPill = await screen.findByRole("button", { name: "Group by status" });
    expect(screen.queryByRole("button", { name: /^by date/i })).toBeNull();
    fireEvent.click(groupPill);
    const menu = await screen.findByRole("menu", { name: "Group by" });
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((o) => o.textContent?.replace("✓", "")),
    ).toEqual(["title", "status", "due"]);
    expect(within(menu).getByRole("menuitemradio", { name: "status" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  // --- The organize-by axis as a first-class control (polish V3): the pill
  // writes groupBy/dateField into the SAME draft, and the two empty states
  // must render — a vanished control can't explain what organizes the view.

  it("Group-by pill: picking a field writes the draft, raises the bar, and Save patches group_by", async () => {
    seedStore(fakeJwt("user-1"));
    const { captured } = installFetch({
      note: listViewNote({
        createdBy: "user-1",
        metadata: {
          kind: "board",
          group_by: "status",
          query: JSON.stringify({ tag: "project" }),
        },
      }),
      results: PROJECT_RESULTS,
      tag: PROJECT_TAG_SCHEMA,
    });
    renderViewSurface();
    await screen.findByRole("region", { name: "active" });

    fireEvent.click(screen.getByRole("button", { name: "Group by status" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "title" }));
    // The draft is live: the pill re-faces, the one bar raises.
    await screen.findByRole("button", { name: "Group by title" });
    expect(await screen.findByText("View modified")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const sheet = await screen.findByRole("dialog", { name: /save this view/i });
    fireEvent.click(within(sheet).getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(captured.patches).toHaveLength(1));
    expect((captured.patches[0].body.metadata as Record<string, string>).group_by).toBe("title");
  });

  it("EMPTY STATE (calendar): no date field saved → the By-date pill reads 'created'; picking a date field graduates through the draft", async () => {
    installFetch({
      note: listViewNote({
        metadata: { kind: "calendar", query: JSON.stringify({ tag: "project" }) },
      }),
      results: PROJECT_RESULTS,
      tag: PROJECT_TAG_SCHEMA,
    });
    renderViewSurface();
    await screen.findByRole("heading", { name: "Projects" });

    // The read-only createdAt mode: the pill wears the honest axis…
    const pill = await screen.findByRole("button", { name: "By date created" });
    fireEvent.click(pill);
    // …its menu explains, and lists the schema's date-typed fields.
    expect(await screen.findByText("Showing by created date")).toBeTruthy();
    const menu = screen.getByRole("menu", { name: "By date" });
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((o) => o.textContent?.replace("✓", "")),
    ).toEqual(["due"]);

    // Picking one graduates to editable: the draft carries it, the bar raises,
    // and the calendar's own read-only hint stands down.
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "due" }));
    await screen.findByRole("button", { name: "By date due" });
    expect(screen.getByText("View modified")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText(/showing by created date — set a date field/i)).toBeNull(),
    );
  });

  it("EMPTY STATE (board): a schema-less tag still renders [GROUP BY —] with the explanatory line", async () => {
    installFetch({
      note: listViewNote({
        metadata: { kind: "board", query: JSON.stringify({ tag: "project" }) },
      }),
      results: PROJECT_RESULTS,
      tag: { name: "project" }, // no schema fields
    });
    renderViewSurface();
    await screen.findByRole("heading", { name: "Projects" });

    const pill = await screen.findByRole("button", { name: "Group by —" });
    fireEvent.click(pill);
    expect(
      await screen.findByText("No fields to group by — this view's tag has no schema fields."),
    ).toBeTruthy();
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
  });
});
