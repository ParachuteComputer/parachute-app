import { TagPage } from "@/app/routes/TagPage";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// TagPage (tag-page wave): `/tags/:name` renders a view DERIVED from the tag's
// own schema — a typed tag as a table, a plain tag as a list. No backing note,
// so the synthetic-id safety (no "Edit view note" link, no Save that would
// PATCH `derived:tag:<name>`) is the load-bearing thing these tests pin.
// Fetch-stub style mirrors ViewSurface.test.tsx.

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
  /** The tag-identity row `getTag` returns, or `null` to 404 (a plain tag). */
  tag: Record<string, unknown> | null;
  results: Record<string, unknown>[];
}

function installFetch(state: FetchState) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    // getTag — `/api/tags/<name>`. Null → 404 (VaultNotFoundError → null),
    // which reads as a plain, schema-less tag.
    if (url.includes("/api/tags/")) {
      if (state.tag === null) {
        return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => state.tag,
        text: async () => "",
      } as Response;
    }
    // The vault-settings note (tag-role resolution) — no `notes` key, so roles
    // fall back to the defaults (archived === "archived").
    if (url.includes("settings")) {
      return { ok: true, status: 200, json: async () => [], text: async () => "" } as Response;
    }
    // queryNotes — the view's results.
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

function renderTagPage(initialPath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/tags/:name" element={<TagPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TagPage", () => {
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

  it("a typed tag (schema fields) opens as a table with its fields as columns", async () => {
    installFetch({
      tag: {
        name: "project",
        fields: { status: { type: "string", enum: ["active", "done"] } },
      },
      results: [
        {
          id: "n1",
          path: "Alpha",
          tags: ["project"],
          metadata: { status: "active" },
          createdAt: "2026-07-01T00:00:00Z",
        },
      ],
    });

    renderTagPage("/tags/project");

    await screen.findByRole("heading", { name: "project" });
    await screen.findByRole("table");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Note",
      "status",
    ]);
    // No backing note → no note-editor bridge.
    expect(screen.queryByRole("link", { name: /edit view note/i })).toBeNull();
    // The back link goes to the tag directory, not All notes.
    expect(screen.getByRole("link", { name: /← tags/i })).toHaveAttribute("href", "/tags");
  });

  it("a plain tag (no schema) opens as the familiar list", async () => {
    installFetch({
      tag: null, // 404 → plain tag
      results: [{ id: "n1", path: "Alpha", tags: ["idea"], createdAt: "2026-07-01T00:00:00Z" }],
    });

    renderTagPage("/tags/idea");

    await screen.findByRole("heading", { name: "idea" });
    const results = await screen.findByRole("region", { name: "Results" });
    expect(results.textContent).toContain("Alpha");
    // A list, never a table.
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("link", { name: /edit view note/i })).toBeNull();
  });

  it("excludes archived notes from the query", async () => {
    const fetchImpl = installFetch({
      tag: null,
      results: [{ id: "n1", path: "Alpha", createdAt: "2026-07-01T00:00:00Z" }],
    });

    renderTagPage("/tags/idea");
    await screen.findByRole("heading", { name: "idea" });

    // The results query carries both the tag and the archived exclusion.
    const notesUrls = fetchImpl.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes("/api/notes") && !u.includes("settings"));
    const last = notesUrls[notesUrls.length - 1] ?? "";
    expect(last).toContain("tag=idea");
    expect(last.toLowerCase()).toContain("archived");
  });

  it("a large tag opens as one bounded page — a visible count, 50 rows, a pager (not all 620)", async () => {
    // The scaling regression this whole fix exists for: a 620-note capture tag
    // rendered a 128,872px-tall page — every note, no count, no pager, and not
    // newest-first. The derived def now pins limit + newest-first, and the
    // canvas pages by offset. This stub honors the URL's limit/offset window so
    // page 1 and page 2 are genuinely distinct fetches.
    const NOTES = Array.from({ length: 620 }, (_, i) => ({
      id: `n${i + 1}`,
      path: `Note ${String(i + 1).padStart(3, "0")}`,
      tags: ["capture/voice"],
      createdAt: "2026-07-01T00:00:00Z",
    }));

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/tags/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ name: "capture/voice", count: 620 }),
          text: async () => "",
        } as Response;
      }
      if (url.includes("settings")) {
        return { ok: true, status: 200, json: async () => [], text: async () => "" } as Response;
      }
      // queryNotes — return exactly the requested window, so paging is real.
      const params = new URL(url).searchParams;
      const limit = Number(params.get("limit") ?? "50");
      const offset = Number(params.get("offset") ?? "0");
      const slice = NOTES.slice(offset, offset + limit);
      return { ok: true, status: 200, json: async () => slice, text: async () => "" } as Response;
    });
    vi.stubGlobal("fetch", fetchImpl);

    renderTagPage(`/tags/${encodeURIComponent("capture/voice")}`);

    // The size of the tag is on the page (the header's stable membership count)…
    await screen.findByRole("heading", { name: "capture/voice" });
    await screen.findByText("620 notes");
    // …and only ONE page renders — the 50th note is present, the 51st (the peek
    // row that proves a next page exists) is fetched but never shown.
    await screen.findByText("Note 050");
    expect(screen.queryByText("Note 051")).toBeNull();
    // Mid-walk the pager shows a BARE range — no "of 620". The archived
    // exclusion means the true result total isn't knowable until the peek proves
    // the end; the tag's own 620 lives in the header, a different quantity.
    await screen.findByText(/^Showing 1[–-]50$/);
    expect(screen.queryByText(/of 620/)).toBeNull();

    // The floor rode the wire: a bounded, newest-first page.
    const firstNotesUrl =
      fetchImpl.mock.calls
        .map(([u]) => String(u))
        .find((u) => u.includes("/api/notes") && !u.includes("settings")) ?? "";
    const p = new URL(firstNotesUrl).searchParams;
    // 50 for the page + 1 for the peek row that decides `hasNext` as a fact.
    expect(p.get("limit")).toBe("51");
    expect(p.get("sort")).toBe("desc");

    // Previous is disabled on page 1; Next advances to the next window.
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await screen.findByText("Note 051");
    expect(screen.queryByText("Note 001")).toBeNull();
    // Still mid-walk (100 < 620) → still a bare range, still no "of 620".
    await screen.findByText(/^Showing 51[–-]100$/);
    expect(screen.queryByText(/of 620/)).toBeNull();
    // The next page fetched the next offset.
    const offsets = fetchImpl.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes("/api/notes") && !u.includes("settings"))
      .map((u) => new URL(u).searchParams.get("offset"));
    expect(offsets).toContain("50");
  });

  it("Next stops at the true end when tag.count overstates the result — the peek decides, not the count", async () => {
    // The #106/#108 merge review's one fold, and the same shape #109 hit on
    // All-notes: `hasNext` must be a FACT (does a peek row exist?), never
    // `lastRow < tag.count`. The tag's own count includes archived notes (and a
    // live refinement narrows further), so a count-based ceiling leaves Next
    // enabled into empty trailing pages. Here the tag reports 120 but only 60
    // notes survive the archived exclusion — the pager must stop at 60.
    const FILTERED = Array.from({ length: 60 }, (_, i) => ({
      id: `n${i + 1}`,
      path: `Note ${String(i + 1).padStart(3, "0")}`,
      tags: ["log"],
      createdAt: "2026-07-01T00:00:00Z",
    }));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/tags/")) {
        // tag.count = 120 (membership incl. archived) — deliberately larger than
        // the 60 the filtered query actually returns.
        return {
          ok: true,
          status: 200,
          json: async () => ({ name: "log", count: 120 }),
          text: async () => "",
        } as Response;
      }
      if (url.includes("settings")) {
        return { ok: true, status: 200, json: async () => [], text: async () => "" } as Response;
      }
      const params = new URL(url).searchParams;
      const limit = Number(params.get("limit") ?? "50");
      const offset = Number(params.get("offset") ?? "0");
      const slice = FILTERED.slice(offset, offset + limit);
      return { ok: true, status: 200, json: async () => slice, text: async () => "" } as Response;
    });
    vi.stubGlobal("fetch", fetchImpl);

    renderTagPage("/tags/log");
    await screen.findByRole("heading", { name: "log" });
    // The header keeps the tag's membership size; the pager does NOT inherit it.
    await screen.findByText("120 notes");
    await screen.findByText(/^Showing 1[–-]50$/);
    expect(screen.queryByText(/of 120/)).toBeNull();

    // Page 2 is the true end: 51–60, ten rows. `tag.count` (120) would keep Next
    // enabled (60 < 120) — the OLD bug. The peek (row 61 absent) disables it, and
    // now that the end is proven the pager shows the exact total.
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText("Note 060");
    await screen.findByText(/^Showing 51[–-]60 of 60$/);
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /previous/i })).toBeEnabled();
  });

  it("exploring (a refinement) never surfaces a Save — there is no note to PATCH", async () => {
    installFetch({
      tag: null,
      results: [{ id: "n1", path: "Alpha", createdAt: "2026-07-01T00:00:00Z" }],
    });

    renderTagPage("/tags/idea");
    await screen.findByRole("heading", { name: "idea" });

    // Add a tag refinement — on a real #view note this would raise the Save bar.
    const addTagInput = await screen.findByLabelText(/add a tag filter/i);
    fireEvent.change(addTagInput, { target: { value: "urgent" } });
    fireEvent.keyDown(addTagInput, { key: "Enter" });

    // The refinement took (its chip is shown) but no Save affordance appears.
    await screen.findByText("+#urgent");
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    expect(screen.queryByText(/view modified/i)).toBeNull();
  });

  it("a tag name with a space deep-links and queries verbatim", async () => {
    const fetchImpl = installFetch({
      tag: null,
      results: [{ id: "n1", path: "Alpha", createdAt: "2026-07-01T00:00:00Z" }],
    });

    renderTagPage(`/tags/${encodeURIComponent("team meeting")}`);
    await screen.findByRole("heading", { name: "team meeting" });

    const notesUrls = fetchImpl.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes("/api/notes") && !u.includes("settings"));
    const last = notesUrls[notesUrls.length - 1] ?? "";
    // The space is carried through verbatim as the tag value (URLSearchParams
    // renders it `+`; parse rather than pin the encoding form).
    expect(new URL(last).searchParams.get("tag")).toBe("team meeting");
  });

  it("a unicode tag name deep-links and renders", async () => {
    installFetch({
      tag: null,
      results: [{ id: "n1", path: "Alpha", createdAt: "2026-07-01T00:00:00Z" }],
    });

    renderTagPage(`/tags/${encodeURIComponent("café")}`);
    await screen.findByRole("heading", { name: "café" });
  });

  it("a tag with a slash in its name (namespace tag) deep-links and renders", async () => {
    const fetchImpl = installFetch({
      tag: null,
      results: [{ id: "n1", path: "Alpha", createdAt: "2026-07-01T00:00:00Z" }],
    });

    renderTagPage(`/tags/${encodeURIComponent("capture/voice")}`);
    await screen.findByRole("heading", { name: "capture/voice" });

    const notesUrls = fetchImpl.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes("/api/notes") && !u.includes("settings"));
    const last = notesUrls[notesUrls.length - 1] ?? "";
    expect(last).toContain(`tag=${encodeURIComponent("capture/voice")}`);
  });

  it("no active vault → redirects home instead of crashing", async () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    installFetch({ tag: null, results: [] });

    const { container } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <MemoryRouter initialEntries={["/tags/idea"]}>
          <Routes>
            <Route path="/tags/:name" element={<TagPage />} />
            <Route path="/" element={<div data-testid="home">home</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
  });
});

// app#113 — the single-decode contract. `useParams` values arrive ALREADY
// decoded (react-router decodes route params at the boundary); the component
// must trust that and never `decodeURIComponent` again. A second decode threw
// on any name with a literal `%` and silently rewrote names containing a
// valid escape sequence. The same pin exists in NoteView.test.tsx,
// NoteEditor.test.tsx, and ViewSurface.test.tsx — all four param routes were
// fixed together so none drifts back to being the odd one out.
describe("TagPage route-param decoding (app#113)", () => {
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

  it("a tag named `100%` gets its page — a literal % used to throw in render", async () => {
    installFetch({ tag: null, results: [] });
    renderTagPage("/tags/100%25");
    await screen.findByRole("heading", { name: "100%" });
  });

  it("a slash in a tag name still round-trips (`capture/voice`)", async () => {
    installFetch({ tag: null, results: [] });
    renderTagPage("/tags/capture%2Fvoice");
    await screen.findByRole("heading", { name: "capture/voice" });
  });

  it("unicode and spaces still round-trip (`café notes`)", async () => {
    installFetch({ tag: null, results: [] });
    renderTagPage("/tags/caf%C3%A9%20notes");
    await screen.findByRole("heading", { name: "café notes" });
  });

  it("a name that merely LOOKS like an escape is not rewritten (`50%20off` stays itself, not `50 off`)", async () => {
    installFetch({ tag: null, results: [] });
    renderTagPage("/tags/50%2520off");
    await screen.findByRole("heading", { name: "50%20off" });
  });
});
