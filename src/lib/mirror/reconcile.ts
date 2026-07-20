import type { LensDB } from "@/lib/sync/db";
import { isLocalId } from "@/lib/sync/id-map";
import type { PendingPayload } from "@/lib/sync/types";

// ---------------------------------------------------------------------------
// The reconcile primitives the sweep is built from — kept pure (or narrowly
// db-reading) so the two CRITICAL safety properties can be pinned in isolation:
//   1. the local-id / pending EXCLUSION (never prune un-synced user work), and
//   2. the ABORT-on-incomplete-enumeration guard (never mass-delete on a
//      failed/empty server walk — that lives in the engine; the diff here only
//      ever prunes what it was TOLD is absent server-side).
// ---------------------------------------------------------------------------

// The note id a pending mutation targets, or null for the mutations that carry
// no note reference (attachment upload, settings-note patch). Used to build the
// exclusion set: any note with a mutation still in the queue must survive a
// prune, because deleting it would destroy the offline write's optimistic view.
export function referencedNoteId(mutation: PendingPayload): string | null {
  switch (mutation.kind) {
    case "create-note":
      return mutation.localId;
    case "update-note":
    case "delete-note":
      return mutation.targetId;
    case "link-attachment":
    case "delete-attachment":
      return mutation.noteId;
    default:
      // upload-attachment (blob-keyed) + update-settings (path-keyed) — no note id.
      return null;
  }
}

// The set of note ids that MUST NEVER be pruned by the sweep because they carry
// un-synced work: any id a pending queue mutation references, PLUS its id-map
// resolution. A note created offline, then edited, may have a pending row that
// still names the LOCAL id while its create already drained and the mirror row
// now lives under the SERVER id — protect both ends so neither is pruned.
//
// (Bare local-id rows are excluded separately at diff time via `isLocalId`, so
// an offline-created note with NO pending row is still protected.)
export async function collectProtectedIds(db: LensDB, vaultId: string): Promise<Set<string>> {
  const protectedIds = new Set<string>();
  const pending = await db.getAllFromIndex("pending", "by-vault", vaultId);
  for (const row of pending) {
    const id = referencedNoteId(row.mutation);
    if (id) protectedIds.add(id);
  }
  if (protectedIds.size > 0) {
    const idMap = await db.getAllFromIndex("id_map", "by-vault", vaultId);
    for (const m of idMap) {
      if (protectedIds.has(m.localId)) protectedIds.add(m.realId);
    }
  }
  return protectedIds;
}

// The subset of a mirror row the diff needs (id + the timestamp the freshness
// check compares). A full `MirrorNoteRow` satisfies it.
export interface MirrorRowRef {
  id: string;
  updatedAt?: string;
}

export interface MirrorDiff {
  // mirror-has / server-lacks, and NOT protected → prune locally.
  toDelete: string[];
  // server-has / mirror-lacks → fetch full bodies + upsert (heals imports that
  // landed behind the cursor watermark).
  toBackfill: string[];
  // present in both, but the server's lean updatedAt is newer than the mirror
  // row → refetch full (belt-and-suspenders against a missed content update).
  toRefetch: string[];
}

// Diff the mirror against the COMPLETE server-id index (id → updatedAt) the
// lean walk produced. The caller must only pass an index it provably fully
// enumerated — this function assumes an absence means "gone server-side", so a
// partial index would over-delete. `isProtected` folds in the local-id +
// pending exclusion.
export function diffMirror(
  mirrorRows: MirrorRowRef[],
  serverIndex: Map<string, string>,
  isProtected: (id: string) => boolean,
): MirrorDiff {
  const toDelete: string[] = [];
  const toRefetch: string[] = [];
  const mirrorIds = new Set<string>();

  for (const row of mirrorRows) {
    mirrorIds.add(row.id);
    const serverUpdatedAt = serverIndex.get(row.id);
    if (serverUpdatedAt === undefined) {
      if (!isProtected(row.id)) toDelete.push(row.id);
      continue;
    }
    // ISO-8601 timestamps compare correctly as strings (same fixed shape).
    if (row.updatedAt === undefined || serverUpdatedAt > row.updatedAt) {
      toRefetch.push(row.id);
    }
  }

  const toBackfill: string[] = [];
  for (const id of serverIndex.keys()) {
    if (!mirrorIds.has(id)) toBackfill.push(id);
  }

  return { toDelete, toBackfill, toRefetch };
}

// Convenience predicate the engine builds once per sweep: a row is protected
// when it's a bare local id OR its id is in the pending-derived set.
export function makeIsProtected(protectedIds: Set<string>): (id: string) => boolean {
  return (id: string) => isLocalId(id) || protectedIds.has(id);
}
