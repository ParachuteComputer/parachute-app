import { type IDBPDatabase, openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type LensDB, getMeta, openLensDB } from "./db";

// A dedicated DB name so the v1→v2 upgrade runs against a real v1 database with
// real queued data — the thing the upgrade must NOT lose.
const MIGRATION_DB = "parachute-lens-migration-test";

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    // No open connections in these tests, so a block shouldn't happen; resolve
    // defensively so a stray one can't wedge the suite.
    req.onblocked = () => resolve();
  });
}

// Build a genuine v1 database WITHOUT going through openLensDB — its migrate()
// gates only on oldVersion, so it would create every store (including the v2
// one) on any fresh open. This replicates the exact v1 schema so the reopen
// below exercises the real v1→v2 upgrade path.
async function openV1Raw(): Promise<IDBPDatabase> {
  return openDB(MIGRATION_DB, 1, {
    upgrade(db) {
      const pending = db.createObjectStore("pending", { keyPath: "seq", autoIncrement: true });
      pending.createIndex("by-vault", "vaultId");
      pending.createIndex("by-status", "status");
      const idMap = db.createObjectStore("id_map", { keyPath: "localId" });
      idMap.createIndex("by-vault", "vaultId");
      const blobPath = db.createObjectStore("blob_path_map", { keyPath: "blobId" });
      blobPath.createIndex("by-vault", "vaultId");
      db.createObjectStore("blobs", { keyPath: "blobId" });
      db.createObjectStore("meta", { keyPath: "key" });
    },
  });
}

describe("db migration v1 → v2 (mirror_notes)", () => {
  beforeEach(async () => {
    await deleteDb(MIGRATION_DB);
  });
  afterEach(async () => {
    await deleteDb(MIGRATION_DB);
  });

  it("adds mirror_notes on upgrade WITHOUT dropping the v1 queue stores or their data", async () => {
    // 1. Genuine v1 DB, seeded with un-synced work in every queue store.
    const v1 = await openV1Raw();
    expect(Array.from(v1.objectStoreNames).sort()).toEqual([
      "blob_path_map",
      "blobs",
      "id_map",
      "meta",
      "pending",
    ]);
    expect(v1.objectStoreNames.contains("mirror_notes")).toBe(false);

    await v1.add("pending", {
      id: "row-1",
      vaultId: "v1",
      mutation: { kind: "create-note", localId: "local-1", payload: { content: "# hi" } },
      createdAt: 1,
      attemptCount: 0,
      nextAttemptAt: 0,
      status: "pending",
    });
    await v1.put("id_map", { localId: "local-1", realId: "srv-1", vaultId: "v1", mappedAt: 1 });
    await v1.put("blob_path_map", {
      blobId: "blob-1",
      serverPath: "storage/attachments/a.png",
      vaultId: "v1",
      mappedAt: 1,
    });
    await v1.put("blobs", {
      blobId: "blob-1",
      data: new ArrayBuffer(4),
      mimeType: "image/png",
      vaultId: "v1",
      createdAt: 111,
    });
    await v1.put("meta", { key: "auth-halted", value: { vaultId: "v1", at: 222 } });
    v1.close();

    // 2. Reopen through the real openLensDB (DB_VERSION=2) → upgrade with
    //    oldVersion=1, so ONLY the `< 2` block runs (adds mirror_notes).
    const v2: LensDB = await openLensDB(MIGRATION_DB);

    // The new store exists alongside every v1 store.
    expect(Array.from(v2.objectStoreNames).sort()).toEqual([
      "blob_path_map",
      "blobs",
      "id_map",
      "meta",
      "mirror_notes",
      "pending",
    ]);

    // Every seeded row survived the upgrade — no orphaning, no reindex loss.
    const pending = await v2.getAll("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].mutation.kind).toBe("create-note");
    expect(await v2.get("id_map", "local-1")).toMatchObject({ realId: "srv-1", vaultId: "v1" });
    expect(await v2.get("blob_path_map", "blob-1")).toMatchObject({
      serverPath: "storage/attachments/a.png",
    });
    expect(await v2.get("blobs", "blob-1")).toMatchObject({ mimeType: "image/png" });
    expect(await getMeta(v2, "auth-halted")).toMatchObject({ vaultId: "v1", at: 222 });

    // The upgraded DB can immediately hold a mirror row (composite key).
    await v2.put("mirror_notes", {
      vaultId: "v1",
      id: "srv-1",
      createdAt: "2026-07-20T00:00:00Z",
      updatedAt: "2026-07-20T00:00:00Z",
      content: "# mirrored",
    });
    expect(await v2.get("mirror_notes", ["v1", "srv-1"])).toMatchObject({ content: "# mirrored" });

    v2.close();
  });

  it("creates mirror_notes with the composite key and both vault indexes", async () => {
    const v1 = await openV1Raw();
    v1.close();
    const v2 = await openLensDB(MIGRATION_DB);
    const tx = v2.transaction("mirror_notes", "readonly");
    const store = tx.store;
    expect(store.keyPath).toEqual(["vaultId", "id"]);
    expect(Array.from(store.indexNames).sort()).toEqual(["by-vault", "by-vault-updated"]);
    expect(store.index("by-vault").keyPath).toBe("vaultId");
    expect(store.index("by-vault-updated").keyPath).toEqual(["vaultId", "updatedAt"]);
    await tx.done;
    v2.close();
  });

  it("a fresh DB (no prior v1) opens straight to v2 with every store present", async () => {
    // A first-ever open runs BOTH migration blocks, so the queue stores AND
    // mirror_notes all exist.
    const db = await openLensDB(MIGRATION_DB);
    expect(Array.from(db.objectStoreNames).sort()).toEqual([
      "blob_path_map",
      "blobs",
      "id_map",
      "meta",
      "mirror_notes",
      "pending",
    ]);
    db.close();
  });
});
