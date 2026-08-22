import type { TagRoles } from "@/lib/vault/tag-roles";
import type { Note } from "@/lib/vault/types";
import { type ViewDef, decodeViewDef, isViewNote } from "./schema";

// Mirrors vault `core/src/seed-packs.ts:884-887` — the four default-page view
// paths the opt-in `starter-ontology` pack seeds (VIEWS-RENDER-SPEC §0/§6).
// The vault doesn't publish these as an importable package this app depends
// on, so they're mirrored as literals with this lockstep comment (the same
// pattern §7 prescribes for `useDefaultViewDef`): if vault renames a seed
// path, this list drifts until someone notices — acceptable for wave 1,
// where the only consumer is the Rail band's dedup (excluding a shipped
// default from also showing up as a plain view row), not the wave-2
// default-page cutover itself.
export const ALL_NOTES_VIEW_PATH = "Views/All notes";
export const RECENT_VIEW_PATH = "Views/Recent";
export const PINNED_VIEW_PATH = "Views/Pinned";
export const ARCHIVE_VIEW_PATH = "Views/Archive";

export const DEFAULT_VIEW_PATHS: readonly string[] = [
  ALL_NOTES_VIEW_PATH,
  RECENT_VIEW_PATH,
  PINNED_VIEW_PATH,
  ARCHIVE_VIEW_PATH,
];

// The canonical path prefix new views are created under (VIEWS-RENDER-SPEC
// §6 creation flow). The old `UI/Views/` saved-filter writer was retired;
// every human creation path now writes this shape.
export const VIEWS_PATH_PREFIX = "Views/";

export function viewPathForName(name: string): string {
  const safe = name.trim().replace(/[/\\]/g, "-");
  return `${VIEWS_PATH_PREFIX}${safe || "Untitled view"}`;
}

/**
 * Whether a human view name resolves to an occupied canonical path. Compare
 * AFTER `viewPathForName` sanitizes it so `a/b` cannot slip past an existing
 * `a-b`. `currentPath` is excluded for rename flows; unchanged names are
 * rejected separately by the dialog.
 */
export function viewNameCollides(
  name: string,
  existingPaths: readonly string[],
  currentPath?: string,
): boolean {
  const candidate = viewPathForName(name).toLowerCase();
  const current = currentPath?.toLowerCase();
  return [...DEFAULT_VIEW_PATHS, ...existingPaths].some((path) => {
    const normalized = path.toLowerCase();
    return normalized === candidate && normalized !== current;
  });
}

// ---------------------------------------------------------------------------
// Default-page cutover (VIEWS-RENDER-SPEC §7, wave 2a) — the built-in
// fallback ViewDefs for the Pinned + Archive default pages, and the pure
// resolver that picks between a pack note and the built-in. Kept here (not
// in queries.ts) because it's plain data — no React, no client — so the
// resolution logic is unit-testable without mocking a query hook.
// ---------------------------------------------------------------------------

export type DefaultPageId = "pinned" | "archived";

const DEFAULT_PAGE_PATHS: Record<DefaultPageId, string> = {
  pinned: PINNED_VIEW_PATH,
  archived: ARCHIVE_VIEW_PATH,
};

const DEFAULT_PAGE_TITLES: Record<DefaultPageId, string> = {
  pinned: "Pinned",
  archived: "Archive",
};

/** The pack's canonical path for a default page — where its override note would live. */
export function defaultPagePath(pageId: DefaultPageId): string {
  return DEFAULT_PAGE_PATHS[pageId];
}

/**
 * The app's built-in ViewDef for a default page — mirrors the pack's own
 * query (`core/src/seed-packs.ts` `PINNED_VIEW_PATH`/`ARCHIVE_VIEW_PATH`:
 * `{tag: "pinned"}` / `{tag: "archived"}`) byte-for-intent, but through the
 * app's tag ROLE rather than the pack's literal tag name — a vault that
 * renamed its pinned/archived tag still gets a correct built-in default.
 * `noteId` is a synthetic marker: there is no backing note, so nothing ever
 * fetches or writes to it.
 */
export function builtInDefaultViewDef(pageId: DefaultPageId, roles: TagRoles): ViewDef {
  const tag = pageId === "pinned" ? roles.pinned : roles.archived;
  return {
    noteId: `builtin:${pageId}`,
    title: DEFAULT_PAGE_TITLES[pageId],
    kind: "list",
    query: { tag },
    problems: [],
  };
}

/**
 * Resolve a default page's ViewDef: the pack note at its canonical path
 * wins when it's present, tagged `#view`, and its query parses
 * (authoring-time-explicit — the note says what it means). Anything else —
 * no note at that path, a note there that isn't a view, or a malformed
 * query — falls back to the built-in def. A default page is load-bearing
 * navigation, not a place to show "this view is broken" over someone else's
 * corrupted note; that honesty belongs to `/views/:id`, which the person
 * chose to open.
 */
export function resolveDefaultViewDef(
  pageId: DefaultPageId,
  packNote: Note | null | undefined,
  roles: TagRoles,
): { def: ViewDef; isPackNote: boolean } {
  if (packNote && isViewNote(packNote, roles.view)) {
    const decoded = decodeViewDef(packNote);
    if (decoded.query !== null) return { def: decoded, isPackNote: true };
  }
  return { def: builtInDefaultViewDef(pageId, roles), isPackNote: false };
}
