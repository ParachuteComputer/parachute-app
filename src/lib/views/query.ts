import type { MetadataFilter, NotesQuery } from "@openparachute/surface-client";
import { buildNotesQuery } from "@openparachute/surface-client";
import type { ViewProblem } from "./schema";

// The query mapper (VIEWS-RENDER-SPEC §1) — the view note's parsed
// MCP-grammar query object → surface-client's typed `NotesQuery` (+ the raw
// `search` param the typed shape deliberately excludes). Unrecognized keys
// are DROPPED, each recorded as a problem — silent passthrough would turn an
// authoring typo into a server 400 with no story (§1).

// The supported-key list lives in the `switch` below, not as a separate
// passthrough set — one place to update, and the compiler catches a typo'd
// case label as dead code rather than silently widening what's accepted.
function asTagValue(value: unknown): string | string[] | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value as string[];
  }
  return undefined;
}

export interface MappedViewQuery {
  params: URLSearchParams;
  problems: ViewProblem[];
}

/** Map a view's parsed query object to the exact wire params `queryNotes` sends. */
export function viewQueryToNotesQuery(query: Record<string, unknown>): MappedViewQuery {
  const problems: ViewProblem[] = [];
  const typed: NotesQuery = {};
  let search: string | undefined;

  for (const [key, value] of Object.entries(query)) {
    switch (key) {
      case "tag":
        typed.tag = asTagValue(value);
        break;
      case "exclude_tags":
        typed.excludeTag = asTagValue(value);
        break;
      case "tag_match":
        if (value === "all" || value === "any") typed.tagMatch = value;
        break;
      case "metadata":
        if (value && typeof value === "object" && !Array.isArray(value)) {
          typed.metadata = value as Record<string, MetadataFilter>;
        }
        break;
      case "order_by":
        if (typeof value === "string") typed.orderBy = value;
        break;
      case "sort":
        if (value === "asc" || value === "desc") typed.sort = value;
        break;
      case "path_prefix":
        if (typeof value === "string") typed.pathPrefix = value;
        break;
      case "limit":
        if (typeof value === "number") typed.limit = value;
        break;
      case "offset":
        if (typeof value === "number") typed.offset = value;
        break;
      case "search":
        if (typeof value === "string") search = value;
        break;
      default:
        problems.push({
          code: "unsupported_query_key",
          message: `This view uses "${key}", which this app can't run yet; results may be broader than intended.`,
        });
    }
  }

  const params = buildNotesQuery(typed);
  if (search) params.set("search", search);
  return { params, problems };
}

// --- Refinements (§5) -------------------------------------------------

export interface ViewRefinements {
  /** Tag-include chips — additive to the base `tag` list, `tag_match: "all"`. */
  addTags: string[];
  /**
   * Tag-exclude-TOGGLE: base `exclude_tags` entries the person turned off
   * for this session (e.g. "peek at archived" — §5's checkbox-subsuming
   * example). NOT additional excludes; it only ever REMOVES entries the
   * base already carried.
   */
  removeExcludes: string[];
  search?: string;
  sort?: "asc" | "desc";
}

export const EMPTY_REFINEMENTS: ViewRefinements = { addTags: [], removeExcludes: [] };

export function hasRefinements(r: ViewRefinements): boolean {
  return r.addTags.length > 0 || r.removeExcludes.length > 0 || !!r.search || !!r.sort;
}

// Refinements live in the URL (§5: "shareable, reload-surviving, gone when
// you leave") — the same pattern legacy saved-views already used
// (`filtersToSearchParams`/`searchParamsToFilters`, saved-views/spec.ts).

export function refinementsToSearchParams(r: ViewRefinements): URLSearchParams {
  const params = new URLSearchParams();
  for (const t of r.addTags) params.append("tag", t);
  for (const t of r.removeExcludes) params.append("noExclude", t);
  if (r.search?.trim()) params.set("search", r.search.trim());
  if (r.sort) params.set("sort", r.sort);
  return params;
}

export function searchParamsToRefinements(params: URLSearchParams): ViewRefinements {
  return {
    addTags: params.getAll("tag"),
    removeExcludes: params.getAll("noExclude"),
    search: params.get("search") ?? undefined,
    sort: params.get("sort") === "asc" ? "asc" : params.get("sort") === "desc" ? "desc" : undefined,
  };
}

function tagListOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

/**
 * Compose a view's base query with the session's refinements (§5's shallow
 * key-level merge — refinement wins per key — except `tag`, additive, and
 * `exclude_tags`, which only ever shrinks via `removeExcludes`). `null` base
 * (unparseable query, §3) stays `null` — refinements never resurrect a
 * malformed view into running an implicit `{}` query.
 */
export function composeViewQuery(
  base: Record<string, unknown> | null,
  refinements: ViewRefinements,
): Record<string, unknown> | null {
  if (base === null) return null;
  const merged: Record<string, unknown> = { ...base };

  if (refinements.addTags.length > 0) {
    merged.tag = [...tagListOf(base.tag), ...refinements.addTags];
    merged.tag_match = "all";
  }
  if (refinements.removeExcludes.length > 0) {
    const remaining = tagListOf(base.exclude_tags).filter(
      (t) => !refinements.removeExcludes.includes(t),
    );
    merged.exclude_tags = remaining;
  }
  if (refinements.search) merged.search = refinements.search;
  if (refinements.sort) merged.sort = refinements.sort;
  return merged;
}

/** The query's `tag` filter, normalized to a list — `[]` for a null/tagless query. */
export function queryTags(query: Record<string, unknown> | null): string[] {
  if (!query) return [];
  return tagListOf(query.tag);
}

/**
 * The view's hue subject (§9): the query's primary `tag` — the first
 * element when it's a list, the whole string when it's scalar. `undefined`
 * (no tag in the query) renders neutral, never a default hue.
 */
export function primaryQueryTag(query: Record<string, unknown> | null): string | undefined {
  const tags = queryTags(query);
  return tags[0];
}

// --- Base-chip description (§5's readable-query row) -------------------

export type BaseChipKind = "tag" | "exclude" | "search" | "sort" | "pathPrefix";

export interface BaseChip {
  kind: BaseChipKind;
  /** The tag name for `tag`/`exclude` chips — the toggle key for `removeExcludes`. */
  value?: string;
  label: string;
}

/** Render a view's base query as readable chips — "#project", "not #archived", "sorted by updated". */
export function describeBaseQuery(query: Record<string, unknown> | null): BaseChip[] {
  if (!query) return [];
  const chips: BaseChip[] = [];
  for (const tag of tagListOf(query.tag)) {
    chips.push({ kind: "tag", value: tag, label: `#${tag}` });
  }
  for (const tag of tagListOf(query.exclude_tags)) {
    chips.push({ kind: "exclude", value: tag, label: `not #${tag}` });
  }
  if (typeof query.search === "string" && query.search) {
    chips.push({ kind: "search", label: `"${query.search}"` });
  }
  if (query.sort === "asc" || query.sort === "desc") {
    chips.push({
      kind: "sort",
      value: query.sort,
      label: `sorted by ${query.sort === "desc" ? "newest" : "oldest"}`,
    });
  }
  if (typeof query.path_prefix === "string" && query.path_prefix) {
    chips.push({ kind: "pathPrefix", value: query.path_prefix, label: `in ${query.path_prefix}` });
  }
  return chips;
}
