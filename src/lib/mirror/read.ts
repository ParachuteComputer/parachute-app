// Wave 3 read layer — serve notes from the durable-offline mirror when the
// network can't answer (cold-launch / offline). Pure data functions over the
// `mirror_notes` store: no React, no network, no flag checks (the CALLER gates
// on the mirror flag — see `queries.ts`). Kept free of `queries.ts` imports so
// there's no cycle (queries.ts imports these; these import only store + id-map).
//
// The evaluator is deliberately conservative: it reproduces the vault's server
// semantics for the SMALL query subset the app's list hooks actually send, and
// returns `null` for anything it can't reproduce faithfully — so a caller never
// shows a list that DIFFERS from what the server would return (a wrong offline
// list is worse than none). See `readNotesList`'s param guard (query SHAPE) and
// its completeness gate (query TIME — never answer from a mid-hydration mirror).

import type { LensDB } from "@/lib/sync/db";
import { resolveNoteId } from "@/lib/sync/id-map";
import type { Note } from "@/lib/vault/types";
import { getMirrorLastSyncedAt, getMirrorNote, listMirrorNotes } from "./store";

// Read a single note for the VIEW — always the FULL mirror row (content, links,
// attachments), never a lean list stub. `resolveNoteId` maps a synced local id
// to its server id (returns the id unchanged when it's already a server id, or
// `null` when a local id has no mapping yet). We fall back to the id as-given so
// an offline-created note's optimistic local-id row (written by the create path
// before its drain lands) still opens. Returns `undefined` when the note isn't
// mirrored.
export async function readNote(db: LensDB, vaultId: string, id: string): Promise<Note | undefined> {
  const resolved = await resolveNoteId(db, id, vaultId);
  return getMirrorNote(db, vaultId, resolved ?? id);
}

// The params this evaluator reproduces faithfully (or safely ignores — see
// `include_content`, which only shapes the RESPONSE, and the mirror always
// holds full bodies). `search` is handled explicitly (→ null: FTS can't be
// reproduced client-side). Any param outside this set means a query shape we
// can't guarantee fidelity for (expand / exclude_tag / meta[…] / near /
// order_by / a future param) — so `readNotesList` returns null and the caller
// stays network-only rather than risk a divergent list.
const FAITHFUL_PARAMS = new Set([
  "tag",
  "tag_match",
  "path_prefix",
  "has_tags",
  "has_links",
  "sort",
  "limit",
  "offset",
  "include_content",
]);

// Vault's default page size when `limit` is absent/non-numeric
// (parachute-vault core `notes.ts`). The app's list hooks always send an
// explicit limit, so this is only a backstop.
const DEFAULT_LIMIT = 100;

// Serve a list query from the mirror. Returns `null` when the query uses a
// feature outside the faithful subset (notably `search`) — the caller then
// keeps its network-only behavior instead of showing a list that would differ
// from the server's. Returns a Note[] (full mirror rows — a superset of the
// lean list shape the hooks render; `NoteRow` derives its title from content
// and reads tags/preview the same way) otherwise.
//
// Fidelity notes (pinned by read.test.ts against vault's `notes.ts` query
// path): the app's list hooks send NO `expand`, so the vault applies its
// default `subtypes` tag expansion — which, for a FLAT vault (no tag declares
// `parent_names`), is identical to the exact-match filtering here. A vault with
// a declared tag hierarchy would see the mirror omit child-tagged notes under a
// parent-tag filter; that gap is documented and acceptable while tags-as-types
// is nascent and the app never requests expansion.
export async function readNotesList(
  db: LensDB,
  vaultId: string,
  params: URLSearchParams,
): Promise<Note[] | null> {
  // COMPLETENESS GATE (the "a partial list is worse than none" invariant, in the
  // TIME dimension — the param guard below covers the SHAPE dimension). The mirror
  // hydrates via an `updated_at`-ordered cursor, but this evaluator sorts by
  // `created_at` (the vault's non-cursor list default). MID-hydration the mirror
  // therefore holds an arbitrary, shifting SUBSET (old-created-but-recently-updated
  // notes surface first; the set changes as the cursor advances), so answering a
  // list here would present a PARTIAL vault as if it were complete. Serve ONLY once
  // the initial cold hydration has drained the cursor to exhaustion at least once —
  // signalled by a persisted `lastSyncedAt`. That watermark is written only AFTER
  // `drainCursor`'s walk completes (engine.ts), is DURABLE (it survives app
  // restarts and the transient "hydrating" phase a warm re-poll passes through on
  // every tick, so a complete mirror never briefly refuses reads), and is cleared
  // only by "Clear offline copy" (`clearMirrorMeta`) — which correctly re-arms the
  // gate so the re-fill runs cold. Before it lands, behave as if the mirror has no
  // LIST (return null → the caller stays network-only; the HydrationLine progress
  // is the user's cue). Single-note reads (`readNote`) are intentionally NOT gated:
  // an already-mirrored note opens correctly mid-hydration, and a not-yet-mirrored
  // one already falls through to the network.
  if ((await getMirrorLastSyncedAt(db, vaultId)) == null) return null;

  for (const key of params.keys()) {
    // `search` is a real query the app sends but FTS isn't reproducible
    // offline; every other non-faithful param is a shape we don't model.
    if (key === "search" || !FAITHFUL_PARAMS.has(key)) return null;
  }

  let rows = (await listMirrorNotes(db, vaultId)) as Note[];

  // Tag filter — comma-joined into one param (vault's `parseQueryList` grammar);
  // `tag_match` is any (OR, vault's default for >1 tag) or all (AND). Exact
  // match per the fidelity note above.
  const tagParam = params.get("tag");
  if (tagParam) {
    const wanted = tagParam
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (wanted.length > 0) {
      const all = params.get("tag_match") === "all";
      rows = rows.filter((n) => {
        const tags = n.tags ?? [];
        return all ? wanted.every((w) => tags.includes(w)) : wanted.some((w) => tags.includes(w));
      });
    }
  }

  const prefix = params.get("path_prefix");
  if (prefix) rows = rows.filter((n) => (n.path ?? "").startsWith(prefix));

  const hasTags = params.get("has_tags");
  if (hasTags === "true") rows = rows.filter((n) => (n.tags?.length ?? 0) > 0);
  else if (hasTags === "false") rows = rows.filter((n) => (n.tags?.length ?? 0) === 0);

  const hasLinks = params.get("has_links");
  if (hasLinks === "true") rows = rows.filter((n) => (n.links?.length ?? 0) > 0);
  else if (hasLinks === "false") rows = rows.filter((n) => (n.links?.length ?? 0) === 0);

  // Sort — vault's non-cursor default orders by `n.created_at <dir>, n.id <dir>`
  // (the TEXT column, BINARY collation), NOT updated_at. `sort` absent or "asc"
  // → ASC; "desc" → DESC. The app's list hooks all send sort=desc. String
  // comparison matches SQLite's BINARY collation for canonical ISO timestamps
  // and ids; `id` is the same-timestamp tiebreaker the server uses.
  const desc = params.get("sort") === "desc";
  rows = [...rows].sort((a, b) => {
    const ca = a.createdAt ?? "";
    const cb = b.createdAt ?? "";
    if (ca !== cb) return (ca < cb ? -1 : 1) * (desc ? -1 : 1);
    if (a.id === b.id) return 0;
    return (a.id < b.id ? -1 : 1) * (desc ? -1 : 1);
  });

  const offset = toNonNegInt(params.get("offset"), 0);
  const limit = toNonNegInt(params.get("limit"), DEFAULT_LIMIT);
  return rows.slice(offset, offset + limit);
}

function toNonNegInt(value: string | null, fallback: number): number {
  if (value == null) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
