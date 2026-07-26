import { DEFAULT_PAGE_SIZE } from "@/lib/vault/note-query";
import type { TagRoles } from "@/lib/vault/tag-roles";
import type { TagRecord } from "@/lib/vault/types";
import type { ViewDef } from "./schema";

// The DERIVED tag view (tag-page wave) — the ViewDef a `/tags/:name` page
// renders. Tagging something should HAVE a consequence, and that consequence
// shouldn't require separately authoring a view: clicking a tag opens a page
// derived from the tag's OWN schema, on the fly. Nothing is stored — the def
// is computed each visit from the live tag record, so unlike a saved `#view`
// note it can never dangle or drift.
//
// `noteId` is a synthetic marker (`derived:tag:<name>`) — the same convention
// `builtInDefaultViewDef` uses for the Pinned/Archive built-ins in
// `defaults.ts`. There is NO backing note, so nothing may ever fetch or PATCH
// it: `useViewResults` only ever reads it as a cache-key discriminant, and the
// tag page passes `backingNote={null}` to `ViewCanvas`, which gates the
// note-editor link and the whole Save path off a real note (`ViewSurface.tsx`).

/**
 * Derive the ViewDef for a tag's page from the tag's own record.
 *
 * - `kind`: `"table"` when the tag declares ≥1 schema field (a typed tag opens
 *   as a database — its schema fields become columns for free, since
 *   `resolveViewFields` returns a single-tag query's schema fields in order),
 *   `"list"` when it declares none (a plain tag opens as the familiar list).
 * - `query`: `{ tag, exclude_tags: [archived], sort: "desc", limit }` — EXCEPT
 *   the archived tag's own page, which must not exclude itself. The pinned role
 *   needs no such guard: it's never added to `exclude_tags` here, and
 *   `partitionPinned` already renders the pinned tag's own page as a flat list
 *   (its self-guard).
 * - `sort: "desc"` + `limit: DEFAULT_PAGE_SIZE` are the SCALE FLOOR. A tag on
 *   hundreds of notes (a capture stream, a journal) must not open as one
 *   thousands-of-pixels-tall page: the def pins newest-first ordering and the
 *   same 50-row page the Notes list uses (`note-query.ts`), rather than
 *   inheriting the vault's default (which is oldest-first and, for the REST
 *   poll, capped at 50 anyway — so an unpinned def silently showed the OLDEST
 *   50). `ViewCanvas` reads this `limit` as its page size and pages by `offset`
 *   (poll-only — see there for why the live layer can't ride a limit).
 * - everything else (`groupBy`/`dateField`/`fields`) is left unset: `withLens`
 *   (`config.ts`) picks the first enum for Board / first date for Calendar when
 *   the viewer switches lens, so duplicating that choice here would only drift.
 *
 * `tag` is the tag-identity record from `useTag` — `null`/`undefined` when the
 * tag has no schema row (a plain tag, or one that doesn't exist), which reads
 * as zero fields → a list.
 */
export function deriveTagViewDef(
  tagName: string,
  tag: TagRecord | null | undefined,
  roles: TagRoles,
): ViewDef {
  const fieldCount = tag?.fields ? Object.keys(tag.fields).length : 0;
  const query: Record<string, unknown> = { tag: tagName };
  // A page must not exclude the very tag it's showing — the archived tag's
  // own page keeps its archived notes.
  if (tagName !== roles.archived) {
    query.exclude_tags = [roles.archived];
  }
  // The scale floor: newest-first, one page at a time (never the whole tag).
  query.sort = "desc";
  query.limit = DEFAULT_PAGE_SIZE;
  return {
    noteId: `derived:tag:${tagName}`,
    title: tagName,
    kind: fieldCount >= 1 ? "table" : "list",
    query,
    problems: [],
  };
}
