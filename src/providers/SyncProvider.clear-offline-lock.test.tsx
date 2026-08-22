import { MIRROR_FLAG_KEY } from "@/lib/mirror/flag";
import { mirrorLockName } from "@/lib/mirror/lock";
import {
  clearMirrorForVault,
  countMirrorNotes,
  getMirrorLastSyncedAt,
  setMirrorLastSyncedAt,
  upsertMirrorNote,
} from "@/lib/mirror/store";
import { type LensDB, openLensDB } from "@/lib/sync/db";
import { useVaultStore } from "@/lib/vault/store";
import type { Note } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SyncProvider, useSync } from "./SyncProvider";

// #79 item 2 — "Clear offline copy" must take the SAME per-vault Web Lock the
// mirror engine's drain and sweep take. Without it, a drain in flight when the
// user clears can commit its `lastSyncedAt` watermark AFTER the meta wipe: the
// offline read gate then reads OPEN ("synced, updated just now") over a mirror
// with no rows in it.
//
// jsdom has no Web Locks API, so this installs a REAL (if minimal) exclusive
// LockManager — one FIFO queue per name — and then stages exactly that race:
// a fake drain holds the vault lock and writes the watermark on its way out
// while `clearOffline` is invoked mid-flight. The assertion is on the ORDER the
// two bodies actually ran, and on the end state of the mirror meta.

const VAULT = "v-clear";

function note(id: string): Note {
  return {
    id,
    path: `Inbox/${id}`,
    createdAt: "2026-08-20T00:00:00Z",
    updatedAt: "2026-08-20T01:00:00Z",
    content: `# ${id}`,
  };
}

/** A minimal exclusive LockManager: per-name FIFO, real mutual exclusion. */
function installFifoLocks(): () => void {
  const tails = new Map<string, Promise<unknown>>();
  const request = async (name: string, a: unknown, b?: unknown): Promise<unknown> => {
    const options = (typeof a === "function" ? undefined : a) as LockOptions | undefined;
    const cb = (typeof a === "function" ? a : b) as (lock: unknown) => Promise<unknown>;
    const held = tails.get(name);
    // `ifAvailable` callers do NOT queue — they get a null lock and bail. That
    // is the engine's mode; the clear deliberately uses the queueing mode.
    if (held && options?.ifAvailable) return cb(null);
    const run = (held ?? Promise.resolve()).then(() => cb({ name, mode: "exclusive" }));
    // Keep the chain alive on rejection so one failed holder can't wedge the name.
    tails.set(
      name,
      run.catch(() => undefined),
    );
    return run;
  };
  const original = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
  return () => {
    if (original) Object.defineProperty(navigator, "locks", original);
    else Reflect.deleteProperty(navigator as unknown as object, "locks");
  };
}

let restoreLocks: (() => void) | null = null;
let db: LensDB | null = null;

function Probe({ onReady }: { onReady: (clear: () => Promise<void>) => void }) {
  const { mirror, db: providerDb } = useSync();
  if (providerDb) onReady(mirror.clearOffline);
  return null;
}

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem(MIRROR_FLAG_KEY, "true");
  indexedDB.deleteDatabase("parachute-lens");
  db = await openLensDB();
  // No token for this vault ⇒ `useActiveVaultClient` resolves null ⇒ BOTH
  // engines' resolveContext returns null, so nothing drains in the background
  // and the only lock traffic is what this test stages.
  useVaultStore.setState({
    vaults: {
      [VAULT]: {
        id: VAULT,
        url: "https://x.test",
        name: "Clear",
        issuer: "https://x.test",
        clientId: "client-test",
        scope: "full",
        addedAt: "2026-08-20T00:00:00.000Z",
        lastUsedAt: "2026-08-20T00:00:00.000Z",
      },
    },
    activeVaultId: VAULT,
  });
  restoreLocks = installFifoLocks();
});

afterEach(() => {
  restoreLocks?.();
  restoreLocks = null;
  db?.close();
  db = null;
  useVaultStore.setState({ vaults: {}, activeVaultId: null });
  localStorage.clear();
});

describe("SyncProvider clearOffline — per-vault Web Lock (#79 item 2)", () => {
  it("waits out an in-flight drain, so the wipe wins and no watermark survives it", async () => {
    const handle = db as LensDB;
    await upsertMirrorNote(handle, VAULT, note("n1"));
    await setMirrorLastSyncedAt(handle, VAULT, 1_000);

    let clearOffline: (() => Promise<void>) | null = null;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SyncProvider>
          <Probe
            onReady={(c) => {
              clearOffline = c;
            }}
          />
        </SyncProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(clearOffline).not.toBeNull());

    const order: string[] = [];
    let releaseDrain: (() => void) | null = null;
    const drainHolding = new Promise<void>((r) => {
      releaseDrain = r;
    });

    // A "drain" holding the vault lock, committing its watermark on the way out
    // — exactly the write that must not land after the wipe.
    const drain = navigator.locks.request(mirrorLockName(VAULT), async () => {
      order.push("drain:enter");
      await drainHolding;
      await setMirrorLastSyncedAt(handle, VAULT, 2_000);
      order.push("drain:exit");
    });

    await waitFor(() => expect(order).toContain("drain:enter"));

    // Clear pressed WHILE the drain holds the lock.
    let cleared = false;
    const clearing = act(async () => {
      await (clearOffline as unknown as () => Promise<void>)();
      cleared = true;
    });

    // It must NOT have completed yet — it is queued behind the drain.
    await Promise.resolve();
    expect(cleared).toBe(false);
    expect(order).not.toContain("clear:done");

    (releaseDrain as unknown as () => void)();
    await drain;
    await clearing;
    order.push("clear:done");

    expect(order).toEqual(["drain:enter", "drain:exit", "clear:done"]);
    // End state: the drain's watermark was overwritten by the wipe, not the
    // other way round. No rows AND no watermark ⇒ the read gate reads shut.
    expect(await countMirrorNotes(handle, VAULT)).toBe(0);
    expect(await getMirrorLastSyncedAt(handle, VAULT)).toBeUndefined();
  });

  it("control: without the lock the drain's watermark outlives the wipe", async () => {
    // The same race run WITHOUT any lock, to show the assertion above is real
    // and not vacuously true of the store calls. This is the pre-#79 shape.
    const handle = db as LensDB;
    await upsertMirrorNote(handle, VAULT, note("n1"));
    await clearMirrorForVault(handle, VAULT);
    await setMirrorLastSyncedAt(handle, VAULT, 2_000);
    expect(await countMirrorNotes(handle, VAULT)).toBe(0);
    // Rows gone but the watermark present — a "synced" mirror with nothing in it.
    expect(await getMirrorLastSyncedAt(handle, VAULT)).toBe(2_000);
  });
});
