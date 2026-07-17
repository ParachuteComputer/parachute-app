import { pathLeaf } from "@/lib/note-title";
import {
  SAVED_VIEW_KIND,
  type SavedViewFilters,
  decodeView as decodeLegacySavedView,
} from "@/lib/saved-views/spec";
import type { Note } from "@/lib/vault/types";

// The canonical view module (VIEWS-RENDER-SPEC §1) — the ONE decoder every
// renderer, the Rail band, and the legacy saved-views bridge consume. A view
// is a note tagged `#view` whose metadata IS the definition; the note body
// is prose for people. Ground truth: vault `core/src/seed-packs.ts` (#605).

export const VIEW_KINDS = ["list", "board", "calendar", "gallery"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

function isViewKind(x: unknown): x is ViewKind {
  return typeof x === "string" && (VIEW_KINDS as readonly string[]).includes(x);
}

export interface ViewProblem {
  code: "invalid_query_json" | "unsupported_query_key";
  /** Plain-language, ready to render in the problems banner (§3). */
  message: string;
}

export interface ViewDef {
  noteId: string;
  path?: string;
  /** From the note's path basename — same resolution as legacy `decodeView`. */
  title: string;
  kind: ViewKind;
  /**
   * The parsed, unvalidated MCP-grammar query object. `null` only when the
   * note's `query` metadata failed to parse — §3's "run nothing" posture,
   * not an empty-object "everything" query (which would lie about what a
   * malformed view means).
   */
  query: Record<string, unknown> | null;
  laneBy?: string;
  dateField?: string;
  problems: ViewProblem[];
  /** True for a note decoded through the legacy `{kind:"saved-view"}` adapter (§8). */
  legacy?: boolean;
}

const UNPARSEABLE_QUERY_PROBLEM: ViewProblem = {
  code: "invalid_query_json",
  message:
    "This view's query didn't parse — nothing is being filtered out or shown. Open the note to fix it.",
};

function titleFor(note: Note, fallback?: string): string {
  if (fallback) return fallback;
  return note.path ? pathLeaf(note.path) : note.id;
}

/**
 * Convert a decoded legacy `SavedViewFilters` into the same MCP-grammar
 * query-object shape `decodeViewDef` produces for a canonical `#view` note,
 * so both vintages render through one pipeline (§8's adapter).
 *
 * `archivedTag` threads the vault's role-tag indirection (§0: "the pack
 * writes literal tag names; the app queries through roles") into the ONE
 * place a legacy note's stored `showArchived: false` preference needs a
 * concrete tag name to become `exclude_tags`. Defaults to the bare
 * `"archived"` role default when the caller doesn't have the resolved role
 * on hand (e.g. a decode call with no vault-settings context).
 */
function legacyFiltersToQuery(
  filters: SavedViewFilters,
  archivedTag: string,
): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  if (filters.search?.trim()) query.search = filters.search.trim();
  if (filters.tags && filters.tags.length > 0) query.tag = [...filters.tags];
  if (filters.tags && filters.tags.length > 1 && filters.tagMatch) {
    query.tag_match = filters.tagMatch;
  }
  if (filters.pathPrefix?.trim()) query.path_prefix = filters.pathPrefix.trim();
  if (filters.sort) query.sort = filters.sort;
  // An explicit, already-saved user preference being translated — not a
  // surface-invented default (VIEWS-RENDER-SPEC §5's "never a surface-side
  // default" rule governs NEW writes; this is honoring an existing one).
  if (!filters.showArchived) query.exclude_tags = [archivedTag];
  return query;
}

export interface DecodeViewDefOptions {
  /** The vault's resolved `archived` role tag — see `legacyFiltersToQuery`. */
  archivedTag?: string;
}

/**
 * Decode a `#view`-tagged (or legacy saved-view) note into a `ViewDef`.
 * Never throws, never returns null — a view is never wrong to render as a
 * list (§1: unknown/absent `kind` degrades silently, no problem recorded).
 */
export function decodeViewDef(note: Note, opts: DecodeViewDefOptions = {}): ViewDef {
  const meta = (note.metadata ?? {}) as Record<string, unknown>;

  // Legacy adapter (§8): `{kind:"saved-view", filters}` at `UI/Views/<name>`.
  if (meta.kind === SAVED_VIEW_KIND) {
    const legacy = decodeLegacySavedView(note);
    const archivedTag = opts.archivedTag ?? "archived";
    return {
      noteId: note.id,
      path: note.path,
      title: titleFor(note, legacy?.name),
      kind: "list",
      query: legacy ? legacyFiltersToQuery(legacy.filters, archivedTag) : {},
      problems: [],
      legacy: true,
    };
  }

  const kind: ViewKind = isViewKind(meta.kind) ? meta.kind : "list";
  const problems: ViewProblem[] = [];
  let query: Record<string, unknown> | null = {};

  if (typeof meta.query === "string" && meta.query.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(meta.query);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        query = parsed as Record<string, unknown>;
      } else {
        query = null;
        problems.push(UNPARSEABLE_QUERY_PROBLEM);
      }
    } catch {
      query = null;
      problems.push(UNPARSEABLE_QUERY_PROBLEM);
    }
  } else if (meta.query !== undefined && meta.query !== null && typeof meta.query !== "string") {
    // The wire format says `query` is a JSON STRING (§0/§1) — a note whose
    // metadata carries a raw object/array/number there is also malformed,
    // just via a different mistake (e.g. a client that skipped the
    // JSON.stringify step) than a syntax error inside the string.
    query = null;
    problems.push(UNPARSEABLE_QUERY_PROBLEM);
  }

  return {
    noteId: note.id,
    path: note.path,
    title: titleFor(note),
    kind,
    query,
    laneBy: typeof meta.lane_by === "string" ? meta.lane_by : undefined,
    dateField: typeof meta.date_field === "string" ? meta.date_field : undefined,
    problems,
  };
}

/** True when the note is decodable as a view at all (canonical or legacy). */
export function isViewNote(note: Note, viewTag: string): boolean {
  if ((note.tags ?? []).includes(viewTag)) return true;
  const meta = note.metadata as { kind?: unknown } | undefined;
  return meta?.kind === SAVED_VIEW_KIND;
}
