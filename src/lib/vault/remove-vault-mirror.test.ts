import { MirrorEngine } from "@/lib/mirror/engine";
import { forgetVaultMirror } from "@/lib/mirror/forget";
import { mirrorLockName } from "@/lib/mirror/lock";
import { readNote, readNotesList } from "@/lib/mirror/read";
import {
  countMirrorNotes,
  getMirrorCursor,
  getMirrorLastSyncedAt,
  setMirrorLastSyncedAt,
  upsertMirrorNote,
} from "@/lib/mirror/store";
import { type LensDB, openLensDB } from "@/lib/sync/db";
import { saveVaults } from "@/lib/vault/storage";
import { isVaultRemoved, useVaultStore } from "@/lib/vault/store";
import type { Note, VaultRecord } from "@/lib/vault/types";
import { holdLock, installFifoLocks } from "@/test/locks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-318 review 3. Deleting a vault (DeleteVault) or the account
// (DeleteAccount's forgetAccountVaults) ends in removeVault. The SPA's durable
// offline mirror is ON by default and holds every note of the vault in
// IndexedDB; removeVault clears the token and the localStorage drafts but not
// the mirror. The browser keeps the "permanently deleted" vault's notes, and a
// vault re-created under the same URL (same vault id) serves them again
// local-first, since the completeness watermark is still set.

const record: VaultRecord = {
  id: "moss-id",
  url: "https://vault.example.com/vault/moss",
  name: "moss",
  issuer: "https://id.example.com",
  clientId: "c",
  scope: "vault:moss:read vault:moss:write",
  addedAt: "2026-10-01T00:00:00.000Z",
  lastUsedAt: "2026-10-01T00:00:00.000Z",
};

function note(id: string): Note {
  return {
    id,
    path: `Inbox/${id}`,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    content: `the words the owner deleted (${id})`,
  };
}

const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe("removing a vault from this browser", () => {
  let db: LensDB;
  let restoreLocks: (() => void) | null = null;
  beforeEach(async () => {
    indexedDB.deleteDatabase("parachute-lens");
    localStorage.clear();
    db = await openLensDB();
    saveVaults({ [record.id]: record });
    useVaultStore.setState({ vaults: { [record.id]: record }, activeVaultId: record.id });
  });
  afterEach(() => {
    restoreLocks?.();
    restoreLocks = null;
    vi.restoreAllMocks();
    db.close();
  });

  async function mirrorLeft() {
    const list = await readNotesList(db, record.id, new URLSearchParams());
    return {
      rows: await countMirrorNotes(db, record.id),
      note: (await readNote(db, record.id, "n1"))?.content ?? null,
      listed: list?.length ?? 0,
      lastSyncedAt: (await getMirrorLastSyncedAt(db, record.id)) ?? null,
      cursor: (await getMirrorCursor(db, record.id)) ?? null,
    };
  }
  const nothingLeft = { rows: 0, note: null, listed: 0, lastSyncedAt: null, cursor: null };

  it("leaves none of its notes in the offline mirror", async () => {
    await upsertMirrorNote(db, record.id, note("n1"));
    await setMirrorLastSyncedAt(db, record.id, Date.parse("2026-10-01T00:00:00Z"));

    useVaultStore.getState().removeVault(record.id);
    await settle();

    expect(await mirrorLeft()).toEqual(nothingLeft);
  });

  // Codex review 1 (P2): another tab's drain holds the vault's mirror lock past
  // the 15 s wait (a page fetch on a slow link). The wipe must not run beside
  // it: the drain would then commit its page and watermark AFTER the wipe and
  // the removed vault's notes would stay in IndexedDB. The deadline is made to
  // expire at once here so the test runs on a human timescale.
  it("waits out a drain that holds the lock past the deadline, then wipes", async () => {
    restoreLocks = installFifoLocks();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() =>
      AbortSignal.abort(new DOMException("lock wait deadline", "TimeoutError")),
    );
    await upsertMirrorNote(db, record.id, note("n0"));
    const drain = holdLock(mirrorLockName(record.id));
    await drain.held;

    useVaultStore.getState().removeVault(record.id);
    await settle();
    // The drain's page lands, it stamps the watermark, and lets the lock go.
    await upsertMirrorNote(db, record.id, note("n1"));
    await setMirrorLastSyncedAt(db, record.id, Date.parse("2026-10-01T00:00:00Z"));
    drain.release();
    await settle();

    expect(await mirrorLeft()).toEqual(nothingLeft);
  });
  // A mirror engine wired the way SyncProvider wires it, for a tab whose idea
  // of the active vault is stale (another tab removed it, or this tab's tick
  // fired before the store change reached the engine). One page, then the end
  // (or a failed fetch: an errored drain gets no follow-up sweep).
  function staleEngine(onFetch?: () => Promise<void>, then: "end" | "fail" = "end") {
    let served = false;
    const client = {
      queryNotesCursor: vi.fn(async () => {
        await onFetch?.();
        if (served && then === "fail") throw new Error("network connection lost");
        if (served) return { items: [] as Note[], nextCursor: "c2" };
        served = true;
        return { items: [note("n1")], nextCursor: "c1" };
      }),
    };
    return new MirrorEngine({
      db,
      resolveContext: () => ({ client, vaultId: record.id }),
      tickIntervalMs: 10 * 60_000,
      isVaultRemoved,
    });
  }

  it("a drain that starts after another tab removed the vault writes nothing back", async () => {
    await upsertMirrorNote(db, record.id, note("n1"));
    // The other tab: its removeVault drops the vault from the shared registry
    // and wipes the mirror. This tab's in-memory store has not caught up yet.
    saveVaults({});
    await forgetVaultMirror(record.id);

    await staleEngine().syncOnce();

    expect(await mirrorLeft()).toEqual(nothingLeft);
  });

  it("a drain in flight when the vault is removed in this tab leaves nothing behind", async () => {
    // No Web Locks here (jsdom), the pre-lock single-tab case: the wipe runs
    // and finishes while the drain's first page fetch is still out.
    let removed = false;
    const engine = staleEngine(async () => {
      if (removed) return;
      removed = true;
      useVaultStore.getState().removeVault(record.id);
      await settle();
    }, "fail");

    await engine.syncOnce();
    await settle();

    expect(await mirrorLeft()).toEqual(nothingLeft);
  });
});
