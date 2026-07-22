import { type LensDB, openLensDB } from "@/lib/sync/db";
import { listPending } from "@/lib/sync/queue";
import type { PendingUpdateNote } from "@/lib/sync/types";
import { useVaultStore } from "@/lib/vault/store";
import { useViewFieldMutation } from "@/lib/views/mutate";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Offline path (view-experience wave, slice 1): a tap-to-move while offline must
// enqueue onto the durable queue (never throw), because `useUpdateNote` is a
// queued op kind. We inject a real fake-indexeddb DB through `useSync` and flip
// `navigator.onLine` off, so `withOfflineFallback` takes the enqueue branch.

const holder = vi.hoisted(() => ({ db: null as LensDB | null }));
vi.mock("@/providers/SyncProvider", () => ({ useSync: () => ({ db: holder.db }) }));

const VIEW_KEY = ["viewResults", "dev", "v1", "tag=project"] as const;

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
        addedAt: "2026-07-01T00:00:00.000Z",
        lastUsedAt: "2026-07-01T00:00:00.000Z",
      },
    },
    activeVaultId: "dev",
  });
  localStorage.setItem(
    "lens:token:dev",
    JSON.stringify({ accessToken: "pvt_abc", scope: "full", vault: "default" }),
  );
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
}

describe("useViewFieldMutation — offline", () => {
  let qc: QueryClient;

  beforeEach(async () => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
    holder.db = await freshDb();
    setOnline(false);
    // A network attempt would be a bug offline; make one loud if it happens.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unavailable");
      }),
    );
    // gcTime Infinity: this hook test has no query OBSERVER on VIEW_KEY, so a
    // zero gcTime would garbage-collect the optimistic write before we read it.
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
    });
    qc.setQueryData(VIEW_KEY as unknown as string[], [
      { id: "note1", createdAt: "2026-07-01T00:00:00Z", metadata: { status: "active" } },
    ]);
  });

  afterEach(() => {
    setOnline(true);
    holder.db?.close();
    holder.db = null;
    vi.unstubAllGlobals();
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }

  it("enqueues the move as a one-field update-note op and doesn't throw", async () => {
    const { result } = renderHook(
      () => useViewFieldMutation("note1", VIEW_KEY as unknown as string[]),
      { wrapper: Wrapper },
    );

    await act(async () => {
      // Resolves (does not throw) even though there's no network.
      await result.current.move("status", "done", "2026-07-01T00:00:00Z");
    });

    const pending = await listPending(holder.db!, "dev");
    expect(pending).toHaveLength(1);
    const mutation = pending[0]!.mutation as PendingUpdateNote;
    expect(mutation.kind).toBe("update-note");
    expect(mutation.targetId).toBe("note1");
    expect(mutation.payload.metadata).toEqual({ status: "done" });

    // The view still painted the move immediately (optimistic cache).
    const cached = qc.getQueryData<{ metadata?: Record<string, unknown> }[]>(
      VIEW_KEY as unknown as string[],
    );
    expect(cached?.[0]?.metadata?.status).toBe("done");
  });
});
