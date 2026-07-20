import { NoteView } from "@/app/routes/NoteView";
import { useFocusMode } from "@/lib/focus-mode";
import { type LensDB, openLensDB } from "@/lib/sync/db";
import { newLocalId, recordIdMap } from "@/lib/sync/id-map";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FIX 3 uses `useSync().db` to resolve a local id via the id-map. Mock the
// provider so the id-map test can hand `useNote` a db it fully controls
// (deterministic — no async provider bootstrap). The default `db: null` matches
// the un-wrapped context default the other describes already run against, so
// real-id tests are unaffected.
const { syncState } = vi.hoisted(() => ({
  syncState: { db: null as LensDB | null, mirrorState: "off" as string },
}));
vi.mock("@/providers/SyncProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/SyncProvider")>();
  return {
    ...actual,
    useSync: () => ({
      db: syncState.db,
      blobStore: null,
      engine: null,
      isOnline: true,
      isDraining: false,
      lastSyncedAt: null,
      mirror: {
        enabled: syncState.mirrorState !== "off",
        state: syncState.mirrorState,
        lastSyncedAt: null,
        syncNow: async () => {},
        clearOffline: async () => {},
      },
    }),
  };
});

interface FetchMap {
  [urlMatcher: string]: { status?: number; body: unknown };
}

function installFetch(map: FetchMap) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const matcher of Object.keys(map)) {
      if (url.includes(matcher)) {
        const entry = map[matcher];
        return {
          ok: (entry.status ?? 200) < 400,
          status: entry.status ?? 200,
          json: async () => entry.body,
          text: async () => "",
          blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
        } as Response;
      }
    }
    return {
      ok: false,
      status: 404,
      json: async () => null,
      text: async () => "",
    } as Response;
  });
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

function seedStore() {
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
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/n/:id" element={<NoteView />} />
        <Route path="/" element={<div>NotesListPage</div>} />
        <Route path="/add" element={<div>AddVaultPage</div>} />
        <Route path="*" element={<div>Other</div>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: Wrapper },
  );
}

describe("NoteView route", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    syncState.mirrorState = "off";
  });

  it("renders markdown content, metadata, tags, and back link", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "abc-123",
          path: "Canon/Aaron",
          createdAt: "2026-04-16T04:30:54.177Z",
          updatedAt: "2026-04-17T00:05:07.721Z",
          content: "# Aaron Gabriel\n\nTeacher and builder.",
          metadata: { summary: "Canon note on Aaron." },
          tags: ["canon"],
          links: [],
          attachments: [],
        },
      },
    });

    renderAt("/n/abc-123");

    expect(await screen.findByText("Aaron Gabriel")).toBeInTheDocument();
    expect(screen.getByText("Teacher and builder.")).toBeInTheDocument();
    expect(screen.getByText("Canon note on Aaron.")).toBeInTheDocument();
    // Tag chip links to the filtered list
    const tagChip = screen.getByRole("link", { name: "#canon" });
    expect(tagChip).toHaveAttribute("href", "/notes?tag=canon");
    // Back link to / is present
    expect(screen.getByRole("link", { name: /all notes/i })).toBeInTheDocument();
    // Edit placeholder routes to the edit route (PR #5)
    expect(screen.getByRole("link", { name: /edit/i })).toHaveAttribute("href", "/n/abc-123/edit");
    // Not a #view-tagged note — no bridge into the ViewSurface.
    expect(screen.queryByRole("link", { name: /open as view/i })).not.toBeInTheDocument();
  });

  // Wave-4 staleness UX: a note served from the durable-offline mirror while
  // offline wears a subtle "Saved copy" marker.
  it("marks the note a saved copy when served from the mirror offline", async () => {
    syncState.mirrorState = "offline";
    installFetch({
      "/api/notes": {
        body: {
          id: "abc-123",
          path: "Canon/Aaron",
          createdAt: "2026-04-16T04:30:54.177Z",
          content: "# Aaron Gabriel\n\nTeacher and builder.",
          tags: [],
          links: [],
          attachments: [],
        },
      },
    });

    renderAt("/n/abc-123");

    expect(await screen.findByText("Aaron Gabriel")).toBeInTheDocument();
    expect(screen.getByText(/saved copy/i)).toBeInTheDocument();
  });

  // Wave-4: a note whose body was evicted to keep the mirror under its storage
  // ceiling shows a "Connect to load this note" prompt (with its retained
  // preview) in place of the missing body.
  it("shows 'Connect to load this note' for a content-evicted note", async () => {
    syncState.mirrorState = "offline";
    installFetch({
      "/api/notes": {
        body: {
          id: "abc-123",
          path: "Canon/Aaron",
          createdAt: "2026-04-16T04:30:54.177Z",
          content: "",
          preview: "Teacher and builder.",
          contentEvicted: true,
          tags: [],
          links: [],
          attachments: [],
        },
      },
    });

    renderAt("/n/abc-123");

    expect(await screen.findByText(/connect to load this note/i)).toBeInTheDocument();
    // The retained preview gives context; the missing body isn't rendered as
    // the empty "Nothing here yet" prompt.
    expect(screen.getByText("Teacher and builder.")).toBeInTheDocument();
    expect(screen.queryByText(/nothing here yet/i)).not.toBeInTheDocument();
  });

  // Path is plumbing, but on a note it stays grabbable (ratified 2026-07-17)
  // — it's how you reference a note to an AI agent. The metadata card gets
  // its own Path row (with a copy button) plus a "Copy reference" button;
  // both copy the same value.
  it("metadata card shows a Path row and a Copy reference button, both copying the path", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "abc-123",
          path: "Canon/Aaron",
          createdAt: "2026-04-16T04:30:54.177Z",
          content: "Teacher and builder.",
          tags: [],
          links: [],
          attachments: [],
        },
      },
    });
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    renderAt("/n/abc-123");

    await screen.findByText("Teacher and builder.");
    expect(screen.getByText("Path")).toBeInTheDocument();
    expect(screen.getAllByText("Canon/Aaron").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /copy note path/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Canon/Aaron"));

    fireEvent.click(screen.getByRole("button", { name: /copy reference to this note/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Canon/Aaron"));
    expect(writeText).toHaveBeenCalledTimes(2);

    // 0.20.14 — the path is de-emphasized to a quiet meta line at the FOOT of
    // the header, but stays one-tap copyable (handing a note's path to an AI
    // agent). Its own "Copy path" button has a distinct name from the card's
    // "Copy note path", so both copy affordances stay unambiguous, and it
    // copies the same value.
    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3));
    expect(writeText).toHaveBeenLastCalledWith("Canon/Aaron");
  });

  // views-wave-1's half of the §2 bridge: a #view-tagged note (canonical or
  // legacy saved-view) offers a trip into ViewSurface.
  it("shows 'Open as view' on a #view-tagged note, linking to /views/:id", async () => {
    installFetch({
      // A more specific matcher checked before the generic "/api/notes" one
      // (installFetch iterates map keys in insertion order) — the settings-
      // note fetch (role-tag resolution) must not receive the view note.
      settings: { body: {} },
      "/api/notes": {
        body: {
          id: "view-1",
          path: "Views/Active projects",
          createdAt: "2026-04-16T04:30:54.177Z",
          content: "",
          tags: ["view"],
          metadata: { kind: "list", query: "{}" },
          links: [],
          attachments: [],
        },
      },
    });

    renderAt("/n/view-1");

    const link = await screen.findByRole("link", { name: /open as view/i });
    expect(link).toHaveAttribute("href", "/views/view-1");
  });

  it("titles by the leading H1 and strips it from the body (no double render)", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "lead",
          path: "Canon/Aaron",
          createdAt: "2026-04-16T00:00:00Z",
          content: "# Aaron Gabriel\n\nTeacher and builder.",
          tags: [],
          links: [],
          attachments: [],
        },
      },
    });
    renderAt("/n/lead");
    // The leading H1 becomes the page title …
    expect(
      await screen.findByRole("heading", { level: 1, name: "Aaron Gabriel" }),
    ).toBeInTheDocument();
    // … and appears exactly once (stripped from the rendered body).
    expect(screen.getAllByText("Aaron Gabriel")).toHaveLength(1);
    expect(screen.getByText("Teacher and builder.")).toBeInTheDocument();
  });

  it("promotes the first content line as the title (plain, no #) and strips it, keeping a buried heading in the body", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "buried",
          path: "Canon/Aaron",
          createdAt: "2026-04-16T00:00:00Z",
          // No leading `#`, but the first line is still the title — matching the
          // editor's first-line decoration and the list's displayTitle. A
          // heading buried below is NOT the title and still renders in-body.
          content: "Some intro paragraph.\n\n# Buried Title\n\nMore body.",
          tags: [],
          links: [],
          attachments: [],
        },
      },
    });
    renderAt("/n/buried");
    // The first line is the page title (not the old path-leaf fallback) …
    expect(
      await screen.findByRole("heading", { level: 1, name: "Some intro paragraph." }),
    ).toBeInTheDocument();
    // … and appears exactly once (stripped from the rendered body).
    expect(screen.getAllByText("Some intro paragraph.")).toHaveLength(1);
    // The buried H1 renders once, in the body, never promoted to the title.
    expect(screen.getAllByText("Buried Title")).toHaveLength(1);
    expect(screen.getByText("More body.")).toBeInTheDocument();
    // Regression guard: the path leaf is no longer the title.
    expect(screen.queryByRole("heading", { level: 1, name: "Aaron" })).toBeNull();
  });

  it("promotes a one-line note's only line to the title and shows no empty-state body", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "oneline",
          path: "Notes/2026/07-16/22-10-48",
          createdAt: "2026-04-16T00:00:00Z",
          content: "Buy milk and eggs",
          tags: [],
          links: [],
          attachments: [],
        },
      },
    });
    renderAt("/n/oneline");
    // The single line is the title …
    expect(
      await screen.findByRole("heading", { level: 1, name: "Buy milk and eggs" }),
    ).toBeInTheDocument();
    // … with no misleading "Nothing here yet" prompt (the note isn't empty).
    expect(screen.queryByText(/nothing here yet/i)).toBeNull();
  });

  it("does not double-render the title when the first line is a bare heading marker", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "baremarker",
          path: "Canon/Aaron",
          createdAt: "2026-04-16T00:00:00Z",
          // A bare `#` (no text) then the real first line — the title is the
          // real line, promoted once and NOT left behind in the body.
          content: "#\nActual title\n\nSome body.",
          tags: [],
          links: [],
          attachments: [],
        },
      },
    });
    renderAt("/n/baremarker");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Actual title" }),
    ).toBeInTheDocument();
    // Rendered exactly once — in the header, never doubled in the body.
    expect(screen.getAllByText("Actual title")).toHaveLength(1);
    expect(screen.getByText("Some body.")).toBeInTheDocument();
  });

  it("shows the empty-note prompt and a timestamp title for a genuinely empty note", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "empty",
          path: "Notes/2026/07-16/22-10-48",
          createdAt: "2026-04-16T00:00:00Z",
          content: "",
          tags: [],
          links: [],
          attachments: [],
        },
      },
    });
    renderAt("/n/empty");
    // No content line → the quickPath default renders as a timestamp title …
    expect(await screen.findByRole("heading", { level: 1, name: /July 16/ })).toBeInTheDocument();
    // … and the empty-note prompt shows (this note really is empty).
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });

  it("resolves [[wikilinks]] via the outbound links table and renders as a /n/<id> link", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "me",
          path: "Canon/Aaron",
          createdAt: "2026-04-16T00:00:00Z",
          // First line is the title; the wikilinks live in the body below it,
          // where they must resolve to /n/<id> links.
          content: "Links\n\nSee [[Canon/Uni]] for more. Also [[Missing/Note]].",
          tags: [],
          links: [
            {
              sourceId: "me",
              targetId: "uni-id",
              relationship: "wikilink",
              targetNote: { id: "uni-id", path: "Canon/Uni" },
            },
          ],
          attachments: [],
        },
      },
    });

    const { container } = renderAt("/n/me");

    // Prefer the in-body wikilink (not the sidebar) via container scoping.
    await screen.findByText(/See/);
    const body = container.querySelector(".prose-note");
    expect(body).not.toBeNull();
    const resolvedLinks = Array.from(
      body!.querySelectorAll<HTMLAnchorElement>("a.wikilink-resolved"),
    );
    expect(resolvedLinks).toHaveLength(1);
    expect(resolvedLinks[0]).toHaveAttribute("href", "/n/uni-id");
    expect(resolvedLinks[0]?.textContent).toBe("Canon/Uni");

    const unresolvedLinks = Array.from(
      body!.querySelectorAll<HTMLAnchorElement>("a.wikilink-unresolved"),
    );
    expect(unresolvedLinks).toHaveLength(1);
    expect(unresolvedLinks[0]).toHaveAttribute("href", "/n/Missing%2FNote");
    expect(unresolvedLinks[0]?.textContent).toBe("Missing/Note");
  });

  it("renders inbound and outbound link panels with peer paths", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "center",
          path: "hub",
          createdAt: "2026-04-16T00:00:00Z",
          content: "Hub.",
          tags: [],
          links: [
            {
              sourceId: "center",
              targetId: "out-1",
              relationship: "wikilink",
              targetNote: { id: "out-1", path: "Outbound/One" },
            },
            {
              sourceId: "in-1",
              targetId: "center",
              relationship: "wikilink",
              sourceNote: { id: "in-1", path: "Inbound/One" },
            },
          ],
          attachments: [],
        },
      },
    });

    renderAt("/n/center");

    expect(await screen.findByRole("heading", { name: /Outbound \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Inbound \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Outbound\/One/ })).toHaveAttribute("href", "/n/out-1");
    expect(screen.getByRole("link", { name: /Inbound\/One/ })).toHaveAttribute("href", "/n/in-1");
  });

  it("renders an inline image attachment (blob-fetched through VaultClient)", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "with-img",
          path: "media",
          createdAt: "2026-04-16T00:00:00Z",
          content: "pic",
          tags: [],
          links: [],
          attachments: [
            {
              id: "att-1",
              filename: "hero.png",
              mimeType: "image/png",
              url: "/attachments/att-1",
              size: 2048,
            },
          ],
        },
      },
      "/attachments/att-1": { body: null },
    });
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:fake-url");
    URL.revokeObjectURL = vi.fn();

    renderAt("/n/with-img");

    const img = (await screen.findByAltText("hero.png")) as HTMLImageElement;
    await waitFor(() => {
      expect(img.src).toContain("blob:fake-url");
    });
    URL.createObjectURL = origCreate;
  });

  it("shows a 404 block when the vault returns no note for the id", async () => {
    installFetch({
      "/api/notes": { body: [] },
    });
    renderAt("/n/nonexistent");
    expect(await screen.findByText(/note not found/i)).toBeInTheDocument();
  });

  it("routes through Reconnect on 401", async () => {
    installFetch({
      "/api/notes": { status: 401, body: null },
    });
    renderAt("/n/any");
    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /reconnect/i })).toHaveAttribute("href", "/add");
  });

  it("clicking Pin PATCHes the note with the pinned role tag", async () => {
    const fetchImpl = installFetch({
      "/api/notes": {
        body: {
          id: "abc-123",
          path: "some/note",
          createdAt: "2026-04-16T04:30:54.177Z",
          updatedAt: "2026-04-17T00:05:07.721Z",
          content: "body",
          tags: [],
          links: [],
          attachments: [],
        },
      },
    });
    renderAt("/n/abc-123");

    const pinBtn = await screen.findByRole("button", { name: /^☆ Pin$/ });
    fireEvent.click(pinBtn);

    await waitFor(() => {
      const patchCall = fetchImpl.mock.calls.find((c) => {
        const init = c[1] as RequestInit | undefined;
        return init?.method === "PATCH";
      });
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body.tags).toEqual({ add: ["pinned"] });
    });
  });

  it("shows the Pinned state and Unarchive label based on current tags", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "n",
          path: "note",
          createdAt: "2026-04-16T04:30:54.177Z",
          content: "body",
          tags: ["pinned", "archived"],
          links: [],
          attachments: [],
        },
      },
    });
    renderAt("/n/n");

    expect(await screen.findByRole("button", { name: /★ Pinned/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Archived$/ })).toBeInTheDocument();
  });

  it("pressing P toggles the pinned tag", async () => {
    const fetchImpl = installFetch({
      "/api/notes": {
        body: {
          id: "k",
          path: "keyboard",
          createdAt: "2026-04-16T04:30:54.177Z",
          content: "body",
          tags: [],
          links: [],
          attachments: [],
        },
      },
    });
    renderAt("/n/k");

    await screen.findByRole("button", { name: /^☆ Pin$/ });
    fireEvent.keyDown(window, { key: "p" });

    await waitFor(() => {
      const patchCall = fetchImpl.mock.calls.find((c) => {
        const init = c[1] as RequestInit | undefined;
        return init?.method === "PATCH";
      });
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body.tags).toEqual({ add: ["pinned"] });
    });
  });
});

describe("NoteView — offline voice capture (local id → id-map resolution) [FIX 3]", () => {
  let db: LensDB;

  beforeEach(async () => {
    indexedDB.deleteDatabase("parachute-lens");
    db = await openLensDB();
    syncState.db = db;
    localStorage.clear();
    sessionStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
    syncState.db = null;
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  function renderWith(qc: QueryClient, path: string) {
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/n/:id" element={<NoteView />} />
            <Route path="*" element={<div>Other</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("renders the optimistic note for a not-yet-synced local id, then the server note once the id-map fills", async () => {
    const localId = newLocalId();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } },
    });
    // The capture flow seeds the optimistic note into the cache before it
    // navigates to /n/<localId>. A bare getNote(localId) would 404.
    qc.setQueryData(["note", "dev", localId], {
      id: localId,
      path: "Voice/memo",
      createdAt: "2026-07-03T00:00:00Z",
      updatedAt: "2026-07-03T00:00:00Z",
      content: "_Transcript pending._",
      tags: ["capture"],
      metadata: { source: "voice" },
    });
    // The server route for the eventual real note. It is never hit during the
    // optimistic phase (getNote(localId) is short-circuited to the cached
    // optimistic row); only a resolved id-map fetches it. Installed up front
    // because the vault client binds `fetch` at construction (client.ts:145),
    // so a later re-stub would be invisible to it. Everything else 404s —
    // proving we never fall through to getNote(localId).
    installFetch({
      "id=real-123": {
        body: {
          id: "real-123",
          path: "Voice/memo",
          createdAt: "2026-07-03T00:00:00Z",
          content: "# Memo\n\nThe transcribed text.",
          tags: ["capture"],
          links: [],
          attachments: [],
        },
      },
    });
    renderWith(qc, `/n/${encodeURIComponent(localId)}`);

    // Lands on a readable note, not an error/404 screen. The optimistic note's
    // first line (the pending placeholder) IS its title now, so the page heads
    // on it rather than the path leaf.
    expect(
      await screen.findByRole("heading", { level: 1, name: /transcript pending/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/could not load note/i)).toBeNull();
    expect(screen.queryByText(/note not found/i)).toBeNull();

    // The create-note row drains: the id-map now maps local → server.
    await recordIdMap(db, localId, "real-123", "dev");

    // A refetch now resolves the id-map and fetches the real note — the view
    // flips from the optimistic row to the server note.
    await act(async () => {
      await qc.refetchQueries({ queryKey: ["note", "dev", localId] });
    });
    expect(await screen.findByText("The transcribed text.")).toBeInTheDocument();
  });
});

// Voice Wave 2 — the failed transcription chip's Retry action.
describe("NoteView — retry transcription", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    seedStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A note whose (single) audio segment failed transcription. `retry-transcription`
  // is listed FIRST so the POST matches it before the generic `/api/notes` GET
  // (installFetch iterates keys in insertion order).
  function failedNote(retry: { status?: number; body: unknown }) {
    return installFetch({
      "retry-transcription": retry,
      "/api/notes": {
        body: {
          id: "voice-1",
          path: "Voice/memo",
          createdAt: "2026-07-18T00:00:00Z",
          content: "_Transcription unavailable._",
          tags: ["capture"],
          links: [],
          attachments: [
            {
              id: "att-1",
              filename: "memo.webm",
              mimeType: "audio/webm",
              metadata: { transcribe_status: "failed" },
            },
          ],
        },
      },
    });
  }

  it("the failed chip's Retry POSTs /retry-transcription for the note", async () => {
    const fetchImpl = failedNote({ status: 200, body: { ok: true } });
    renderAt("/n/voice-1");

    const retry = await screen.findByRole("button", { name: /^retry$/i });
    fireEvent.click(retry);

    await waitFor(() => {
      const call = fetchImpl.mock.calls.find(([url, init]) => {
        const u = typeof url === "string" ? url : url.toString();
        return u.includes("/api/notes/voice-1/retry-transcription") && init?.method === "POST";
      });
      expect(call).toBeDefined();
    });
  });

  it("an honest 4xx (nothing retriable) is handled gracefully — chip reverts, no crash", async () => {
    failedNote({ status: 409, body: { error: "nothing to retry" } });
    renderAt("/n/voice-1");

    const retry = await screen.findByRole("button", { name: /^retry$/i });
    fireEvent.click(retry);

    // A quiet toast fires and the failed chip comes back (never a stuck spinner).
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => /couldn't retry/i.test(t.message))).toBe(
        true,
      );
    });
    // Retry only renders in the failed state — its presence proves the chip
    // reverted rather than spinning on "Transcribing…".
    expect(await screen.findByRole("button", { name: /^retry$/i })).toBeInTheDocument();
    expect(screen.queryByText(/transcribing/i)).not.toBeInTheDocument();
  });
});

// POLISH-WAVE PR 4 — focus mode's read-route half.
describe("NoteView — focus mode", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
    useFocusMode.setState({ on: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useFocusMode.setState({ on: false });
  });

  it("the Focus ghost button in the action row arms the store", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "abc-123",
          path: "Canon/Aaron",
          createdAt: "2026-04-16T00:00:00Z",
          content: "Teacher and builder.",
          tags: [],
          links: [],
          attachments: [],
        },
      },
    });
    renderAt("/n/abc-123");
    const focusButton = await screen.findByRole("button", { name: /focus/i });
    act(() => {
      fireEvent.click(focusButton);
    });
    expect(useFocusMode.getState().on).toBe(true);
  });

  it("Escape exits focus mode on the read route (nothing here consumes it first)", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "abc-123",
          path: "Canon/Aaron",
          createdAt: "2026-04-16T00:00:00Z",
          content: "Teacher and builder.",
          tags: [],
          links: [],
          attachments: [],
        },
      },
    });
    renderAt("/n/abc-123");
    await screen.findByText("Teacher and builder.");

    act(() => {
      useFocusMode.getState().setOn(true);
    });
    expect(useFocusMode.getState().on).toBe(true);

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(useFocusMode.getState().on).toBe(false);
  });

  it("Escape is a no-op while focus mode is already off (no stray listener firing)", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "abc-123",
          path: "Canon/Aaron",
          createdAt: "2026-04-16T00:00:00Z",
          content: "Teacher and builder.",
          tags: [],
          links: [],
          attachments: [],
        },
      },
    });
    renderAt("/n/abc-123");
    await screen.findByText("Teacher and builder.");
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(useFocusMode.getState().on).toBe(false);
  });
});
