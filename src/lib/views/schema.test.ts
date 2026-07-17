import type { Note } from "@/lib/vault/types";
import { describe, expect, it } from "vitest";
import { decodeViewDef, isViewNote } from "./schema";

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
    expect(def.legacy).toBeUndefined();
  });

  it("decodes board/calendar kinds without recording a problem", () => {
    const board = decodeViewDef(
      note({ path: "Views/Board", metadata: { kind: "board", query: "{}", lane_by: "status" } }),
    );
    expect(board.kind).toBe("board");
    expect(board.laneBy).toBe("status");
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

  it("legacy saved-view adapter: converts filters into the equivalent query object", () => {
    const legacyNote = note({
      path: "UI/Views/Daily",
      metadata: {
        kind: "saved-view",
        filters: { tags: ["journal"], search: "coffee", sort: "asc" },
      },
    });
    const def = decodeViewDef(legacyNote);
    expect(def.legacy).toBe(true);
    expect(def.kind).toBe("list");
    expect(def.title).toBe("Daily");
    expect(def.query).toEqual({
      search: "coffee",
      tag: ["journal"],
      sort: "asc",
      exclude_tags: ["archived"],
    });
    expect(def.problems).toEqual([]);
  });

  it("legacy adapter honors showArchived:true by omitting exclude_tags", () => {
    const def = decodeViewDef(
      note({
        path: "UI/Views/All",
        metadata: { kind: "saved-view", filters: { showArchived: true } },
      }),
    );
    expect(def.query?.exclude_tags).toBeUndefined();
  });

  it("legacy adapter uses the resolved archived role tag when provided", () => {
    const def = decodeViewDef(
      note({ path: "UI/Views/X", metadata: { kind: "saved-view", filters: {} } }),
      { archivedTag: "shelved" },
    );
    expect(def.query?.exclude_tags).toEqual(["shelved"]);
  });

  it("never throws on a note with no metadata at all", () => {
    expect(() => decodeViewDef(note({ metadata: undefined }))).not.toThrow();
  });
});

describe("isViewNote", () => {
  it("true for a note carrying the view role tag", () => {
    expect(isViewNote(note({ tags: ["view"] }), "view")).toBe(true);
  });

  it("true for a legacy saved-view note even without the role tag (defensive)", () => {
    expect(isViewNote(note({ tags: [], metadata: { kind: "saved-view" } }), "view")).toBe(true);
  });

  it("false for an ordinary note", () => {
    expect(isViewNote(note({ tags: ["project"] }), "view")).toBe(false);
  });
});
