import { describe, expect, it } from "vitest";
import {
  filtersToSearchParams,
  filtersToViewQuery,
  isFiltersNonEmpty,
  searchParamsToFilters,
} from "./all-notes";

describe("All-notes view filters", () => {
  it("round-trips the shareable URL state", () => {
    const filters = {
      search: "daily",
      tags: ["journal", "idea"],
      tagMatch: "all" as const,
      pathPrefix: "Work/",
      sort: "asc" as const,
      showArchived: true,
    };
    expect(searchParamsToFilters(filtersToSearchParams(filters))).toEqual(filters);
  });

  it("maps the current filters to the canonical #view query grammar", () => {
    expect(
      filtersToViewQuery(
        {
          search: "  daily  ",
          tags: ["journal", "idea"],
          tagMatch: "all",
          pathPrefix: "  Work/  ",
          sort: "asc",
          showArchived: false,
        },
        "archived",
      ),
    ).toEqual({
      search: "daily",
      tag: ["journal", "idea"],
      tag_match: "all",
      path_prefix: "Work/",
      sort: "asc",
      exclude_tags: ["archived"],
    });
  });

  it("does not exclude archived notes when All notes was showing them", () => {
    expect(filtersToViewQuery({ tags: ["journal"], showArchived: true }, "archived")).toEqual({
      tag: ["journal"],
    });
  });

  it("gates saving on a meaningful filter, not sort or archive display", () => {
    expect(isFiltersNonEmpty({ sort: "asc", showArchived: true })).toBe(false);
    expect(isFiltersNonEmpty({ search: " daily " })).toBe(true);
  });
});
