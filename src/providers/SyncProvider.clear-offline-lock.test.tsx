import { MIRROR_FLAG_KEY } from "@/lib/mirror/flag";
import { mirrorLockName } from "@/lib/mirror/lock";
import {
  countMirrorNotes,
  getMirrorLastSyncedAt,
  setMirrorLastSyncedAt,
  upsertMirrorNote,
} from "@/lib/mirror/store";
import { type LensDB, openLensDB } from "@/lib/sync/db";
import { useVaultStore } from "@/lib/vault/store";
import type { Note } from "@/lib/vault/types";
import { holdLock, installFifoLocks } from "@/test/locks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncProvider, useSync } from "./SyncProvider";

// #79 item 2 — "Clear offline copy" must take the SAME per-vault Web Lock the
// mirror engine's drain and sweep take. Without it, a drain in flight when the
// user clears can commit its `lastSyncedAt` watermark AFTER the meta wipe: the
// offline read gate then reads OPEN ("synced, updated just now") over a mirror
// with no rows in it.
//
// jsdom has no Web Locks API, so this installs a REAL (if minimal) exclusive
// LockManager — one FIFO queue per name, see `src/test/locks.ts` — and then
// stages exactly that race: a fake drain holds the vault lock and writes the
// watermark on its way out while `clearOffline` is invoked mid-flight. The
// assertion is on the ORDER the two bodies actually ran, and on the end state
// of the mirror meta.
//
// Every case here drives the REAL `mirror.clearOffline` off the real provider,
// including the unlocked control — the claim is about the provider's ordering,
// not about what the store functions do when called in sequence.

const VAULT = "v-clear";

// The provider hard-codes a 15s deadline; the wedge case needs that same code
// path on a human timescale. This mock calls THROUGH to the real helper with an
// injected deadline — the signal, the abort and the rejection are all genuine —
// and can alternatively drop the lock entirely to model the PRE-#79 provider
// for the control. Nothing else in the module is replaced (`mirrorLockName`
// below is the real one, so the test's drain contends on the real name).
const { lockMode } = vi.hoisted(() => ({
  // Generous by default so the ordering cases can never trip the deadline;
  // the wedge case dials it down.
  lockMode: { bypass: false, waitMs: 3_000 },
}));
vi.mock("@/lib/mirror/lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mirror/lock")>();
  return {
    ...actual,
    underMirrorVaultLock: <T,>(vaultId: string, fn: () => Promise<T>) =>
      lockMode.bypass ? fn() : actual.underMirrorVaultLock(vaultId, fn, lockMode.waitMs),
  };
});

function note(id: string): Note {
  return {
    id,
    path: `Inbox/${id}`,
    createdAt: "2026-08-20T00:00:00Z",
    updatedAt: "2026-08-20T01:00:00Z",
    content: `# ${id}`,
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
  lockMode.bypass = false;
  lockMode.waitMs = 3_000;
  db?.close();
  db = null;
  useVaultStore.setState({ vaults: {}, activeVaultId: null });
  localStorage.clear();
});

/** Mount the provider and hand back its real `mirror.clearOffline`. */
async function mountClearOffline(): Promise<() => Promise<void>> {
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
  return clearOffline as unknown as () => Promise<void>;
}

describe("SyncProvider clearOffline — per-vault Web Lock (#79 item 2)", () => {
  it("waits out an in-flight drain, so the wipe wins and no watermark survives it", async () => {
    const handle = db as LensDB;
    await upsertMirrorNote(handle, VAULT, note("n1"));
    await setMirrorLastSyncedAt(handle, VAULT, 1_000);

    const clearOffline = await mountClearOffline();

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
      await clearOffline();
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

  it("control: the SAME provider call without the lock loses the race", async () => {
    // The identical staging, with the provider's acquisition dropped — the one
    // line this fix added. It runs the real `mirror.clearOffline`, so what it
    // demonstrates is that the PROVIDER loses the race unlocked, not merely
    // that the store functions do what they're told when called in order.
    lockMode.bypass = true;

    const handle = db as LensDB;
    await upsertMirrorNote(handle, VAULT, note("n1"));
    await setMirrorLastSyncedAt(handle, VAULT, 1_000);

    const clearOffline = await mountClearOffline();

    const order: string[] = [];
    let releaseDrain: (() => void) | null = null;
    const drainHolding = new Promise<void>((r) => {
      releaseDrain = r;
    });
    const drain = navigator.locks.request(mirrorLockName(VAULT), async () => {
      order.push("drain:enter");
      await drainHolding;
      await setMirrorLastSyncedAt(handle, VAULT, 2_000);
      order.push("drain:exit");
    });
    await waitFor(() => expect(order).toContain("drain:enter"));

    // Unlocked, the clear does NOT queue — it runs straight through, mid-drain.
    await act(async () => {
      await clearOffline();
    });
    order.push("clear:done");

    (releaseDrain as unknown as () => void)();
    await drain;

    expect(order).toEqual(["drain:enter", "clear:done", "drain:exit"]);
    // Rows gone but the drain's watermark landed after the wipe — a "synced,
    // updated just now" mirror with nothing in it. This is the #79 defect.
    expect(await countMirrorNotes(handle, VAULT)).toBe(0);
    expect(await getMirrorLastSyncedAt(handle, VAULT)).toBe(2_000);
  });

  it("REJECTS instead of hanging when a wedged holder never releases the lock", async () => {
    // The other side of "a button the user pressed must never silently no-op":
    // it must not silently HANG either. A drain wedged on a fetch with no
    // timeout (`requestCursorWithRetry` has none) holds the lock indefinitely.
    // Unbounded, `clearOffline` would stay pending forever and take
    // `Settings.onClear`'s `finally` with it — `busy` pinned at "clear", the
    // whole Offline section inert until a reload, nothing shown to the user.
    lockMode.waitMs = 50;

    const handle = db as LensDB;
    await upsertMirrorNote(handle, VAULT, note("n1"));
    await setMirrorLastSyncedAt(handle, VAULT, 1_000);

    const clearOffline = await mountClearOffline();

    const wedged = holdLock(mirrorLockName(VAULT));
    await wedged.held;

    // Settles — as a REJECTION, which is what routes Settings into its existing
    // "Couldn't clear the offline copy." toast and frees `busy`.
    await act(async () => {
      await expect(clearOffline()).rejects.toThrow();
    });

    // The wipe never ran, so the offline copy is intact and retryable rather
    // than half-torn-down outside the lock it failed to take.
    expect(await countMirrorNotes(handle, VAULT)).toBe(1);
    expect(await getMirrorLastSyncedAt(handle, VAULT)).toBe(1_000);

    wedged.release();
  });
});
