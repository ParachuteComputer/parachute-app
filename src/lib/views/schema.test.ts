import type { Note } from "@/lib/vault/types";
import { describe, expect, it } from "vitest";
import { decodeViewDef, isLegacySavedView, isViewNote } from "./schema";

function note(overrides: Partial<Note>): Note {
  return {
    id: "n1",
    createdAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("decodeViewDef", () => {
  it("decodes a well-formed list view", () => {
    const def = decodeViewDef(
      note({
        path: "Views/Active projects",
        tags: ["view"],
        metadata: { kind: "list", query: JSON.stringify({ tag: "project" }) },
      }),
    );
    expect(def.kind).toBe("list");
    expect(def.query).toEqual({ tag: "project" });
    expect(def.title).toBe("Active projects");
    expect(def.problems).toEqual([]);
  });

  it("decodes board/calendar kinds without recording a problem", () => {
    const board = decodeViewDef(
      note({ path: "Views/Board", metadata: { kind: "board", query: "{}", group_by: "status" } }),
    );
    expect(board.kind).toBe("board");
    expect(board.groupBy).toBe("status");
    expect(board.problems).toEqual([]);

    const calendar = decodeViewDef(
      note({
        path: "Views/Cal",
        metadata: { kind: "calendar", query: "{}", date_field: "due" },
      }),
    );
    expect(calendar.kind).toBe("calendar");
    expect(calendar.dateField).toBe("due");
  });

  it("group_by → groupBy is canonical; lane_by is a PERMANENT alias so old boards still group", () => {
    const legacyLaneBy = decodeViewDef(
      note({ path: "Views/Old", metadata: { kind: "board", query: "{}", lane_by: "status" } }),
    );
    expect(legacyLaneBy.groupBy).toBe("status");

    // When both keys are present, the canonical group_by wins.
    const both = decodeViewDef(
      note({
        path: "Views/Both",
        metadata: { kind: "board", query: "{}", group_by: "stage", lane_by: "status" },
      }),
    );
    expect(both.groupBy).toBe("stage");
  });

  it("decodes the optional `fields` override from a JSON-string array (and a raw array), else undefined", () => {
    const jsonString = decodeViewDef(
      note({ path: "Views/F", metadata: { query: "{}", fields: '["status","priority"]' } }),
    );
    expect(jsonString.fields).toEqual(["status", "priority"]);

    const rawArray = decodeViewDef(
      note({ path: "Views/F2", metadata: { query: "{}", fields: ["owner"] } }),
    );
    expect(rawArray.fields).toEqual(["owner"]);

    // Absent / malformed / empty → undefined (degrade to today's behavior), no problem recorded.
    expect(
      decodeViewDef(note({ path: "Views/F3", metadata: { query: "{}" } })).fields,
    ).toBeUndefined();
    const malformed = decodeViewDef(
      note({ path: "Views/F4", metadata: { query: "{}", fields: "{not json" } }),
    );
    expect(malformed.fields).toBeUndefined();
    expect(malformed.problems).toEqual([]);
    expect(
      decodeViewDef(note({ path: "Views/F5", metadata: { query: "{}", fields: "[]" } })).fields,
    ).toBeUndefined();
  });

  it("degrades an unknown kind to list with no problem — a view is never wrong to render as a list", () => {
    const def = decodeViewDef(
      note({ path: "Views/X", metadata: { kind: "timeline", query: "{}" } }),
    );
    expect(def.kind).toBe("list");
    expect(def.problems).toEqual([]);
  });

  it("degrades an absent kind to list", () => {
    const def = decodeViewDef(note({ path: "Views/X", metadata: { query: "{}" } }));
    expect(def.kind).toBe("list");
  });

  it("defaults to list with an empty query object when metadata carries no query at all", () => {
    const def = decodeViewDef(note({ path: "Views/Empty", metadata: {} }));
    expect(def.query).toEqual({});
    expect(def.problems).toEqual([]);
  });

  it("malformed query JSON: query is null and a problem is recorded — never runs an implicit {}", () => {
    const def = decodeViewDef(
      note({ path: "Views/Broken", metadata: { kind: "list", query: "{not json" } }),
    );
    expect(def.query).toBeNull();
    expect(def.problems).toHaveLength(1);
    expect(def.problems[0].code).toBe("invalid_query_json");
    expect(def.problems[0].message).toMatch(/didn't parse/i);
  });

  it("malformed query shape (non-object JSON, e.g. an array) is also a problem", () => {
    const def = decodeViewDef(note({ path: "Views/Arr", metadata: { query: "[1,2,3]" } }));
    expect(def.query).toBeNull();
    expect(def.problems[0].code).toBe("invalid_query_json");
  });

  it("a raw object query (not a JSON string) is malformed per the wire format", () => {
    const def = decodeViewDef(note({ path: "Views/Raw", metadata: { query: { tag: "x" } } }));
    expect(def.query).toBeNull();
    expect(def.problems).toHaveLength(1);
  });

  it("titles from the path basename, falling back to the id with no path", () => {
    expect(decodeViewDef(note({ path: "Views/My View", metadata: {} })).title).toBe("My View");
    expect(decodeViewDef(note({ id: "abc123", metadata: {} })).title).toBe("abc123");
  });

  // §8 (the legacy {kind:"saved-view",filters} adapter) is void — that
  // feature is unused in practice (Aaron, 2026-07-17). A legacy-shaped note
  // decodes through the ORDINARY path: `kind` isn't a recognized ViewKind
  // ("saved-view" isn't in VIEW_KINDS) so it degrades to list, and there's
  // no `query` string so it's the empty "everything" query — never a crash,
  // never a legacy-specific branch.
  it("a legacy saved-view note decodes as an ordinary (unadapted) list view", () => {
    const legacyNote = note({
      path: "UI/Views/Daily",
      metadata: { kind: "saved-view", filters: { tags: ["journal"] } },
    });
    const def = decodeViewDef(legacyNote);
    expect(def.kind).toBe("list");
    expect(def.title).toBe("Daily");
    expect(def.query).toEqual({});
    expect(def.problems).toEqual([]);
  });

  it("never throws on a note with no metadata at all", () => {
    expect(() => decodeViewDef(note({ metadata: undefined }))).not.toThrow();
  });
});

describe("isViewNote", () => {
  it("true for a note carrying the view role tag", () => {
    expect(isViewNote(note({ tags: ["view"] }), "view")).toBe(true);
  });

  it("false for an ordinary note", () => {
    expect(isViewNote(note({ tags: ["project"] }), "view")).toBe(false);
  });

  it("false for a legacy saved-view note that happens to lack the role tag", () => {
    expect(isViewNote(note({ tags: [], metadata: { kind: "saved-view" } }), "view")).toBe(false);
  });
});

describe("isLegacySavedView", () => {
  it("true for the legacy {kind:'saved-view'} shape", () => {
    expect(isLegacySavedView(note({ metadata: { kind: "saved-view", filters: {} } }))).toBe(true);
  });

  it("false for a canonical view note or an ordinary note", () => {
    expect(isLegacySavedView(note({ metadata: { kind: "list", query: "{}" } }))).toBe(false);
    expect(isLegacySavedView(note({ metadata: {} }))).toBe(false);
    expect(isLegacySavedView(note({ metadata: undefined }))).toBe(false);
  });
});
