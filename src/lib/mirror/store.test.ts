import { type LensDB, openLensDB } from "@/lib/sync/db";
import { countPending, enqueue } from "@/lib/sync/queue";
import type { Note } from "@/lib/vault/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIRROR_FLAG_KEY } from "./flag";
import {
  clearMirrorCursor,
  clearMirrorForVault,
  clearMirrorMeta,
  countMirrorNotes,
  getMirrorCursor,
  getMirrorLastSweepAt,
  getMirrorLastSyncedAt,
  getMirrorNote,
  getMirrorState,
  getMirrorTags,
  listMirrorNotes,
  mirrorRecordLocalIdLanded,
  mirrorRecordRemove,
  mirrorRecordUpsert,
  removeMirrorNote,
  replaceLocalMirrorNote,
  setMirrorCursor,
  setMirrorLastSweepAt,
  setMirrorLastSyncedAt,
  setMirrorState,
  setMirrorTags,
  upsertMirrorNote,
  upsertMirrorNotes,
} from "./store";

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
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

describe("mirror store — note rows", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
    localStorage.clear();
  });
  afterEach(() => {
    db.close();
  });

  it("upserts and reads back a full note row", async () => {
    await upsertMirrorNote(db, "v1", note("n1", { content: "# body", tags: ["#x"] }));
    const row = await getMirrorNote(db, "v1", "n1");
    expect(row).toMatchObject({ id: "n1", vaultId: "v1", content: "# body", tags: ["#x"] });
  });

  it("keys by [vaultId, id] — the same id in two vaults is two rows", async () => {
    await upsertMirrorNote(db, "v1", note("shared", { content: "# from v1" }));
    await upsertMirrorNote(db, "v2", note("shared", { content: "# from v2" }));
    expect((await getMirrorNote(db, "v1", "shared"))?.content).toBe("# from v1");
    expect((await getMirrorNote(db, "v2", "shared"))?.content).toBe("# from v2");
    expect(await countMirrorNotes(db, "v1")).toBe(1);
    expect(await countMirrorNotes(db, "v2")).toBe(1);
  });

  it("removes a row by [vaultId, id] without touching the other vault", async () => {
    await upsertMirrorNote(db, "v1", note("shared"));
    await upsertMirrorNote(db, "v2", note("shared"));
    await removeMirrorNote(db, "v1", "shared");
    expect(await getMirrorNote(db, "v1", "shared")).toBeUndefined();
    expect(await getMirrorNote(db, "v2", "shared")).toBeDefined();
  });

  it("batch-upserts a page in one call", async () => {
    await upsertMirrorNotes(db, "v1", [note("a"), note("b"), note("c")]);
    expect(await countMirrorNotes(db, "v1")).toBe(3);
  });

  it("normalizes a missing updatedAt to createdAt so the row stays indexed", async () => {
    await upsertMirrorNote(db, "v1", {
      id: "no-upd",
      createdAt: "2026-07-20T05:00:00Z",
      content: "# x",
    });
    const row = await getMirrorNote(db, "v1", "no-upd");
    expect(row?.updatedAt).toBe("2026-07-20T05:00:00Z");
    // Present in the by-vault-updated listing (would be skipped if unindexed).
    const listed = await listMirrorNotes(db, "v1");
    expect(listed.map((r) => r.id)).toContain("no-upd");
  });

  it("lists a vault's rows ascending by updatedAt", async () => {
    await upsertMirrorNotes(db, "v1", [
      note("late", { updatedAt: "2026-07-20T09:00:00Z" }),
      note("early", { updatedAt: "2026-07-20T01:00:00Z" }),
      note("mid", { updatedAt: "2026-07-20T05:00:00Z" }),
    ]);
    await upsertMirrorNote(db, "v2", note("other-vault"));
    const listed = await listMirrorNotes(db, "v1");
    expect(listed.map((r) => r.id)).toEqual(["early", "mid", "late"]);
  });

  it("replaceLocalMirrorNote swaps the optimistic local row for the server row atomically", async () => {
    await upsertMirrorNote(db, "v1", note("local-abc", { content: "# optimistic" }));
    await replaceLocalMirrorNote(db, "v1", "local-abc", note("srv-9", { content: "# server" }));
    expect(await getMirrorNote(db, "v1", "local-abc")).toBeUndefined();
    expect((await getMirrorNote(db, "v1", "srv-9"))?.content).toBe("# server");
    expect(await countMirrorNotes(db, "v1")).toBe(1);
  });

  it("clearMirrorForVault drops only that vault's rows", async () => {
    await upsertMirrorNotes(db, "v1", [note("a"), note("b")]);
    await upsertMirrorNote(db, "v2", note("c"));
    const dropped = await clearMirrorForVault(db, "v1");
    expect(dropped).toBe(2);
    expect(await countMirrorNotes(db, "v1")).toBe(0);
    expect(await countMirrorNotes(db, "v2")).toBe(1);
  });
});

describe("mirror store — cursor + sync-state meta", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => {
    db.close();
  });

  it("round-trips the per-vault cursor, state, and lastSyncedAt", async () => {
    await setMirrorCursor(db, "v1", "cursor-xyz");
    await setMirrorState(db, "v1", { phase: "live" });
    await setMirrorLastSyncedAt(db, "v1", 12345);
    expect(await getMirrorCursor(db, "v1")).toBe("cursor-xyz");
    expect(await getMirrorState(db, "v1")).toEqual({ phase: "live" });
    expect(await getMirrorLastSyncedAt(db, "v1")).toBe(12345);
    // Per-vault isolation.
    expect(await getMirrorCursor(db, "v2")).toBeUndefined();
  });

  it("clearMirrorMeta drops state/lastSyncedAt/lastSweepAt/tags but leaves the cursor", async () => {
    await setMirrorCursor(db, "v1", "cursor-xyz");
    await setMirrorState(db, "v1", { phase: "live" });
    await setMirrorLastSyncedAt(db, "v1", 12345);
    await setMirrorLastSweepAt(db, "v1", 999);
    await setMirrorTags(db, "v1", [{ name: "#x", count: 2 }]);

    await clearMirrorMeta(db, "v1");

    // The sync-state meta is gone, so a reload reads truly EMPTY (cold re-fill).
    expect(await getMirrorState(db, "v1")).toBeUndefined();
    expect(await getMirrorLastSyncedAt(db, "v1")).toBeUndefined();
    expect(await getMirrorLastSweepAt(db, "v1")).toBeUndefined();
    expect(await getMirrorTags(db, "v1")).toBeUndefined();
    // The cursor is NOT this helper's business (clearMirrorCursor owns it).
    expect(await getMirrorCursor(db, "v1")).toBe("cursor-xyz");
  });

  it("clearMirrorMeta is per-vault — another vault's meta is untouched", async () => {
    await setMirrorState(db, "v1", { phase: "live" });
    await setMirrorState(db, "v2", { phase: "live" });
    await setMirrorLastSyncedAt(db, "v2", 7);

    await clearMirrorMeta(db, "v1");

    expect(await getMirrorState(db, "v1")).toBeUndefined();
    expect(await getMirrorState(db, "v2")).toEqual({ phase: "live" });
    expect(await getMirrorLastSyncedAt(db, "v2")).toBe(7);
  });

  it("the composed Clear-offline-copy store ops leave the write queue intact (sacred work)", async () => {
    // Mirror what SyncProvider.clearOffline does at the store layer: wipe note
    // rows + cursor + sync-state meta. The pending write queue (un-synced user
    // work) must survive untouched.
    await upsertMirrorNotes(db, "v1", [note("a"), note("b")]);
    await setMirrorCursor(db, "v1", "cursor-xyz");
    await setMirrorState(db, "v1", { phase: "live" });
    await setMirrorLastSyncedAt(db, "v1", 12345);
    await enqueue(
      db,
      { kind: "create-note", localId: "local-1", payload: { content: "# unsynced" } },
      { vaultId: "v1" },
    );
    expect(await countPending(db)).toBe(1);

    await clearMirrorForVault(db, "v1");
    await clearMirrorCursor(db, "v1");
    await clearMirrorMeta(db, "v1");

    // Mirror copy + sync-state gone …
    expect(await countMirrorNotes(db, "v1")).toBe(0);
    expect(await getMirrorCursor(db, "v1")).toBeUndefined();
    expect(await getMirrorState(db, "v1")).toBeUndefined();
    expect(await getMirrorLastSyncedAt(db, "v1")).toBeUndefined();
    // … but the queued mutation is preserved (the pin).
    expect(await countPending(db)).toBe(1);
  });
});

describe("mirror store — flag-gated write helpers", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
    localStorage.clear();
  });
  afterEach(() => {
    db.close();
    localStorage.clear();
  });

  it("does nothing when the mirror flag is OFF", async () => {
    // The mirror is now ON by default, so force it OFF explicitly.
    localStorage.setItem(MIRROR_FLAG_KEY, "false");
    await mirrorRecordUpsert(db, "v1", note("n1"));
    await mirrorRecordLocalIdLanded(db, "v1", "local-1", note("srv-1"));
    await mirrorRecordRemove(db, "v1", "whatever");
    expect(await countMirrorNotes(db, "v1")).toBe(0);
  });

  it("writes when the mirror flag is ON", async () => {
    localStorage.setItem(MIRROR_FLAG_KEY, "true");
    await mirrorRecordUpsert(db, "v1", note("n1"));
    expect(await getMirrorNote(db, "v1", "n1")).toBeDefined();

    // Landing swaps a pre-seeded optimistic row for the server row.
    await mirrorRecordUpsert(db, "v1", note("local-2", { content: "# opt" }));
    await mirrorRecordLocalIdLanded(db, "v1", "local-2", note("srv-2", { content: "# srv" }));
    expect(await getMirrorNote(db, "v1", "local-2")).toBeUndefined();
    expect((await getMirrorNote(db, "v1", "srv-2"))?.content).toBe("# srv");

    await mirrorRecordRemove(db, "v1", "n1");
    expect(await getMirrorNote(db, "v1", "n1")).toBeUndefined();
  });
});
