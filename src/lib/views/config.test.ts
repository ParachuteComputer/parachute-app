import {
  type ViewConfigDraft,
  applyConfig,
  configDraftToSearchParams,
  draftPatchMetadata,
  firstDateField,
  firstEnumField,
  fullConfigMetadata,
  hasConfigDraft,
  normalizeConfigDraft,
  searchParamsToConfigDraft,
  withLens,
} from "@/lib/views/config";
import type { ResolvedField } from "@/lib/views/fields";
import { refinementsToSearchParams, searchParamsToRefinements } from "@/lib/views/query";
import type { ViewDef } from "@/lib/views/schema";
import { describe, expect, it } from "vitest";

// The draft-config layer (views train B): URL round-trip, the pure overlay,
// normalization, lens-switch defaults, and the two save payload builders.

function makeDef(overrides: Partial<ViewDef> = {}): ViewDef {
  return {
    noteId: "v1",
    path: "Views/Projects",
    title: "Projects",
    kind: "list",
    query: { tag: "project" },
    problems: [],
    ...overrides,
  };
}

const FIELDS: ResolvedField[] = [
  { name: "title", schema: { type: "string" } },
  { name: "status", schema: { type: "string", enum: ["active", "done"] } },
  { name: "due", schema: { type: "date" } },
  { name: "priority", schema: { type: "string", enum: ["high", "low"] } },
];

describe("config draft URL round-trip", () => {
  it("round-trips every key through search params", () => {
    const draft: ViewConfigDraft = {
      kind: "board",
      groupBy: "status",
      dateField: "due",
      fields: ["status", "due", "priority"],
    };
    const params = configDraftToSearchParams(draft);
    expect(params.get("kind")).toBe("board");
    expect(params.get("group")).toBe("status");
    expect(params.get("date")).toBe("due");
    expect(params.get("fields")).toBe("status,due,priority");
    expect(searchParamsToConfigDraft(params)).toEqual(draft);
  });

  it("an empty draft emits zero params and parses back empty", () => {
    expect(configDraftToSearchParams({}).toString()).toBe("");
    expect(searchParamsToConfigDraft(new URLSearchParams())).toEqual({});
    expect(hasConfigDraft(searchParamsToConfigDraft(new URLSearchParams()))).toBe(false);
  });

  it("drops an unknown kind and empty/whitespace fields segments", () => {
    const params = new URLSearchParams("kind=table&fields=,%20,");
    expect(searchParamsToConfigDraft(params)).toEqual({});
  });

  it("config params never collide with the refinement params — both axes share one URL", () => {
    const draft: ViewConfigDraft = { kind: "board", groupBy: "status", fields: ["status"] };
    const refinements = {
      addTags: ["urgent"],
      removeExcludes: ["archived"],
      search: "kick",
      sort: "desc" as const,
    };
    // Param-name sets are disjoint by design.
    const configKeys = [...configDraftToSearchParams(draft).keys()];
    const refinementKeys = [...refinementsToSearchParams(refinements).keys()];
    expect(configKeys.filter((k) => refinementKeys.includes(k))).toEqual([]);

    // Combined into one URL, each axis reads back its own values intact.
    const combined = configDraftToSearchParams(draft);
    for (const [k, v] of refinementsToSearchParams(refinements)) combined.append(k, v);
    expect(searchParamsToConfigDraft(combined)).toEqual(draft);
    expect(searchParamsToRefinements(combined)).toEqual(refinements);
  });
});

describe("applyConfig", () => {
  it("is pure: never mutates the def, and an empty draft returns the def itself", () => {
    const def = makeDef({ groupBy: "status" });
    const frozen = JSON.parse(JSON.stringify(def));
    expect(applyConfig(def, {})).toBe(def);
    const out = applyConfig(def, { kind: "board", fields: ["status"] });
    expect(out).not.toBe(def);
    expect(def).toEqual(frozen);
    expect(out.kind).toBe("board");
    expect(out.fields).toEqual(["status"]);
  });

  it("draft keys win; absent keys keep the saved value", () => {
    const def = makeDef({ kind: "board", groupBy: "status", dateField: "due" });
    const out = applyConfig(def, { groupBy: "priority" });
    expect(out.kind).toBe("board");
    expect(out.groupBy).toBe("priority");
    expect(out.dateField).toBe("due");
    expect(out.query).toEqual(def.query);
  });
});

describe("hasConfigDraft", () => {
  it("is false only for the empty draft", () => {
    expect(hasConfigDraft({})).toBe(false);
    expect(hasConfigDraft({ kind: "list" })).toBe(true);
    expect(hasConfigDraft({ groupBy: "status" })).toBe(true);
    expect(hasConfigDraft({ dateField: "due" })).toBe(true);
    expect(hasConfigDraft({ fields: [] })).toBe(true);
  });
});

describe("normalizeConfigDraft", () => {
  it("drops keys equal to the saved def — including deep-equal fields lists", () => {
    const def = makeDef({ kind: "board", groupBy: "status", fields: ["a", "b"] });
    expect(
      normalizeConfigDraft(def, { kind: "board", groupBy: "status", fields: ["a", "b"] }),
    ).toEqual({});
    expect(normalizeConfigDraft(def, { kind: "list", fields: ["b", "a"] })).toEqual({
      kind: "list",
      fields: ["b", "a"],
    });
  });
});

describe("withLens", () => {
  it("board with no effective group-by defaults to the FIRST enum-typed field", () => {
    const def = makeDef();
    expect(withLens(def, {}, "board", FIELDS)).toEqual({ kind: "board", groupBy: "status" });
  });

  it("board keeps an existing group-by — saved or drafted — over the default", () => {
    expect(withLens(makeDef({ groupBy: "priority" }), {}, "board", FIELDS)).toEqual({
      kind: "board",
    });
    expect(withLens(makeDef(), { groupBy: "priority" }, "board", FIELDS)).toEqual({
      kind: "board",
      groupBy: "priority",
    });
  });

  it("calendar with no effective date-field defaults to the first date-typed field", () => {
    expect(withLens(makeDef(), {}, "calendar", FIELDS)).toEqual({
      kind: "calendar",
      dateField: "due",
    });
  });

  it("no candidate fields (schema unloaded) adds no default — fall-through stays", () => {
    expect(withLens(makeDef(), {}, "board", [])).toEqual({ kind: "board" });
    expect(withLens(makeDef(), {}, "calendar", [])).toEqual({ kind: "calendar" });
  });

  // Review must-fix: a peek at Board and back must leave NO residue — the
  // auto-added group-by would otherwise keep the bar up forever (and Save
  // would write a stray group_by onto a list view).
  it("switching AWAY drops a draft group-by/date-field the saved def never had", () => {
    expect(withLens(makeDef(), { kind: "board", groupBy: "status" }, "list", FIELDS)).toEqual({
      kind: "list",
    });
    expect(withLens(makeDef(), { kind: "calendar", dateField: "due" }, "gallery", FIELDS)).toEqual({
      kind: "gallery",
    });
    // Cross-switch: board → calendar sheds the orphan group AND defaults the date.
    expect(withLens(makeDef(), { kind: "board", groupBy: "status" }, "calendar", FIELDS)).toEqual({
      kind: "calendar",
      dateField: "due",
    });
  });

  it("a draft override of a key the SAVED def carries survives switching away", () => {
    expect(
      withLens(
        makeDef({ groupBy: "status" }),
        { kind: "board", groupBy: "priority" },
        "list",
        FIELDS,
      ),
    ).toEqual({ kind: "list", groupBy: "priority" });
  });

  it("field pickers: first enum / first date", () => {
    expect(firstEnumField(FIELDS)).toBe("status");
    expect(firstDateField(FIELDS)).toBe("due");
    expect(firstEnumField([{ name: "x", schema: { type: "string" } }])).toBeUndefined();
    expect(firstDateField([{ name: "x", schema: { type: "string" } }])).toBeUndefined();
  });
});

describe("save payload builders", () => {
  it("draftPatchMetadata writes kind+query plus EXACTLY the overridden keys", () => {
    const def = makeDef({ kind: "list", groupBy: "status", fields: ["a"] });
    const patch = draftPatchMetadata(def, { kind: "board" }, { tag: "project" });
    expect(patch).toEqual({ kind: "board", query: JSON.stringify({ tag: "project" }) });

    const patch2 = draftPatchMetadata(
      def,
      { groupBy: "priority", dateField: "due", fields: ["a", "b"] },
      { tag: "project" },
    );
    expect(patch2).toEqual({
      kind: "list",
      query: JSON.stringify({ tag: "project" }),
      group_by: "priority",
      date_field: "due",
      fields: JSON.stringify(["a", "b"]),
    });
  });

  it("fullConfigMetadata writes the FULL effective config and omits absent keys", () => {
    const eff = makeDef({ kind: "board", groupBy: "status", fields: ["status", "due"] });
    expect(fullConfigMetadata(eff, { tag: "project" })).toEqual({
      kind: "board",
      query: JSON.stringify({ tag: "project" }),
      group_by: "status",
      fields: JSON.stringify(["status", "due"]),
    });
    // A bare list view forks to a bare list view — no undefined-key noise.
    expect(fullConfigMetadata(makeDef(), {})).toEqual({ kind: "list", query: "{}" });
  });

  // Review should-fix: a null base query (§3 "run nothing") must never be
  // written as "{}" — that would silently promote a malformed view into
  // match-everything. Both builders omit the key instead.
  it("a null merged query omits the query key from both payloads", () => {
    const broken = makeDef({ query: null });
    expect(draftPatchMetadata(broken, { kind: "board", groupBy: "status" }, null)).toEqual({
      kind: "board",
      group_by: "status",
    });
    expect(fullConfigMetadata(applyConfig(broken, { kind: "board" }), null)).toEqual({
      kind: "board",
    });
  });
});
