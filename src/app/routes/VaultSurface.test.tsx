import { VaultSurface } from "@/app/routes/VaultSurface";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FetchState {
  notes: unknown[];
  tags: unknown[];
}

function installFetch(state: FetchState) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = url.includes("/api/tags") ? state.tags : state.notes;
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => "",
    } as Response;
  });
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

function seedStore() {
  // Directly mutate zustand state so we don't touch localStorage.
  useVaultStore.setState({
    vaults: {
      dev: {
        id: "dev",
        url: "http://localhost:1940",
        name: "dev",
        issuer: "http://localhost:1940",
        clientId: "client-test",
        scope: "full",
        addedAt: "2026-04-18T00:00:00.000Z",
        lastUsedAt: "2026-04-18T00:00:00.000Z",
      },
    },
    activeVaultId: "dev",
  });
  localStorage.setItem(
    "lens:token:dev",
    JSON.stringify({ accessToken: "pvt_abc", scope: "full", vault: "default" }),
  );
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
}

// W2-11: everything beyond the resting search folds behind ONE "Filters"
// disclosure — tests that touch sort/archived/prefix/tags/views/folders open
// it first, exactly like a user would.
async function openFilters() {
  fireEvent.click(await screen.findByRole("button", { name: /filters/i }));
  await screen.findByRole("region", { name: /^filters$/i });
}

function openFoldersAccordion() {
  const details = document
    .getElementById("notes-filters")
    ?.querySelector("details") as HTMLDetailsElement | null;
  if (!details) throw new Error("Folders accordion not found");
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
}

function lastNotesUrl(fetchImpl: ReturnType<typeof installFetch>): string {
  // The saved-views sidebar also queries /api/notes (tag=view & views path
  // prefix). Filter those out so assertions target the primary list query.
  const calls = fetchImpl.mock.calls.map((c) => String(c[0]));
  const noteCalls = calls.filter(
    (u) => u.includes("/api/notes") && !u.includes("path_prefix=UI%2FViews%2F"),
  );
  return noteCalls[noteCalls.length - 1] ?? "";
}

describe("VaultSurface route (/notes)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
    // BrowserRouter reads from window.history, which persists across tests.
    // Reset so URL-driven filter state doesn't leak between cases.
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders fetched notes with path, preview, tags, and relative time", async () => {
    installFetch({
      notes: [
        {
          id: "n1",
          path: "Projects/lens/README",
          preview: "A lens onto any Parachute Vault.",
          tags: ["project"],
          createdAt: "2026-04-18T10:00:00.000Z",
          updatedAt: "2026-04-18T11:00:00.000Z",
        },
      ],
      tags: [{ name: "project", count: 1 }],
    });

    render(<VaultSurface />, { wrapper: Wrapper });

    const pathLink = await screen.findByText("Projects/lens/README");
    expect(pathLink).toBeInTheDocument();
    expect(screen.getByText(/A lens onto any Parachute Vault\./)).toBeInTheDocument();
    // Tag chip should live inside the same row as the path.
    const row = pathLink.closest("li");
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("project");
  });

  it("debounces the search input and sends the search param after 300ms", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchImpl = installFetch({ notes: [], tags: [] });

    render(<VaultSurface />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes("/api/notes"))).toBe(true);
    });

    const input = screen.getByLabelText(/search notes/i);
    fireEvent.change(input, { target: { value: "hello" } });

    // Debounce: no search= yet right after typing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(lastNotesUrl(fetchImpl)).not.toContain("search=hello");

    // After the full debounce window, the search param lands on the URL.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("search=hello");
    });
  });

  it("toggles sort direction via the Filters panel", async () => {
    const fetchImpl = installFetch({
      notes: [
        {
          id: "n1",
          path: "some-note",
          tags: [],
          createdAt: "2026-04-18T10:00:00.000Z",
        },
      ],
      tags: [],
    });
    render(<VaultSurface />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("sort=desc");
    });

    await openFilters();
    fireEvent.click(screen.getByRole("button", { name: /toggle sort/i }));

    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("sort=asc");
    });
  });

  it("shows empty state when no notes and no active filters", async () => {
    installFetch({ notes: [], tags: [] });
    render(<VaultSurface />, { wrapper: Wrapper });
    expect(await screen.findByText(/this vault has no notes yet/i)).toBeInTheDocument();
  });

  it("shows filtered-empty state and hides the zero-vault copy", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFetch({ notes: [], tags: [] });
    render(<VaultSurface />, { wrapper: Wrapper });

    fireEvent.change(screen.getByLabelText(/search notes/i), { target: { value: "xyz" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(await screen.findByText(/no notes match these filters/i)).toBeInTheDocument();
  });

  it("pinned-first stable sort on default list view", async () => {
    installFetch({
      notes: [
        {
          id: "a",
          path: "plain-one",
          tags: [],
          createdAt: "2026-04-18T10:00:00.000Z",
          updatedAt: "2026-04-18T11:00:00.000Z",
        },
        {
          id: "b",
          path: "pinned-note",
          tags: ["pinned"],
          createdAt: "2026-04-18T09:00:00.000Z",
          updatedAt: "2026-04-18T09:00:00.000Z",
        },
        {
          id: "c",
          path: "plain-two",
          tags: [],
          createdAt: "2026-04-18T08:00:00.000Z",
          updatedAt: "2026-04-18T08:00:00.000Z",
        },
      ],
      tags: [],
    });

    render(<VaultSurface />, { wrapper: Wrapper });

    await screen.findByText("pinned-note");
    const list = screen.getByRole("list", { name: "Notes" });
    const rows = within(list).getAllByRole("listitem");
    const firstRow = within(rows[0]!);
    expect(firstRow.getByText("pinned-note")).toBeInTheDocument();
    // Pin indicator visible on the pinned row.
    expect(firstRow.getByLabelText(/pinned/i)).toBeInTheDocument();
  });

  it("renders the Pinned tags strip inside the Filters panel when the vault has pinned tags", async () => {
    localStorage.setItem("lens:pinned-tags:dev", JSON.stringify(["daily", "idea"]));
    installFetch({
      notes: [
        {
          id: "n1",
          path: "daily-note",
          tags: ["daily"],
          createdAt: "2026-04-18T10:00:00.000Z",
        },
      ],
      tags: [
        { name: "daily", count: 7 },
        { name: "idea", count: 3 },
      ],
    });

    render(<VaultSurface />, { wrapper: Wrapper });
    await openFilters();

    // Strip buttons render as pressable chips, not links, so tag filters apply
    // in-place rather than routing away. The panel's TagBrowser also renders a
    // #daily button — scope the query to the strip explicitly.
    const strip = await screen.findByRole("navigation", { name: /pinned tags/i });
    const dailyChip = within(strip).getByRole("button", { name: /#daily/i });
    expect(dailyChip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(dailyChip);
    await waitFor(() => expect(dailyChip).toHaveAttribute("aria-pressed", "true"));
  });

  it("renders a first-run hint in the pinned-tags strip when no tags are pinned", async () => {
    installFetch({
      notes: [
        {
          id: "n1",
          path: "daily-note",
          tags: ["daily"],
          createdAt: "2026-04-18T10:00:00.000Z",
        },
      ],
      tags: [{ name: "daily", count: 2 }],
    });
    render(<VaultSurface />, { wrapper: Wrapper });
    await screen.findByRole("list", { name: "Notes" });
    await openFilters();
    const strip = await screen.findByRole("navigation", { name: /pinned tags/i });
    expect(within(strip).getByText(/Pin tags here for quick access/i)).toBeInTheDocument();
    expect(within(strip).getByRole("link", { name: /open the tag browser/i })).toHaveAttribute(
      "href",
      "/tags",
    );
    // No pinned-tag chips render in the empty state.
    expect(within(strip).queryByRole("button", { name: /^#/i })).not.toBeInTheDocument();
  });

  it("hides archived notes by default and shows them when toggled on", async () => {
    installFetch({
      notes: [
        {
          id: "a",
          path: "live-note",
          tags: [],
          createdAt: "2026-04-18T10:00:00.000Z",
        },
        {
          id: "b",
          path: "archived-note",
          tags: ["archived"],
          createdAt: "2026-04-18T09:00:00.000Z",
        },
      ],
      tags: [],
    });

    render(<VaultSurface />, { wrapper: Wrapper });

    await screen.findByText("live-note");
    expect(screen.queryByText("archived-note")).not.toBeInTheDocument();

    await openFilters();
    fireEvent.click(screen.getByLabelText(/show archived/i));
    await waitFor(() => {
      expect(screen.getByText("archived-note")).toBeInTheDocument();
    });
  });

  it("preset=pinned sends the pinned role tag and hides the show-archived toggle", async () => {
    const fetchImpl = installFetch({ notes: [], tags: [] });
    render(<VaultSurface preset="pinned" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("tag=pinned");
    });
    // Even with the Filters panel open, a preset view carries no
    // show-archived toggle (presets have their own archived semantics).
    await openFilters();
    expect(screen.queryByLabelText(/show archived/i)).not.toBeInTheDocument();
    // LZ-3: the lens label (eyebrow + hint) names the lens; the H1 is the
    // vault masthead now.
    expect(screen.getByRole("heading", { name: /pinned · starred/i })).toBeInTheDocument();
  });

  it("preset=archived sends the archived role tag", async () => {
    const fetchImpl = installFetch({ notes: [], tags: [] });
    render(<VaultSurface preset="archived" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("tag=archived");
    });
    // Label "Archive" (LENS-SPEC §1 — the param stays view=archived).
    expect(
      screen.getByRole("heading", { name: /archive · set aside, never deleted/i }),
    ).toBeInTheDocument();
  });

  it("renders the path tree once the auto threshold is met", async () => {
    // Five distinct top-level folders trips AUTO_TOP_LEVEL_MIN.
    installFetch({
      notes: ["A", "B", "C", "D", "E"].map((root, i) => ({
        id: `n${i}`,
        path: `${root}/note-${i}.md`,
        createdAt: "2026-04-18T10:00:00.000Z",
        updatedAt: "2026-04-18T10:00:00.000Z",
        tags: [],
      })),
      tags: [],
    });

    render(<VaultSurface />, { wrapper: Wrapper });

    // Folders accordion (inside the Filters panel) is collapsed by default —
    // the tree is lazy-fetched on open.
    await screen.findByText("A/note-0.md");
    await openFilters();
    openFoldersAccordion();
    expect(await screen.findByRole("complementary", { name: /path tree/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^A\b/ })).toBeInTheDocument();
  });

  it("hides the path tree when auto threshold is not met", async () => {
    installFetch({
      notes: [
        {
          id: "n1",
          path: "Solo/note.md",
          createdAt: "2026-04-18T10:00:00.000Z",
          tags: [],
        },
      ],
      tags: [],
    });

    render(<VaultSurface />, { wrapper: Wrapper });

    await screen.findByText("Solo/note.md");
    expect(screen.queryByRole("complementary", { name: /path tree/i })).toBeNull();
  });

  it("mode=always renders the tree even on a tag-flat vault", async () => {
    localStorage.setItem("lens:path-tree:dev", JSON.stringify({ mode: "always" }));
    installFetch({
      notes: [
        {
          id: "n1",
          path: "Solo/note.md",
          createdAt: "2026-04-18T10:00:00.000Z",
          tags: [],
        },
      ],
      tags: [],
    });

    render(<VaultSurface />, { wrapper: Wrapper });
    await screen.findByText("Solo/note.md");
    await openFilters();
    openFoldersAccordion();
    expect(await screen.findByRole("complementary", { name: /path tree/i })).toBeInTheDocument();
  });

  it("mode=never skips the path-tree fetch and hides the tree", async () => {
    localStorage.setItem("lens:path-tree:dev", JSON.stringify({ mode: "never" }));
    const fetchImpl = installFetch({
      notes: ["A", "B", "C", "D", "E"].map((root, i) => ({
        id: `n${i}`,
        path: `${root}/note.md`,
        createdAt: "2026-04-18T10:00:00.000Z",
        tags: [],
      })),
      tags: [],
    });

    render(<VaultSurface />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes("/api/notes"))).toBe(true);
    });
    // Two /api/notes queries fire when the tree is enabled (one filtered, one
    // capped). When `never`, only the filtered list query goes out — so the
    // unfiltered limit=5000 capped query should be absent.
    const treeCall = fetchImpl.mock.calls.find((c) => {
      const u = String(c[0]);
      return u.includes("/api/notes") && u.includes("limit=5000");
    });
    expect(treeCall).toBeUndefined();
    expect(screen.queryByRole("complementary", { name: /path tree/i })).toBeNull();
  });

  it("preset=untagged sends has_tags=false and hides the tag filter", async () => {
    const fetchImpl = installFetch({ notes: [], tags: [] });
    render(<VaultSurface preset="untagged" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("has_tags=false");
    });
    expect(
      screen.getByRole("heading", { name: /untagged · notes without any tags/i }),
    ).toBeInTheDocument();
    // The tags block is absent even inside the open Filters panel — the
    // untagged view is definitionally tag-free.
    await openFilters();
    expect(screen.queryByRole("navigation", { name: /browse by tag/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Tags$/)).not.toBeInTheDocument();
  });

  it("preset=orphaned sends has_links=false", async () => {
    const fetchImpl = installFetch({ notes: [], tags: [] });
    render(<VaultSurface preset="orphaned" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("has_links=false");
    });
    expect(
      screen.getByRole("heading", { name: /orphaned · notes with no links/i }),
    ).toBeInTheDocument();
  });

  it("untagged row has a quick-tag control that PATCHes the note with tags.add", async () => {
    const updated = {
      id: "n1",
      path: "Inbox/loose-thought",
      tags: ["project"],
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    };
    const patchCalls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PATCH") {
        patchCalls.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return {
          ok: true,
          status: 200,
          json: async () => updated,
          text: async () => "",
        } as Response;
      }
      const body = url.includes("/api/tags")
        ? [{ name: "project", count: 5 }]
        : [
            {
              id: "n1",
              path: "Inbox/loose-thought",
              tags: [],
              createdAt: "2026-04-18T10:00:00.000Z",
              updatedAt: "2026-04-18T10:00:00.000Z",
            },
          ];
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => "",
      } as Response;
    });
    vi.stubGlobal("fetch", fetchImpl);

    render(<VaultSurface preset="untagged" />, { wrapper: Wrapper });

    await screen.findByText("Inbox/loose-thought");
    fireEvent.click(screen.getByRole("button", { name: /add tag/i }));

    const tagInput = await screen.findByLabelText(/tag name/i);
    fireEvent.change(tagInput, { target: { value: "project" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });

    await waitFor(() => {
      expect(patchCalls.length).toBe(1);
    });
    expect(patchCalls[0]?.url).toMatch(/\/api\/notes\/n1$/);
    expect(patchCalls[0]?.body).toEqual({ tags: { add: ["project"] } });
  });

  it("the Filters panel renders the tag browser before the collapsed Folders details", async () => {
    installFetch({
      notes: ["A", "B", "C", "D", "E"].map((root, i) => ({
        id: `n${i}`,
        path: `${root}/note-${i}.md`,
        createdAt: "2026-04-18T10:00:00.000Z",
        tags: [],
      })),
      tags: [{ name: "idea", count: 2 }],
    });

    render(<VaultSurface />, { wrapper: Wrapper });
    await openFilters();

    const tagNav = await screen.findByRole("navigation", { name: /browse by tag/i });
    const panel = document.getElementById("notes-filters");
    expect(panel).not.toBeNull();
    expect(panel?.contains(tagNav)).toBe(true);
    // Folders is a collapsed <details> in the panel's views column.
    const details = await waitFor(() => {
      const d = (panel as HTMLElement).querySelector("details");
      expect(d).not.toBeNull();
      return d as HTMLDetailsElement;
    });
    expect(details.open).toBe(false);
    const summary = details.querySelector("summary");
    expect(summary?.textContent).toContain("Folders");
    // Tag-browser nav appears earlier in document order than the Folders group.
    const comparison = tagNav.compareDocumentPosition(details);
    expect(comparison & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("clicking a tree folder writes path_prefix to the URL", async () => {
    const fetchImpl = installFetch({
      notes: ["Canon", "B", "C", "D", "E"].map((root, i) => ({
        id: `n${i}`,
        path: `${root}/note-${i}.md`,
        createdAt: "2026-04-18T10:00:00.000Z",
        tags: [],
      })),
      tags: [],
    });

    render(<VaultSurface />, { wrapper: Wrapper });

    // Folders accordion starts closed; open it so the tree query fires.
    await screen.findByText("Canon/note-0.md");
    await openFilters();
    openFoldersAccordion();

    const canonNode = await screen.findByRole("button", { name: /^Canon\b/ });
    fireEvent.click(canonNode);

    await waitFor(() => {
      expect(window.location.search).toContain("path_prefix=Canon");
    });
    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("path_prefix=Canon");
    });
  });

  it("does not fetch the path-tree query while the Folders accordion is closed", async () => {
    const fetchImpl = installFetch({
      notes: ["A", "B", "C", "D", "E"].map((root, i) => ({
        id: `n${i}`,
        path: `${root}/note-${i}.md`,
        createdAt: "2026-04-18T10:00:00.000Z",
        tags: [],
      })),
      tags: [],
    });

    render(<VaultSurface />, { wrapper: Wrapper });

    // Wait for the main notes list to settle so we know queries had a chance.
    await screen.findByText("A/note-0.md");

    const pathTreeCalls = fetchImpl.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/api/notes") && u.includes("limit=5000"));
    expect(pathTreeCalls.length).toBe(0);

    // Opening the accordion (inside the Filters panel) triggers the fetch.
    await openFilters();
    openFoldersAccordion();

    await waitFor(() => {
      const after = fetchImpl.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes("/api/notes") && u.includes("limit=5000"));
      expect(after.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // W2-11 — progressive disclosure, re-baselined by LZ-3: the resting chrome
  // is search + ONE Filters disclosure (the desktop view-chip row retired —
  // the rail owns the lens set now), everything else folds behind the
  // Filters disclosure, and a fresh empty vault gets no wall at all.
  // -------------------------------------------------------------------------

  it("rests with exactly two controls: search and Filters (chips retired, the wall folded)", async () => {
    installFetch({
      notes: [
        {
          id: "n1",
          path: "some-note",
          tags: ["idea"],
          createdAt: "2026-04-18T10:00:00.000Z",
        },
      ],
      tags: [{ name: "idea", count: 1 }],
    });
    render(<VaultSurface />, { wrapper: Wrapper });
    await screen.findByText("some-note");

    // The two resting controls.
    const chrome = document.querySelector("[data-notes-chrome]") as HTMLElement;
    expect(chrome).not.toBeNull();
    expect(within(chrome).getByLabelText(/search notes/i)).toBeInTheDocument();
    const filtersBtn = within(chrome).getByRole("button", { name: /filters/i });
    expect(filtersBtn).toHaveAttribute("aria-expanded", "false");

    // Census: the resting chrome holds exactly TWO interactive controls —
    // the search field and the Filters button. The composer sits above,
    // outside the chrome block; the lens set lives in the rail.
    const interactive = Array.from(
      chrome.querySelectorAll("button, input, select, textarea, summary, a"),
    );
    expect(interactive).toHaveLength(2);

    // LZ-3: the desktop chip row is gone from the resting surface entirely.
    expect(screen.queryByRole("navigation", { name: /^views$/i })).not.toBeInTheDocument();

    // The lens label names the lens over the list (eyebrow + quiet hint).
    expect(
      screen.getByRole("heading", { name: /all notes · everything, searchable/i }),
    ).toBeInTheDocument();

    // The old wall is genuinely folded — none of it renders at rest.
    expect(screen.queryByRole("button", { name: /toggle sort/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/show archived/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/filter by path prefix/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /browse by tag/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /pinned tags/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /saved views/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Folders$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /show only/i })).not.toBeInTheDocument();
  });

  it("the Filters disclosure opens the folded controls and closes cleanly", async () => {
    installFetch({
      notes: [
        {
          id: "n1",
          path: "some-note",
          tags: ["idea"],
          createdAt: "2026-04-18T10:00:00.000Z",
        },
      ],
      tags: [{ name: "idea", count: 1 }],
    });
    render(<VaultSurface />, { wrapper: Wrapper });
    await screen.findByText("some-note");

    const filtersBtn = screen.getByRole("button", { name: /filters/i });
    fireEvent.click(filtersBtn);
    expect(filtersBtn).toHaveAttribute("aria-expanded", "true");

    // The whole wall lives in the panel.
    const panel = await screen.findByRole("region", { name: /^filters$/i });
    expect(within(panel).getByRole("button", { name: /toggle sort/i })).toBeInTheDocument();
    expect(within(panel).getByLabelText(/show archived/i)).toBeInTheDocument();
    expect(within(panel).getByLabelText(/filter by path prefix/i)).toBeInTheDocument();
    expect(within(panel).getByRole("navigation", { name: /browse by tag/i })).toBeInTheDocument();
    expect(within(panel).getByRole("navigation", { name: /pinned tags/i })).toBeInTheDocument();

    // Close: the panel unmounts, nothing lingers.
    fireEvent.click(filtersBtn);
    expect(filtersBtn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: /^filters$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /toggle sort/i })).not.toBeInTheDocument();
  });

  it("the closed Filters button wears a count badge when folded filters are active", async () => {
    // Arrive with a shared/deep-linked filter URL — the panel stays closed
    // ("remember nothing surprising") but the active state must show.
    window.history.replaceState({}, "", "/?tag=idea&path_prefix=Projects");
    installFetch({
      notes: [
        {
          id: "n1",
          path: "Projects/some-note",
          tags: ["idea"],
          createdAt: "2026-04-18T10:00:00.000Z",
        },
      ],
      tags: [{ name: "idea", count: 1 }],
    });
    render(<VaultSurface />, { wrapper: Wrapper });
    await screen.findByText("some-note");

    const filtersBtn = screen.getByRole("button", { name: /filters/i });
    expect(filtersBtn).toHaveAttribute("aria-expanded", "false");
    // Two folded dimensions live: the tag pick and the path prefix.
    expect(filtersBtn.textContent).toContain("2");
  });

  it("a fresh empty vault shows ONLY the masthead + composer + search + the empty state — no filter wall, no pager", async () => {
    installFetch({ notes: [], tags: [] });
    render(<VaultSurface />, { wrapper: Wrapper });

    expect(await screen.findByText(/this vault has no notes yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create one/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/search notes/i)).toBeInTheDocument();
    // LZ-3: the composer is the writing invitation on the fresh All lens.
    expect(screen.getByLabelText(/what's on your mind\?/i)).toBeInTheDocument();

    // No filter chrome over nothing: no Filters disclosure, no folded
    // controls, no chip row, no lens label over nothing, no pagination.
    expect(screen.queryByRole("button", { name: /filters/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /toggle sort/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/show archived/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/filter by path prefix/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /pinned tags/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /^views$/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /all notes · everything, searchable/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /previous/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /next/i })).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // LZ-3 — the one surface: vault masthead, composer-on-All, lens labels,
  // maintenance views folded into the Filters panel.
  // -------------------------------------------------------------------------

  it("leads with the vault masthead — the vault name is the H1 on every lens", async () => {
    installFetch({ notes: [], tags: [] });
    const all = render(<VaultSurface />, { wrapper: Wrapper });
    await screen.findByText(/this vault has no notes yet/i);
    expect(screen.getByRole("heading", { level: 1, name: "dev" })).toBeInTheDocument();
    expect(screen.getByText(/everything here is yours\. open format\./i)).toBeInTheDocument();
    // "All notes" is a lens label now, never a headline.
    expect(screen.queryByRole("heading", { level: 1, name: /all notes/i })).toBeNull();
    all.unmount();

    // Browse lens: same masthead, same identity.
    render(<VaultSurface preset="pinned" />, { wrapper: Wrapper });
    await screen.findByRole("heading", { name: /pinned · starred/i });
    expect(screen.getByRole("heading", { level: 1, name: "dev" })).toBeInTheDocument();
  });

  it("mounts the composer on the All lens, above the search chrome", async () => {
    installFetch({
      notes: [{ id: "n1", path: "some-note", tags: [], createdAt: "2026-04-18T10:00:00.000Z" }],
      tags: [],
    });
    render(<VaultSurface />, { wrapper: Wrapper });
    await screen.findByText("some-note");

    const composerInput = screen.getByLabelText(/what's on your mind\?/i);
    expect(composerInput).toBeInTheDocument();
    // Anatomy order (§3): composer above the search/Filters chrome.
    const searchInput = screen.getByLabelText(/search notes/i);
    expect(
      composerInput.compareDocumentPosition(searchInput) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the composer OFF the browse lenses and maintenance views", async () => {
    installFetch({ notes: [], tags: [] });
    const cases: Array<["pinned" | "archived" | "untagged" | "orphaned", RegExp]> = [
      ["pinned", /pinned · starred/i],
      ["archived", /archive · set aside, never deleted/i],
      ["untagged", /untagged · notes without any tags/i],
      ["orphaned", /orphaned · notes with no links/i],
    ];
    for (const [preset, label] of cases) {
      const view = render(<VaultSurface preset={preset} />, { wrapper: Wrapper });
      await screen.findByRole("heading", { name: label });
      expect(screen.queryByLabelText(/what's on your mind\?/i)).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("derives the lens from the ?view= URL param — old bookmarks keep working", async () => {
    const fetchImpl = installFetch({ notes: [], tags: [] });
    window.history.replaceState({}, "", "/notes?view=pinned");
    render(<VaultSurface />, { wrapper: Wrapper });

    expect(await screen.findByRole("heading", { name: /pinned · starred/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/what's on your mind\?/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("tag=pinned");
    });
  });

  it("folds Untagged/Orphaned into the Filters panel as Show-only links (their ?view= URLs preserved)", async () => {
    installFetch({
      notes: [{ id: "n1", path: "some-note", tags: [], createdAt: "2026-04-18T10:00:00.000Z" }],
      tags: [],
    });
    render(<VaultSurface />, { wrapper: Wrapper });
    await screen.findByText("some-note");
    await openFilters();

    const row = screen.getByRole("navigation", { name: /show only/i });
    expect(within(row).getByRole("link", { name: "Untagged" })).toHaveAttribute(
      "href",
      "/notes?view=untagged",
    );
    expect(within(row).getByRole("link", { name: "Orphaned" })).toHaveAttribute(
      "href",
      "/notes?view=orphaned",
    );
  });

  it("marks the active maintenance view in the Show-only row and links it back to /notes", async () => {
    installFetch({ notes: [], tags: [] });
    render(<VaultSurface preset="untagged" />, { wrapper: Wrapper });
    await screen.findByRole("heading", { name: /untagged · notes without any tags/i });
    await openFilters();

    const row = screen.getByRole("navigation", { name: /show only/i });
    const untagged = within(row).getByRole("link", { name: "Untagged" });
    expect(untagged).toHaveAttribute("aria-current", "page");
    expect(untagged).toHaveAttribute("href", "/notes");
    expect(within(row).getByRole("link", { name: "Orphaned" })).toHaveAttribute(
      "href",
      "/notes?view=orphaned",
    );
  });

  it("constrains long paths and tag chips inside the note row instead of overflowing", async () => {
    // A real-world long path and a slash-delimited tag with no whitespace
    // would previously push the card past the right edge on 360px viewports.
    const longPath =
      "Work/Projects/Parachute/launch-week/summary-with-a-very-long-filename-2026-04-22.md";
    const longTag = "summary/monthly-2026-01-draft-v2-extended";
    installFetch({
      notes: [
        {
          id: "n1",
          path: longPath,
          tags: [longTag],
          createdAt: "2026-04-18T10:00:00.000Z",
        },
      ],
      tags: [{ name: longTag, count: 1 }],
    });

    render(<VaultSurface />, { wrapper: Wrapper });

    const pathSpan = await screen.findByText(longPath);
    // The path must live inside a flex-item with min-w-0 AND truncate;
    // otherwise truncate never engages and the cell expands to content.
    expect(pathSpan.className).toMatch(/\bmin-w-0\b/);
    expect(pathSpan.className).toMatch(/\btruncate\b/);

    // The tag chip must cap to parent width and break long unbroken strings
    // so it can't blow out the card on mobile. Scope to the note row since
    // TagBrowser in the sidebar also renders the tag label.
    const row = pathSpan.closest("li") as HTMLElement;
    expect(row).not.toBeNull();
    const chip = within(row).getByText(`#${longTag}`);
    expect(chip.className).toMatch(/\bmax-w-full\b/);
    expect(chip.className).toMatch(/\bbreak-all\b/);
  });
});
