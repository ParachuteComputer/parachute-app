import { describe, expect, it } from "vitest";
import {
  type ViewRefinements,
  composeViewQuery,
  describeBaseQuery,
  primaryQueryTag,
  queryTags,
  refinementsToSearchParams,
  searchParamsToRefinements,
  viewQueryToNotesQuery,
} from "./query";

describe("viewQueryToNotesQuery", () => {
  it("maps every supported key to its wire param", () => {
    const { params, problems } = viewQueryToNotesQuery({
      tag: "project",
      exclude_tags: "archived",
      order_by: "priority",
      sort: "desc",
      path_prefix: "Work/",
      limit: 25,
      offset: 10,
      search: "q1 goals",
    });
    expect(params.get("tag")).toBe("project");
    expect(params.get("exclude_tag")).toBe("archived");
    expect(params.get("order_by")).toBe("priority");
    expect(params.get("sort")).toBe("desc");
    expect(params.get("path_prefix")).toBe("Work/");
    expect(params.get("limit")).toBe("25");
    expect(params.get("offset")).toBe("10");
    expect(params.get("search")).toBe("q1 goals");
    expect(problems).toEqual([]);
  });

  it("comma-joins a multi-tag array and sets tag_match when tag_match is given", () => {
    const { params } = viewQueryToNotesQuery({ tag: ["a", "b"], tag_match: "all" });
    expect(params.get("tag")).toBe("a,b");
    expect(params.get("tag_match")).toBe("all");
  });

  it("drops unrecognized keys and records a problem naming each one", () => {
    const { params, problems } = viewQueryToNotesQuery({ tag: "x", near: { id: "y" }, depth: 2 });
    expect(params.get("tag")).toBe("x");
    expect(params.has("near")).toBe(false);
    expect(params.has("depth")).toBe(false);
    expect(problems).toHaveLength(2);
    expect(problems.map((p) => p.code)).toEqual(["unsupported_query_key", "unsupported_query_key"]);
    expect(problems[0].message).toMatch(/"near"/);
    expect(problems[1].message).toMatch(/"depth"/);
  });

  it("ignores a malformed value for a known key rather than throwing", () => {
    expect(() => viewQueryToNotesQuery({ sort: "sideways" })).not.toThrow();
    const { params } = viewQueryToNotesQuery({ sort: "sideways" });
    expect(params.has("sort")).toBe(false);
  });

  // Regression (reviewer-caught white-screen, PR #47): surface-client's
  // `buildNotesQuery` validates a `metadata` clause by THROWING TypeError,
  // not by returning a problem — an agent-written view note is exactly the
  // kind of note likely to carry one. With no app-wide ErrorBoundary, an
  // uncaught throw here (inside `useViewResults`'s `useMemo`) white-screens
  // the whole app instead of degrading per §3.
  it("an unknown metadata operator never throws — drops metadata, records a problem, runs the rest", () => {
    expect(() =>
      viewQueryToNotesQuery({ tag: "project", metadata: { field: { badOp: "x" } } }),
    ).not.toThrow();
    const { params, problems } = viewQueryToNotesQuery({
      tag: "project",
      metadata: { field: { badOp: "x" } },
    });
    expect(params.get("tag")).toBe("project"); // the non-metadata part still ran
    expect([...params.keys()].some((k) => k.startsWith("meta["))).toBe(false);
    expect(problems).toHaveLength(1);
    expect(problems[0].code).toBe("unsupported_query_key");
    expect(problems[0].message).toMatch(/badOp/);
    expect(problems[0].message).toMatch(/field/);
  });

  it("in/not_in with a non-array value never throws — drops metadata, records a problem, runs the rest", () => {
    expect(() =>
      viewQueryToNotesQuery({
        tag: "project",
        sort: "desc",
        metadata: { field: { in: "not-an-array" } },
      }),
    ).not.toThrow();
    const { params, problems } = viewQueryToNotesQuery({
      tag: "project",
      sort: "desc",
      metadata: { field: { in: "not-an-array" } },
    });
    expect(params.get("tag")).toBe("project");
    expect(params.get("sort")).toBe("desc"); // the rest of the query still runs
    expect([...params.keys()].some((k) => k.startsWith("meta["))).toBe(false);
    expect(problems).toHaveLength(1);
    expect(problems[0].code).toBe("unsupported_query_key");
    expect(problems[0].message).toMatch(/field/);
  });
});

describe("composeViewQuery", () => {
  const base = { tag: "project", exclude_tags: ["archived"] };

  it("returns null unchanged for a malformed base — refinements never resurrect it", () => {
    expect(composeViewQuery(null, { addTags: ["urgent"], removeExcludes: [] })).toBeNull();
  });

  it("is additive for tag, and sets tag_match: all", () => {
    const merged = composeViewQuery(base, { addTags: ["urgent"], removeExcludes: [] });
    expect(merged?.tag).toEqual(["project", "urgent"]);
    expect(merged?.tag_match).toBe("all");
  });

  it("removeExcludes only shrinks the base exclude list, never adds", () => {
    const merged = composeViewQuery(base, { addTags: [], removeExcludes: ["archived"] });
    expect(merged?.exclude_tags).toEqual([]);
  });

  it("removeExcludes for a tag not in the base is a no-op on that list", () => {
    const merged = composeViewQuery(base, { addTags: [], removeExcludes: ["someone-else"] });
    expect(merged?.exclude_tags).toEqual(["archived"]);
  });

  it("search/sort refinements win per-key over the base", () => {
    const merged = composeViewQuery(
      { ...base, sort: "asc" },
      { addTags: [], removeExcludes: [], search: "q", sort: "desc" },
    );
    expect(merged?.search).toBe("q");
    expect(merged?.sort).toBe("desc");
  });

  it("an empty refinements object returns an equivalent (not necessarily identical) base", () => {
    const empty: ViewRefinements = { addTags: [], removeExcludes: [] };
    expect(composeViewQuery(base, empty)).toEqual(base);
  });
});

describe("primaryQueryTag", () => {
  it("returns the scalar tag", () => {
    expect(primaryQueryTag({ tag: "project" })).toBe("project");
  });
  it("returns the first of an array tag", () => {
    expect(primaryQueryTag({ tag: ["project", "urgent"] })).toBe("project");
  });
  it("returns undefined with no tag in the query", () => {
    expect(primaryQueryTag({})).toBeUndefined();
    expect(primaryQueryTag(null)).toBeUndefined();
  });
});

describe("queryTags", () => {
  it("normalizes scalar and array tag values", () => {
    expect(queryTags({ tag: "project" })).toEqual(["project"]);
    expect(queryTags({ tag: ["a", "b"] })).toEqual(["a", "b"]);
  });
  it("returns [] for a null/tagless query", () => {
    expect(queryTags(null)).toEqual([]);
    expect(queryTags({})).toEqual([]);
  });
});

describe("refinements URL round-trip", () => {
  it("round-trips every dimension through the URL", () => {
    const r: ViewRefinements = {
      addTags: ["urgent", "q1"],
      removeExcludes: ["archived"],
      search: "coffee",
      sort: "asc",
    };
    const params = refinementsToSearchParams(r);
    expect(searchParamsToRefinements(params)).toEqual(r);
  });

  it("an empty URL round-trips to the empty refinements shape", () => {
    expect(searchParamsToRefinements(new URLSearchParams())).toEqual({
      addTags: [],
      removeExcludes: [],
      search: undefined,
      sort: undefined,
    });
  });
});

describe("describeBaseQuery", () => {
  it("renders one chip per tag/exclude/search/sort/pathPrefix dimension", () => {
    const chips = describeBaseQuery({
      tag: ["project"],
      exclude_tags: ["archived"],
      search: "coffee",
      sort: "desc",
      path_prefix: "Work/",
    });
    expect(chips).toEqual([
      { kind: "tag", value: "project", label: "#project" },
      { kind: "exclude", value: "archived", label: "not #archived" },
      { kind: "search", label: '"coffee"' },
      { kind: "sort", value: "desc", label: "sorted by newest" },
      { kind: "pathPrefix", value: "Work/", label: "in Work/" },
    ]);
  });

  it("returns no chips for a null (malformed) query", () => {
    expect(describeBaseQuery(null)).toEqual([]);
  });

  it("returns no chips for an empty query — the everything view", () => {
    expect(describeBaseQuery({})).toEqual([]);
  });
});
