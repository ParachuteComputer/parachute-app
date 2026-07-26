import { DEFAULT_PAGE_SIZE } from "@/lib/vault/note-query";
import type { TagRoles } from "@/lib/vault/tag-roles";
import type { TagFieldSchema, TagRecord } from "@/lib/vault/types";
import { describe, expect, it } from "vitest";
import { deriveTagViewDef } from "./derive";
import { resolveViewFields } from "./fields";

const DEFAULT_ROLES: TagRoles = {
  pinned: "pinned",
  archived: "archived",
  captureVoice: "capture",
  captureText: "capture",
  view: "view",
};

// A vault that renamed its archived role — the derived exclusion must follow
// the ROLE, never a literal "archived" string.
const RENAMED_ROLES: TagRoles = {
  pinned: "starred",
  archived: "shelved",
  captureVoice: "capture",
  captureText: "capture",
  view: "saved-view",
};

function tag(fields: Record<string, TagFieldSchema> | null | undefined): TagRecord {
  return { name: "project", fields };
}

describe("deriveTagViewDef", () => {
  it("a typed tag (≥1 schema field) opens as a table", () => {
    const def = deriveTagViewDef(
      "project",
      tag({ status: { type: "string", enum: ["todo", "done"] }, due: { type: "date" } }),
      DEFAULT_ROLES,
    );
    expect(def.kind).toBe("table");
  });

  it("a plain tag (no schema fields) opens as a list", () => {
    expect(deriveTagViewDef("idea", tag({}), DEFAULT_ROLES).kind).toBe("list");
    expect(deriveTagViewDef("idea", tag(null), DEFAULT_ROLES).kind).toBe("list");
    // A tag with no schema row at all (vault 404 → null/undefined) → list.
    expect(deriveTagViewDef("idea", null, DEFAULT_ROLES).kind).toBe("list");
    expect(deriveTagViewDef("idea", undefined, DEFAULT_ROLES).kind).toBe("list");
  });

  it("queries the tag and excludes the archived role", () => {
    const def = deriveTagViewDef("project", tag(null), DEFAULT_ROLES);
    expect(def.query).toEqual({
      tag: "project",
      exclude_tags: ["archived"],
      sort: "desc",
      limit: DEFAULT_PAGE_SIZE,
    });
  });

  it("pins the scale FLOOR — newest-first + a bounded page — so it can't silently regress", () => {
    // The regression guard (app#…, the 620-note-tall page): a derived tag page
    // must never inherit the vault's default (oldest-first, and unbounded on
    // the live stream). This pins both halves of the floor for EVERY tag —
    // typed or plain, archived-excluded or not.
    for (const [name, roles] of [
      ["project", DEFAULT_ROLES],
      ["archived", DEFAULT_ROLES], // the self-exclusion branch
      ["shelved", RENAMED_ROLES],
    ] as const) {
      const q = deriveTagViewDef(name, tag(null), roles).query;
      expect(q?.sort).toBe("desc");
      expect(q?.limit).toBe(DEFAULT_PAGE_SIZE);
    }
  });

  it("excludes the archived role by its RENAMED name, never a literal string", () => {
    const def = deriveTagViewDef("project", tag(null), RENAMED_ROLES);
    expect(def.query).toEqual({
      tag: "project",
      exclude_tags: ["shelved"],
      sort: "desc",
      limit: DEFAULT_PAGE_SIZE,
    });
  });

  it("the archived tag's OWN page does not exclude itself", () => {
    const def = deriveTagViewDef("archived", tag(null), DEFAULT_ROLES);
    expect(def.query).toEqual({ tag: "archived", sort: "desc", limit: DEFAULT_PAGE_SIZE });
    expect(def.query).not.toHaveProperty("exclude_tags");
  });

  it("the archived tag's own page under a renamed role also does not self-exclude", () => {
    const def = deriveTagViewDef("shelved", tag(null), RENAMED_ROLES);
    expect(def.query).toEqual({ tag: "shelved", sort: "desc", limit: DEFAULT_PAGE_SIZE });
  });

  it("the pinned tag's own page still excludes archived (pinned is never self-referential here)", () => {
    // Pinned is used for partitioning, not exclusion — it's never added to
    // exclude_tags, so its own page carries the normal archived exclusion and
    // there is no self-exclusion to guard against.
    const def = deriveTagViewDef("pinned", tag(null), DEFAULT_ROLES);
    expect(def.query).toEqual({
      tag: "pinned",
      exclude_tags: ["archived"],
      sort: "desc",
      limit: DEFAULT_PAGE_SIZE,
    });
  });

  it("carries a synthetic, inert noteId and no problems, titled by the tag name", () => {
    const def = deriveTagViewDef("project", tag(null), DEFAULT_ROLES);
    expect(def.noteId).toBe("derived:tag:project");
    expect(def.title).toBe("project");
    expect(def.problems).toEqual([]);
    // Left unset so withLens picks lane/date fields when the viewer switches
    // lens — never duplicated here.
    expect(def.groupBy).toBeUndefined();
    expect(def.dateField).toBeUndefined();
    expect(def.fields).toBeUndefined();
  });

  it("names needing URL encoding survive verbatim in query + id (encoding is the route's job)", () => {
    const def = deriveTagViewDef("area/work", tag(null), DEFAULT_ROLES);
    expect(def.query).toMatchObject({ tag: "area/work" });
    expect(def.title).toBe("area/work");
    expect(def.noteId).toBe("derived:tag:area/work");
  });

  it("a typed tag's schema fields resolve as columns for free (single-tag query)", () => {
    // The table columns come from resolveViewFields off the single query tag —
    // the derived def sets no `fields`, so the schema order drives the columns.
    const fields: Record<string, TagFieldSchema> = {
      status: { type: "string", enum: ["todo", "done"] },
      due: { type: "date" },
    };
    const def = deriveTagViewDef("project", tag(fields), DEFAULT_ROLES);
    const resolved = resolveViewFields(def, fields);
    expect(resolved.map((f) => f.name)).toEqual(["status", "due"]);
  });
});
