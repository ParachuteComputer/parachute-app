import { newLocalId } from "@/lib/sync/id-map";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveNote } from "./live-note";
import { useVaultStore } from "./store";
import type { Note } from "./types";

// Fake client whose `subscribe` we drive directly — mirrors live-query.test's
// approach of mocking the transport and firing handlers, but here the client
// comes from `useActiveVaultClient`, so we mock that seam.
const h = vi.hoisted(() => {
  const unsubscribe = vi.fn();
  const captured: {
    current: {
      query: unknown;
      handlers: {
        onSnapshot: (n: unknown) => void;
        onUpsert: (n: unknown) => void;
        onRemove: (id: string) => void;
        onStatus?: (s: string) => void;
      };
    } | null;
  } = { current: null };
  const subscribe = vi.fn((query: unknown, handlers: unknown) => {
    captured.current = { query, handlers: handlers as never };
    return unsubscribe;
  });
  const clientRef: { current: unknown } = { current: { subscribe } };
  return { unsubscribe, captured, subscribe, clientRef };
});

vi.mock("./queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./queries")>();
  return { ...actual, useActiveVaultClient: () => h.clientRef.current };
});

const serverNote = (over: Partial<Note> = {}): Note =>
  ({
    id: "srv-1",
    path: "Notes/2026/07-17/voice",
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  }) as Note;

function setup(cacheId: string | undefined, note: Note | undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(
    ({ id, n }: { id: string | undefined; n: Note | undefined }) => useLiveNote(id, n),
    { wrapper, initialProps: { id: cacheId, n: note } },
  );
  return { qc, invalidate, ...rendered };
}

describe("useLiveNote", () => {
  beforeEach(() => {
    h.subscribe.mockClear();
    h.unsubscribe.mockClear();
    h.captured.current = null;
    h.clientRef.current = { subscribe: h.subscribe };
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
  });

  it("subscribes scoped to the note's path and tracks isLive on status", () => {
    const { result } = setup("srv-1", serverNote());
    expect(h.subscribe).toHaveBeenCalledOnce();
    expect(h.captured.current?.query).toEqual({ path: "Notes/2026/07-17/voice" });
    expect(result.current.isLive).toBe(false);

    act(() => h.captured.current!.handlers.onStatus!("open"));
    expect(result.current.isLive).toBe(true);

    act(() => h.captured.current!.handlers.onStatus!("closed"));
    expect(result.current.isLive).toBe(false);
  });

  it("invalidates the single-note cache on upsert (write-through trigger)", () => {
    const { invalidate } = setup("srv-1", serverNote());
    invalidate.mockClear();
    act(() => h.captured.current!.handlers.onUpsert(serverNote()));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["note", "v1", "srv-1"] });
  });

  it("invalidates on remove too", () => {
    const { invalidate } = setup("srv-1", serverNote());
    invalidate.mockClear();
    act(() => h.captured.current!.handlers.onRemove("srv-1"));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["note", "v1", "srv-1"] });
  });

  it("does NOT invalidate on the initial snapshot (no mount double-fetch)", () => {
    const { invalidate } = setup("srv-1", serverNote());
    invalidate.mockClear();
    act(() => h.captured.current!.handlers.onSnapshot([serverNote()]));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("invalidates the ROUTE cache id, not the note's own id (local-id bridge)", () => {
    // Opened at a local route id that has since resolved to a server note; the
    // cache is still keyed by the route id, so that's what must invalidate.
    const routeId = newLocalId();
    const { invalidate } = setup(routeId, serverNote({ id: "srv-1" }));
    invalidate.mockClear();
    act(() => h.captured.current!.handlers.onUpsert(serverNote()));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["note", "v1", routeId] });
  });

  it("is inert until a note is loaded", () => {
    setup("srv-1", undefined);
    expect(h.subscribe).not.toHaveBeenCalled();
  });

  it("is inert for a note with no path", () => {
    setup("srv-1", serverNote({ path: undefined }));
    expect(h.subscribe).not.toHaveBeenCalled();
  });

  it("does not subscribe to a still-local optimistic note (nothing on the server yet)", () => {
    const localId = newLocalId();
    setup(localId, serverNote({ id: localId }));
    expect(h.subscribe).not.toHaveBeenCalled();
  });

  it("is inert with no active client", () => {
    h.clientRef.current = null;
    setup("srv-1", serverNote());
    expect(h.subscribe).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = setup("srv-1", serverNote());
    unmount();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
  });

  it("tears down and re-subscribes on a note switch (path change)", () => {
    const { rerender } = setup("srv-1", serverNote({ path: "Notes/a" }));
    expect(h.subscribe).toHaveBeenCalledTimes(1);
    expect(h.captured.current?.query).toEqual({ path: "Notes/a" });

    act(() => rerender({ id: "srv-2", n: serverNote({ id: "srv-2", path: "Notes/b" }) }));
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.subscribe).toHaveBeenCalledTimes(2);
    expect(h.captured.current?.query).toEqual({ path: "Notes/b" });
  });
});
