import { MIRROR_FLAG_KEY } from "@/lib/mirror/flag";
import { upsertMirrorNote, upsertMirrorNotes } from "@/lib/mirror/store";
import { type LensDB, openLensDB } from "@/lib/sync/db";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTE_QUERY } from "./note-query";
import { useNote, useNotes } from "./queries";
import { saveToken } from "./storage";
import { useVaultStore } from "./store";
import type { Note } from "./types";

// The Wave-3 read hooks pull `db` from the sync context. We provide it directly
// (a real fake-indexeddb handle) instead of mounting the real SyncProvider so
// the mirror/sync ENGINES don't run in the background and issue their own
// fetches — the only fetch in these tests is the hook's own poll, which we
// control. `h` is a hoisted mutable holder so the mock factory (hoisted above
// imports) can read the per-test handle.
const h = vi.hoisted(() => ({ db: null as LensDB | null }));

vi.mock("@/providers/SyncProvider", () => ({
  useSync: () => ({
    db: h.db,
    blobStore: null,
    engine: null,
    isOnline: true,
    isDraining: false,
    lastSyncedAt: null,
  }),
  SyncProvider: ({ children }: { children: ReactNode }) => children,
}));

function setOnline(online: boolean): () => void {
  const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  return () => {
    if (desc) Object.defineProperty(navigator, "onLine", desc);
  };
}

// QueryClient created ONCE per wrapper (not per render) so the cache survives
// re-renders. `retry` defaults off so an errored query settles immediately;
// `retryDelay: 0` keeps the one retry test fast (no exponential backoff).
function makeWrapper(retry: boolean | number = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry, retryDelay: 0, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
}

function note(id: string, over: Partial<Note> = {}): Note {
  return {
    id,
    path: `Inbox/${id}`,
    createdAt: "2026-07-20T00:00:00Z",
    updatedAt: "2026-07-20T01:00:00Z",
    content: `# ${id}`,
    ...over,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("read hooks — mirror fallback (flag-gated)", () => {
  let restoreOnline: (() => void) | undefined;

  beforeEach(async () => {
    indexedDB.deleteDatabase("parachute-lens");
    h.db = await openLensDB();
    localStorage.clear();
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
    // A token so useActiveVaultClient builds a real client (enabled: !!client).
    saveToken("v1", { accessToken: "tok", scope: "full", vault: "https://example.test" });
  });

  afterEach(() => {
    restoreOnline?.();
    restoreOnline = undefined;
    // React Query tracks connectivity via its own onlineManager (not
    // navigator.onLine); restore it to online so a "paused" test can't bleed
    // into the next.
    onlineManager.setOnline(true);
    h.db?.close();
    h.db = null;
    vi.unstubAllGlobals();
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("flag ON + offline: the notes LIST renders from the mirror (cold launch), no network", async () => {
    localStorage.setItem(MIRROR_FLAG_KEY, "true");
    await upsertMirrorNotes(h.db!, "v1", [
      note("m1", { createdAt: "2026-07-20T00:00:00Z" }),
      note("m2", { createdAt: "2026-07-19T00:00:00Z" }),
    ]);
    restoreOnline = setOnline(false);
    const fetchSpy = vi.fn(() => Promise.reject(new Error("network must not be touched offline")));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useNotes(DEFAULT_NOTE_QUERY), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    // Sorted created_at DESC, exactly what the server would return.
    expect(result.current.data?.map((n) => n.id)).toEqual(["m1", "m2"]);
    // Offline fast-path serves the mirror WITHOUT hitting the network.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("flag ON + offline: a mirrored NOTE opens with FULL content", async () => {
    localStorage.setItem(MIRROR_FLAG_KEY, "true");
    await upsertMirrorNote(h.db!, "v1", note("srv-note", { content: "# full offline body" }));
    restoreOnline = setOnline(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );

    const { result } = renderHook(() => useNote("srv-note"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.content).toBe("# full offline body");
  });

  it("flag ON + online: the mirror SEEDS the first paint, then the network revalidates and WINS", async () => {
    localStorage.setItem(MIRROR_FLAG_KEY, "true");
    await upsertMirrorNotes(h.db!, "v1", [note("seed1", { createdAt: "2026-07-20T00:00:00Z" })]);
    restoreOnline = setOnline(true);
    // Hold the poll open so we can observe the seed BEFORE the network lands.
    let resolveFetch!: (r: Response) => void;
    const fetchPromise = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => fetchPromise),
    );

    const { result } = renderHook(() => useNotes(DEFAULT_NOTE_QUERY), { wrapper: makeWrapper() });
    // Instant paint from the mirror seed (placeholderData) while fetching.
    await waitFor(() => expect(result.current.data?.map((n) => n.id)).toEqual(["seed1"]));
    expect(result.current.isPlaceholderData).toBe(true);

    // Network lands with a DIFFERENT set → it replaces the seed (no clobber).
    act(() => {
      resolveFetch(jsonResponse([{ id: "net1", createdAt: "2026-07-21T00:00:00Z" }]));
    });
    await waitFor(() => expect(result.current.data?.map((n) => n.id)).toEqual(["net1"]));
    expect(result.current.isPlaceholderData).toBe(false);
  });

  it("flag ON + onLine-but-unreachable: serves the mirror on VaultUnreachableError", async () => {
    // The installed-PWA case (issue #61): navigator.onLine stays true but the
    // POST/GET fails — the client throws VaultUnreachableError, and the read
    // path falls back to the mirror instead of erroring.
    localStorage.setItem(MIRROR_FLAG_KEY, "true");
    await upsertMirrorNotes(h.db!, "v1", [note("cached1", { createdAt: "2026-07-20T00:00:00Z" })]);
    restoreOnline = setOnline(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    const { result } = renderHook(() => useNotes(DEFAULT_NOTE_QUERY), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.map((n) => n.id)).toEqual(["cached1"]);
    expect(result.current.isError).toBe(false);
  });

  it("flag OFF + offline: the query PAUSES (network-only) and never reads the mirror", async () => {
    // The safety net. Mirror HAS data, but with the flag off the hook must
    // behave exactly as before Wave 3: networkMode stays "online", so an
    // offline query pauses (queryFn never runs) rather than serving the mirror.
    await upsertMirrorNotes(h.db!, "v1", [note("m1")]);
    restoreOnline = setOnline(false);
    // Drive React Query's connectivity tracker offline too — networkMode
    // "online" (the flag-off default) pauses the fetch only when the
    // onlineManager reports offline.
    onlineManager.setOnline(false);
    const fetchSpy = vi.fn(() => Promise.resolve(jsonResponse([])));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useNotes(DEFAULT_NOTE_QUERY), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.fetchStatus).toBe("paused"));
    expect(result.current.data).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("flag OFF + online: plain network fetch, mirror untouched (byte-identical to today)", async () => {
    await upsertMirrorNotes(h.db!, "v1", [note("mirror-only")]);
    restoreOnline = setOnline(true);
    const fetchSpy = vi.fn(() =>
      Promise.resolve(jsonResponse([{ id: "net-only", createdAt: "2026-07-20T00:00:00Z" }])),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useNotes(DEFAULT_NOTE_QUERY), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The mirrored `mirror-only` row is NOT served; data comes from the network.
    expect(result.current.data?.map((n) => n.id)).toEqual(["net-only"]);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("flag ON: networkMode 'always' keeps online ERRORS surfacing (a search the mirror can't serve)", async () => {
    // networkMode:"always" must not swallow real errors. A `search` query can't
    // be reproduced offline (readNotesList returns null), so an unreachable
    // network surfaces as an error rather than an empty/paused query — proving
    // the always-mode change didn't break the online error path.
    localStorage.setItem(MIRROR_FLAG_KEY, "true");
    await upsertMirrorNotes(h.db!, "v1", [note("m1")]);
    restoreOnline = setOnline(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    const { result } = renderHook(() => useNotes({ ...DEFAULT_NOTE_QUERY, search: "zzz" }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("flag ON: networkMode 'always' keeps online RETRIES engaged", async () => {
    // With retry enabled, a throwing queryFn is retried under networkMode
    // "always" exactly as under "online". A search query (mirror returns null)
    // keeps throwing, so the stubbed fetch is hit more than once.
    localStorage.setItem(MIRROR_FLAG_KEY, "true");
    restoreOnline = setOnline(true);
    const fetchSpy = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useNotes({ ...DEFAULT_NOTE_QUERY, search: "zzz" }), {
      wrapper: makeWrapper(1),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    // retry:1 → the query function ran twice (initial + one retry).
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
  });
});
