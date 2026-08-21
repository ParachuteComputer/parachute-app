// The All-notes surface's temporary filter state. These filters live in the
// URL while someone explores the list; when saved, they become the canonical
// query object inside a `#view` note.
export interface AllNotesFilters {
  search?: string;
  tags?: string[];
  tagMatch?: "any" | "all";
  pathPrefix?: string;
  sort?: "asc" | "desc";
  showArchived?: boolean;
}

export function filtersToSearchParams(filters: AllNotesFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  for (const t of filters.tags ?? []) params.append("tag", t);
  if (filters.tagMatch) params.set("tag_match", filters.tagMatch);
  if (filters.pathPrefix?.trim()) params.set("path_prefix", filters.pathPrefix.trim());
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.showArchived) params.set("show_archived", "1");
  return params;
}

export function searchParamsToFilters(params: URLSearchParams): AllNotesFilters {
  const tags = params.getAll("tag");
  const tagMatch = params.get("tag_match");
  const sort = params.get("sort");
  return {
    search: params.get("search") ?? undefined,
    tags: tags.length > 0 ? tags : undefined,
    tagMatch: tagMatch === "all" ? "all" : tagMatch === "any" ? "any" : undefined,
    pathPrefix: params.get("path_prefix") ?? undefined,
    sort: sort === "asc" ? "asc" : sort === "desc" ? "desc" : undefined,
    showArchived: params.get("show_archived") === "1",
  };
}

export function isFiltersNonEmpty(filters: AllNotesFilters): boolean {
  if (filters.search?.trim()) return true;
  if (filters.tags && filters.tags.length > 0) return true;
  if (filters.pathPrefix?.trim()) return true;
  return false;
}

/** Convert the All-notes UI state to the MCP-grammar query stored by `#view`. */
export function filtersToViewQuery(
  filters: AllNotesFilters,
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
  // All notes hides archived notes by default with a client-side post-filter.
  // A saved view runs directly against the vault, so make that default
  // explicit or opening the view would silently broaden its result set.
  if (!filters.showArchived) query.exclude_tags = [archivedTag];
  return query;
}
