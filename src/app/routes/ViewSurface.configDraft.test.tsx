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
    const switcher = screen.getByRole("group", { name: "Lens" });
    expect(within(switcher).getByRole("button", { name: "List" })).toHaveAttribute(
      "aria-pressed",
      "true",
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
    fireEvent.click(screen.getByRole("button", { name: "Board" }));

    // The SAME cached result set re-renders as lanes — grouped by `status`
    // (the first enum-typed field; `title` has no enum), uncategorized none.
    const activeLane = await screen.findByRole("region", { name: "active" });
    expect(activeLane.textContent).toContain("Alpha");
    expect(screen.getByRole("region", { name: "done" }).textContent).toContain("Beta");

    // One bar covers the divergence…
    expect(screen.getByText("View modified")).toBeTruthy();
    // …and the switch was lossless: zero new result fetches.
    expect(resultFetchCount(fetchImpl)).toBe(before);
  });

  it("switching back to the saved lens clears the draft — the bar disappears (normalization)", async () => {
    installFetch({ note: listViewNote(), results: PROJECT_RESULTS, tag: PROJECT_TAG_SCHEMA });
    renderViewSurface();
    await awaitReady();

    fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    expect(await screen.findByText("View modified")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "List" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Board" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Board" }));
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

  it("calendar lens exposes the date-field control; board's group control lists the schema fields", async () => {
    installFetch({ note: listViewNote(), results: PROJECT_RESULTS, tag: PROJECT_TAG_SCHEMA });
    renderViewSurface();
    await awaitReady();

    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    const dateSelect = await screen.findByLabelText(/date field/i);
    // Defaulted to the first date-typed field.
    expect((dateSelect as HTMLSelectElement).value).toBe("due");
    expect(screen.queryByLabelText(/group by/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    const groupSelect = await screen.findByLabelText(/group by/i);
    expect((groupSelect as HTMLSelectElement).value).toBe("status");
    const options = within(groupSelect)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["title", "status", "due"]);
  });
});
