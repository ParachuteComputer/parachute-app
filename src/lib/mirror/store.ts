import { type LensDB, deleteMeta, getMeta, setMeta } from "@/lib/sync/db";
import type { MirrorNoteRow } from "@/lib/sync/types";
import type { Note, TagSummary } from "@/lib/vault/types";
import { isMirrorEnabled } from "./flag";
import type { MirrorState, MirrorWriteSink } from "./types";

// ---------- meta keys (cursor + sync state, kept in the existing `meta` store) ----------

export function cursorKey(vaultId: string): string {
  return `mirror:${vaultId}:cursor`;
}
export function stateKey(vaultId: string): string {
  return `mirror:${vaultId}:state`;
}
export function lastSyncedAtKey(vaultId: string): string {
  return `mirror:${vaultId}:lastSyncedAt`;
}
// The reconcile sweep's own watermark (distinct from the per-poll lastSyncedAt).
// Throttles the full-ID sweep to at most once per interval across app starts.
export function lastSweepAtKey(vaultId: string): string {
  return `mirror:${vaultId}:lastSweepAt`;
}
// The vault's tag list, refreshed on each sweep so Wave 3's offline note list
// can render tag filters without a network round-trip.
export function tagsKey(vaultId: string): string {
  return `mirror:${vaultId}:tags`;
}

export async function getMirrorCursor(db: LensDB, vaultId: string): Promise<string | undefined> {
  return getMeta<string>(db, cursorKey(vaultId));
}
// The cursor is a resumable keyset watermark — persist it after EVERY page so a
// killed app resumes exactly where it stopped (no separate hydration mode).
export async function setMirrorCursor(db: LensDB, vaultId: string, cursor: string): Promise<void> {
  await setMeta(db, cursorKey(vaultId), cursor);
}
// Drop the watermark so the next sync re-walks from "" — used to recover from a
// server-rejected cursor (invalidated / query-hash mismatch). Upserts are
// idempotent, so a full re-walk is safe.
export async function clearMirrorCursor(db: LensDB, vaultId: string): Promise<void> {
  await deleteMeta(db, cursorKey(vaultId));
}

export async function getMirrorState(
  db: LensDB,
  vaultId: string,
): Promise<MirrorState | undefined> {
  return getMeta<MirrorState>(db, stateKey(vaultId));
}
export async function setMirrorState(
  db: LensDB,
  vaultId: string,
  state: MirrorState,
): Promise<void> {
  await setMeta(db, stateKey(vaultId), state);
}

export async function getMirrorLastSyncedAt(
  db: LensDB,
  vaultId: string,
): Promise<number | undefined> {
  return getMeta<number>(db, lastSyncedAtKey(vaultId));
}
export async function setMirrorLastSyncedAt(
  db: LensDB,
  vaultId: string,
  at: number,
): Promise<void> {
  await setMeta(db, lastSyncedAtKey(vaultId), at);
}

export async function getMirrorLastSweepAt(
  db: LensDB,
  vaultId: string,
): Promise<number | undefined> {
  return getMeta<number>(db, lastSweepAtKey(vaultId));
}
export async function setMirrorLastSweepAt(db: LensDB, vaultId: string, at: number): Promise<void> {
  await setMeta(db, lastSweepAtKey(vaultId), at);
}

export async function getMirrorTags(
  db: LensDB,
  vaultId: string,
): Promise<TagSummary[] | undefined> {
  return getMeta<TagSummary[]>(db, tagsKey(vaultId));
}
export async function setMirrorTags(
  db: LensDB,
  vaultId: string,
  tags: TagSummary[],
): Promise<void> {
  await setMeta(db, tagsKey(vaultId), tags);
}

// ---------- note rows (unconditional store ops — NOT flag-gated) ----------

// Normalize a Note into a mirror row: stamp the vault discriminator and
// guarantee `updatedAt` is set (it feeds the `by-vault-updated` index, and IDB
// skips rows missing an indexed key). A cursor page always carries updatedAt;
// this only backstops an optimistic offline row that somehow lacks one.
function toRow(vaultId: string, note: Note): MirrorNoteRow {
  return { ...note, vaultId, updatedAt: note.updatedAt ?? note.createdAt };
}

export async function upsertMirrorNote(db: LensDB, vaultId: string, note: Note): Promise<void> {
  await db.put("mirror_notes", toRow(vaultId, note));
}

// Batch upsert one cursor page in a single transaction — the hydration engine's
// per-page write.
export async function upsertMirrorNotes(db: LensDB, vaultId: string, notes: Note[]): Promise<void> {
  if (notes.length === 0) return;
  const tx = db.transaction("mirror_notes", "readwrite");
  for (const note of notes) {
    await tx.store.put(toRow(vaultId, note));
  }
  await tx.done;
}

export async function removeMirrorNote(db: LensDB, vaultId: string, id: string): Promise<void> {
  await db.delete("mirror_notes", [vaultId, id]);
}

// Batch-delete a set of ids for a vault in one transaction — the reconcile
// sweep's prune of server-deleted notes.
export async function removeMirrorNotes(db: LensDB, vaultId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const tx = db.transaction("mirror_notes", "readwrite");
  for (const id of ids) {
    await tx.store.delete([vaultId, id]);
  }
  await tx.done;
}

export async function getMirrorNote(
  db: LensDB,
  vaultId: string,
  id: string,
): Promise<MirrorNoteRow | undefined> {
  return db.get("mirror_notes", [vaultId, id]);
}

// A note created offline drained to a server id. Drop the optimistic local-id
// row and write the authoritative server row in ONE transaction so a reader
// never sees both (or neither).
export async function replaceLocalMirrorNote(
  db: LensDB,
  vaultId: string,
  localId: string,
  serverNote: Note,
): Promise<void> {
  const tx = db.transaction("mirror_notes", "readwrite");
  await tx.store.delete([vaultId, localId]);
  await tx.store.put(toRow(vaultId, serverNote));
  await tx.done;
}

export async function countMirrorNotes(db: LensDB, vaultId: string): Promise<number> {
  return db.countFromIndex("mirror_notes", "by-vault", vaultId);
}

// All rows for a vault, ascending by updatedAt (via `by-vault-updated`). The
// offline note lists Wave 3 reads; also the assertion surface for tests.
export async function listMirrorNotes(db: LensDB, vaultId: string): Promise<MirrorNoteRow[]> {
  return db.getAllFromIndex(
    "mirror_notes",
    "by-vault-updated",
    // Compound-key range: every [vaultId, updatedAt] whose first component is
    // this vault. "￿" as the upper bound's second component is above any
    // real ISO-timestamp string, so the range captures the whole vault, sorted
    // ascending by updatedAt.
    IDBKeyRange.bound([vaultId, ""], [vaultId, "￿"]),
  );
}

// Delete every row for a vault (used when a vault is disconnected/forgotten).
export async function clearMirrorForVault(db: LensDB, vaultId: string): Promise<number> {
  const keys = await db.getAllKeysFromIndex("mirror_notes", "by-vault", vaultId);
  const tx = db.transaction("mirror_notes", "readwrite");
  for (const key of keys) {
    await tx.store.delete(key);
  }
  await tx.done;
  return keys.length;
}

// ---------- flag-gated write-path helpers + sink ----------

export async function mirrorRecordUpsert(db: LensDB, vaultId: string, note: Note): Promise<void> {
  if (!isMirrorEnabled()) return;
  await upsertMirrorNote(db, vaultId, note);
}

export async function mirrorRecordRemove(db: LensDB, vaultId: string, id: string): Promise<void> {
  if (!isMirrorEnabled()) return;
  await removeMirrorNote(db, vaultId, id);
}

export async function mirrorRecordLocalIdLanded(
  db: LensDB,
  vaultId: string,
  localId: string,
  serverNote: Note,
): Promise<void> {
  if (!isMirrorEnabled()) return;
  await replaceLocalMirrorNote(db, vaultId, localId, serverNote);
}

// Bind a write sink to a DB handle. The queue drain calls this on every
// landing; each method no-ops when the flag is off.
export function createMirrorWriteSink(db: LensDB): MirrorWriteSink {
  return {
    upsert: (vaultId, note) => mirrorRecordUpsert(db, vaultId, note),
    remove: (vaultId, id) => mirrorRecordRemove(db, vaultId, id),
    localIdLanded: (vaultId, localId, note) =>
      mirrorRecordLocalIdLanded(db, vaultId, localId, note),
  };
}
