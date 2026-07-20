// Wave 4 storage-ceiling eviction. The durable-offline mirror is capped at a
// per-vault byte ceiling; past it we EVICT CONTENT but KEEP THE INDEX ROW —
// oldest-updatedAt first — so every note stays listable and openable-with-
// preview offline, and only the evicted tail loses its full body (a reader
// shows "Connect to load this note" offline). Two rows are NEVER evicted, the
// same sacred set the reconcile sweep protects: a bare local-id row (offline-
// created, not yet synced) and any row a pending queue mutation references.
//
// This module is pure data (no React, no network). The engine calls
// `evictOverCeiling` after a clean drain/sweep; with the mirror flag off the
// engine never exists, so none of this runs.

import { collectProtectedIds, makeIsProtected } from "@/lib/mirror/reconcile";
import { listMirrorNotes } from "@/lib/mirror/store";
import { firstLineTitle, stripLeadingH1 } from "@/lib/note-title";
import type { LensDB } from "@/lib/sync/db";
import type { MirrorNoteRow } from "@/lib/sync/types";

// 512 MB per vault (Aaron-ratified). Kept as a module constant + an engine
// option override so tests can drive eviction with a tiny ceiling.
export const MIRROR_CEILING_BYTES = 512 * 1024 * 1024;

// Longest preview snippet retained on an evicted row — matches the app's
// list/graph preview convention (NeighborhoodGraph `previewSnippet`).
const PREVIEW_MAX = 200;

export interface MirrorEvictResult {
  // Rows whose body was dropped this pass.
  evicted: number;
  // Body bytes freed (sum of the evicted rows' pre-eviction body cost).
  freedBytes: number;
  // Resulting estimated mirror size after eviction.
  totalBytes: number;
  // Set instead of the counts when a guard tripped and no eviction ran.
  skipped?: "in-flight" | "no-context" | "locked";
}

// A row's estimated storage footprint. An already-evicted row's body is gone —
// only a negligible metadata shell remains, so it counts as 0 against a 512 MB
// budget (the ceiling targets big bodies, not per-row metadata). A full row
// prefers the vault's own `byteSize` (sent on the wire), falling back to a
// content-length estimate when the vault didn't supply it. The estimate uses
// string `.length` (UTF-16 units) as a cheap byte proxy — it under-counts
// multi-byte text slightly, which is fine for a soft ceiling.
export function mirrorRowBytes(row: MirrorNoteRow): number {
  if (row.contentEvicted) return 0;
  if (typeof row.byteSize === "number" && Number.isFinite(row.byteSize) && row.byteSize >= 0) {
    return row.byteSize;
  }
  return estimateBodyBytes(row);
}

function estimateBodyBytes(row: MirrorNoteRow): number {
  let n = (row.content?.length ?? 0) + (row.preview?.length ?? 0);
  if (row.links?.length) n += JSON.stringify(row.links).length;
  if (row.attachments?.length) n += JSON.stringify(row.attachments).length;
  return n;
}

// True when a row carries a body worth evicting. A row with no content, links,
// or attachments has nothing to free — evicting it would only mark it
// `contentEvicted` and wrongly show "Connect to load this note" for a note that
// was already empty, so the plan skips it.
function hasBody(row: MirrorNoteRow): boolean {
  return !!(row.content || row.links?.length || row.attachments?.length);
}

// The retained shell of an evicted row: body fields dropped, `contentEvicted`
// set, and a preview + title snapshotted from the (about-to-be-dropped) content
// so the note stays listable/openable-with-preview. `byteSize` is reset to the
// shell's cost for honesty (though `mirrorRowBytes` short-circuits evicted rows
// to 0 regardless).
export function evictedShell(row: MirrorNoteRow): MirrorNoteRow {
  const preview = row.preview ?? derivePreview(row.content);
  const existingTitle = (row as { displayTitle?: string | null }).displayTitle;
  const displayTitle = existingTitle ?? firstLineTitle(row.content);
  return {
    ...row,
    content: undefined,
    links: undefined,
    attachments: undefined,
    contentEvicted: true,
    preview,
    displayTitle,
    byteSize: preview?.length ?? 0,
  };
}

// A short plain-text preview from a note body: leading title (H1) stripped,
// whitespace collapsed, truncated. Mirrors the app's `previewSnippet` so an
// evicted row's preview reads like a live one.
export function derivePreview(content: string | undefined): string | undefined {
  if (!content) return undefined;
  const raw = stripLeadingH1(content).replace(/\s+/g, " ").trim();
  if (!raw) return undefined;
  return raw.length > PREVIEW_MAX ? `${raw.slice(0, PREVIEW_MAX).trimEnd()}…` : raw;
}

export interface EvictionPlan {
  toEvict: MirrorNoteRow[];
  totalBefore: number;
  totalAfter: number;
  freedBytes: number;
}

// Pure eviction planner — the unit-testable core. `rows` MUST be ordered oldest
// updatedAt first (the `by-vault-updated` index order `listMirrorNotes`
// returns), so eviction walks the oldest bodies first. Walks until the
// estimated total is at or under the ceiling, skipping already-evicted rows,
// protected rows (never touch un-synced work), and bodyless rows. If the
// unevictable remainder still exceeds the ceiling (e.g. protected work alone is
// larger than the budget) it evicts everything it may and stops — un-synced
// work is sacred, so we accept staying over rather than drop it.
export function planEviction(
  rows: MirrorNoteRow[],
  ceilingBytes: number,
  isProtected: (id: string) => boolean,
): EvictionPlan {
  let total = 0;
  for (const row of rows) total += mirrorRowBytes(row);
  const totalBefore = total;

  const toEvict: MirrorNoteRow[] = [];
  if (total > ceilingBytes) {
    for (const row of rows) {
      if (total <= ceilingBytes) break;
      if (row.contentEvicted) continue;
      if (isProtected(row.id)) continue;
      if (!hasBody(row)) continue;
      toEvict.push(row);
      total -= mirrorRowBytes(row);
    }
  }
  return { toEvict, totalBefore, totalAfter: total, freedBytes: totalBefore - total };
}

// Evict enough of a vault's oldest note bodies to bring the mirror at or under
// the ceiling. Loads the vault's rows (oldest-updatedAt first), builds the
// same protected set the sweep uses (pending-referenced ids + their id-map
// resolutions; bare local ids are protected by `makeIsProtected`), plans, and
// writes the evicted shells in one transaction.
export async function evictOverCeiling(
  db: LensDB,
  vaultId: string,
  ceilingBytes: number = MIRROR_CEILING_BYTES,
): Promise<MirrorEvictResult> {
  const rows = await listMirrorNotes(db, vaultId);
  const protectedIds = await collectProtectedIds(db, vaultId);
  const isProtected = makeIsProtected(protectedIds);
  const plan = planEviction(rows, ceilingBytes, isProtected);

  if (plan.toEvict.length === 0) {
    return { evicted: 0, freedBytes: 0, totalBytes: plan.totalAfter };
  }

  const tx = db.transaction("mirror_notes", "readwrite");
  for (const row of plan.toEvict) {
    await tx.store.put(evictedShell(row));
  }
  await tx.done;

  return { evicted: plan.toEvict.length, freedBytes: plan.freedBytes, totalBytes: plan.totalAfter };
}

// Total estimated footprint of a vault's mirror (Settings shows this against
// the ceiling). Loads the rows; cheap fields, no body encoding.
export async function measureMirrorBytes(db: LensDB, vaultId: string): Promise<number> {
  const rows = await listMirrorNotes(db, vaultId);
  let total = 0;
  for (const row of rows) total += mirrorRowBytes(row);
  return total;
}
