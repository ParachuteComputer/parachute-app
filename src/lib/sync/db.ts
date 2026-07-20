import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { BlobPathMapRow, IdMapRow, MetaRow, MirrorNoteRow, PendingRow } from "./types";

// Preserved across the 2026-04-22 Lens→Notes rename: IndexedDB databases are
// origin+name scoped, so renaming would orphan Aaron's (and any rc.1 user's)
// offline queue, id-map, blob store, and queued mutations. The product's
// external identity is "Notes"; this internal handle stays.
export const DB_NAME = "parachute-lens";
// Bump on schema changes and add a case to `migrate()`. Read schemaVersion from
// `meta` if you need to introspect which migrations have run.
//
// v2 (2026-07-20) ADDS the durable-offline `mirror_notes` store — a local copy
// of the vault's notes kept fresh by the cursor hydration engine (see
// `src/lib/mirror/`). The v2 upgrade is purely additive: it does NOT touch the
// v1 queue stores (pending/id_map/blob_path_map/blobs/meta), which hold
// un-synced user writes — dropping or reindexing them would lose queued work.
export const DB_VERSION = 2;

export interface LensSyncSchema extends DBSchema {
  pending: {
    key: number;
    value: PendingRow;
    indexes: { "by-vault": string; "by-status": string };
  };
  id_map: {
    key: string;
    value: IdMapRow;
    indexes: { "by-vault": string };
  };
  blob_path_map: {
    key: string;
    value: BlobPathMapRow;
    indexes: { "by-vault": string };
  };
  blobs: {
    key: string;
    value: {
      blobId: string;
      // Stored as a raw byte buffer + mimeType rather than a Blob. Some
      // runtimes (notably fake-indexeddb under vitest) don't preserve Blob
      // through structured clone; ArrayBuffer round-trips identically
      // everywhere we run.
      data: ArrayBuffer;
      mimeType: string;
      vaultId: string;
      createdAt: number;
    };
  };
  meta: {
    key: string;
    value: MetaRow;
  };
  // Durable-offline mirror (DB v2). Composite key [vaultId, id]: a
  // restored/imported vault copy can carry the same note ids as its origin, so
  // a bare `id` key would collide across vaults. `by-vault` scopes a wipe/count
  // to one vault; `by-vault-updated` gives a per-vault list sorted by
  // updatedAt for the offline note lists Wave 3 will read.
  mirror_notes: {
    key: [string, string];
    value: MirrorNoteRow;
    indexes: { "by-vault": string; "by-vault-updated": [string, string] };
  };
}

export type LensDB = IDBPDatabase<LensSyncSchema>;

export async function openLensDB(name = DB_NAME, version = DB_VERSION): Promise<LensDB> {
  return openDB<LensSyncSchema>(name, version, {
    upgrade(db, oldVersion) {
      migrate(db, oldVersion);
    },
  });
}

function migrate(db: LensDB, fromVersion: number): void {
  // Any migration ladder starts with v0 → v1. Add further cases as versions bump.
  if (fromVersion < 1) {
    const pending = db.createObjectStore("pending", { keyPath: "seq", autoIncrement: true });
    pending.createIndex("by-vault", "vaultId");
    pending.createIndex("by-status", "status");

    const idMap = db.createObjectStore("id_map", { keyPath: "localId" });
    idMap.createIndex("by-vault", "vaultId");

    const blobPath = db.createObjectStore("blob_path_map", { keyPath: "blobId" });
    blobPath.createIndex("by-vault", "vaultId");

    db.createObjectStore("blobs", { keyPath: "blobId" });
    db.createObjectStore("meta", { keyPath: "key" });
  }
  // v2: add the mirror store. ADD-ONLY — the v1 block above already created
  // (and an upgrading DB already holds) the queue stores; touching them here
  // would orphan queued writes. A fresh DB runs both blocks; a v1→v2 upgrade
  // runs only this one.
  if (fromVersion < 2) {
    const mirror = db.createObjectStore("mirror_notes", { keyPath: ["vaultId", "id"] });
    mirror.createIndex("by-vault", "vaultId");
    mirror.createIndex("by-vault-updated", ["vaultId", "updatedAt"]);
  }
}

export async function getMeta<T>(db: LensDB, key: string): Promise<T | undefined> {
  const row = await db.get("meta", key);
  return row?.value as T | undefined;
}

export async function setMeta(db: LensDB, key: string, value: unknown): Promise<void> {
  await db.put("meta", { key, value });
}

export async function deleteMeta(db: LensDB, key: string): Promise<void> {
  await db.delete("meta", key);
}
