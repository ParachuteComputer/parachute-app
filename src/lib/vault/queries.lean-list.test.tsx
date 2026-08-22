import { RecentTimeline } from "@/components/RecentTimeline";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTE_QUERY } from "./note-query";
import {
  DateViewOverflowError,
  useAllNotesForSwitcher,
  useAllNotesWithLinks,
  useNotes,
  useNotesForDateViews,
} from "./queries";
import { saveToken } from "./storage";
import { useVaultStore } from "./store";
import type { Note } from "./types";

// The notes-list live subscriptions request the LEAN frame (vault#620): the
// list renders NoteRow (title + preview + tags), never note.content, so the
// live subscription's snapshot/upsert can ship titles+previews instead of
// every note's full body. The subscription reuses the SAME URLSearchParams the
// companion useQuery's poll sends (live-query.ts is a mirror-into-cache over
// that exact query), so asserting the poll fetch URL carries
// `include_content=false` proves the subscription query carries it too — the
// same technique queries.sort.test.tsx uses for the shared `sort` param.

function wrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  return ({ children }) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return (
      <QueryClientProvider client={qc}>
        <BrowserRouter>{children}</BrowserRouter>
      </QueryClientProvider>
    );
  };
}

describe("notes-list queries request the lean shape (include_content=false)", () => {
  let fetchedUrls: string[];

  beforeEach(() => {
    localStorage.clear();
    fetchedUrls = [];
    useVaultStore.setState({
      vaults: {
        v1: {
          id: "v1",
          url: "https://example.test",
          name: "Test",
          issuer: "https://example.test",
          clientId: "cid",
          scope: "full",
          addedAt: "2026-01-01T00:00:00Z",
          lastUsedAt: "2026-01-01T00:00:00Z",
        },
      },
      activeVaultId: "v1",
    });
    saveToken("v1", { accessToken: "tok", scope: "full", vault: "https://example.test" });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        fetchedUrls.push(url.toString());
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  function listFetchParams(): URLSearchParams {
    const url = fetchedUrls.find((u) => u.includes("/api/notes"));
    expect(url).toBeDefined();
    return new URL(url as string).searchParams;
  }

  it("useNotes sends include_content=false", async () => {
    const { result } = renderHook(() => useNotes(DEFAULT_NOTE_QUERY), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listFetchParams().get("include_content")).toBe("false");
  });

  it("useNotesForDateViews sends a bounded date filter, not the legacy 5,000-note cap", async () => {
    const { result } = renderHook(
      () =>
        useNotesForDateViews({
          field: "updated_at",
          from: "2026-08-01T06:00:00.000Z",
          to: "2026-08-15T06:00:00.000Z",
          excludeTag: "archive",
          limit: 5000,
        }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const params = listFetchParams();
    expect(params.get("include_content")).toBe("false");
    expect(params.get("meta[updated_at][gte]")).toBe("2026-08-01T06:00:00.000Z");
    expect(params.get("meta[updated_at][lt]")).toBe("2026-08-15T06:00:00.000Z");
    expect(params.get("exclude_tag")).toBe("archive");
    expect(params.get("limit")).toBe("5000");
  });

  it("rejects a full date-window page instead of presenting a possibly truncated result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: "a", createdAt: "2026-08-02T00:00:00Z" },
              { id: "b", createdAt: "2026-08-01T00:00:00Z" },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );
    const { result } = renderHook(
      () =>
        useNotesForDateViews({
          field: "created_at",
          from: "2026-08-01T00:00:00.000Z",
          limit: 2,
        }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(DateViewOverflowError);
  });

  it("wires overflow-aware polling and focus policies into the date-view query", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: "a", createdAt: "2026-08-02T00:00:00Z" },
              { id: "b", createdAt: "2026-08-01T00:00:00Z" },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const { result } = renderHook(
      () =>
        useNotesForDateViews({
          field: "created_at",
          from: "2026-08-01T00:00:00.000Z",
          limit: 2,
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={qc}>
            <BrowserRouter>{children}</BrowserRouter>
          </QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.error).toBeInstanceOf(DateViewOverflowError));

    const query = qc
      .getQueryCache()
      .getAll()
      .find((candidate) => candidate.queryKey[0] === "notesForDateViews");
    expect(query).toBeDefined();
    const observer = query!.observers[0];
    expect(observer).toBeDefined();
    expect((observer!.options.refetchInterval as (candidate: typeof query) => unknown)(query)).toBe(
      false,
    );
    expect(
      (observer!.options.refetchOnWindowFocus as (candidate: typeof query) => unknown)(query),
    ).toBe(false);
  });

  // The switcher and the graph/link hooks are NOT plain NoteRow lists — they
  // read content (Cmd+K first-line matching) and links (the graph), so they
  // stay FULL. Pin that they did not get swept into the lean opt-in.
  it("useAllNotesForSwitcher stays FULL (include_content=true)", async () => {
    const { result } = renderHook(() => useAllNotesForSwitcher(true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listFetchParams().get("include_content")).toBe("true");
  });

  it("useAllNotesWithLinks stays FULL (include_links=true, not leaned)", async () => {
    const { result } = renderHook(() => useAllNotesWithLinks(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const params = listFetchParams();
    expect(params.get("include_links")).toBe("true");
    expect(params.get("include_content")).not.toBe("false");
  });
});

// Both wire shapes must render in the list — the lean frame (vault#620) AND an
// OLDER vault's full frame (predates #620: ignores include_content on subscribe
// and ships full notes). NoteRow reads displayTitle/preview either way.
describe("notes list renders both the lean frame and an old vault's full frame", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a lean NoteIndex-shaped note (no content) without error", () => {
    // The lean subscribe frame: no `content`, a server-computed `displayTitle`,
    // a `preview`, tags. NoteRow must render title + preview from these alone.
    const lean = {
      id: "lean1",
      path: "Notes/2026/07-16/09-00-00",
      displayTitle: "Lean list row",
      preview: "just the preview, no body",
      tags: ["idea"],
      byteSize: 42,
      updatedAt: "2026-07-16T09:00:00.000Z",
    } as unknown as Note;
    render(<RecentTimeline notes={[lean]} />, { wrapper: wrapper() });
    const row = within(document.body).getByText("Lean list row").closest("li") as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).getByText("just the preview, no body")).toBeInTheDocument();
    expect(within(row).getByText("#idea")).toBeInTheDocument();
  });

  it("renders an OLD vault's full frame (content present, no wire displayTitle) — title from first line", () => {
    // Old-vault back-compat: the subscribe frame carries full `content` and NO
    // `displayTitle`. displayTitle() falls to the first content line, so the
    // row still gets a human title (never crashes on the missing wire field).
    const full: Note = {
      id: "full1",
      path: "Notes/2026/07-16/10-00-00",
      content: "Groceries for the week\n\nmilk, eggs, bread",
      createdAt: "2026-07-16T10:00:00.000Z",
      updatedAt: "2026-07-16T10:00:00.000Z",
    };
    render(<RecentTimeline notes={[full]} />, { wrapper: wrapper() });
    expect(screen.getByText("Groceries for the week")).toBeInTheDocument();
  });
});
