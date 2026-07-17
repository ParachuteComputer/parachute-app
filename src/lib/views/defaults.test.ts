import type { TagRoles } from "@/lib/vault/tag-roles";
import type { Note } from "@/lib/vault/types";
import { describe, expect, it } from "vitest";
import {
  ARCHIVE_VIEW_PATH,
  PINNED_VIEW_PATH,
  builtInDefaultViewDef,
  defaultPagePath,
  resolveDefaultViewDef,
} from "./defaults";

function note(overrides: Partial<Note>): Note {
  return {
    id: "n1",
    createdAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

const DEFAULT_ROLES: TagRoles = {
  pinned: "pinned",
  archived: "archived",
  captureVoice: "capture",
  captureText: "capture",
  view: "view",
};

// A vault that renamed its roles — the whole point of routing the built-in
// defaults through TagRoles instead of the pack's literal tag names (§7).
const RENAMED_ROLES: TagRoles = {
  pinned: "starred",
  archived: "shelved",
  captureVoice: "capture",
  captureText: "capture",
  view: "saved-view",
};

describe("defaultPagePath", () => {
  it("points at the pack's canonical paths", () => {
    expect(defaultPagePath("pinned")).toBe(PINNED_VIEW_PATH);
    expect(defaultPagePath("archived")).toBe(ARCHIVE_VIEW_PATH);
  });
});

describe("builtInDefaultViewDef", () => {
  it("mirrors the pack's own query (tag: pinned / tag: archived) through the default roles", () => {
    expect(builtInDefaultViewDef("pinned", DEFAULT_ROLES).query).toEqual({ tag: "pinned" });
    expect(builtInDefaultViewDef("archived", DEFAULT_ROLES).query).toEqual({ tag: "archived" });
  });

  it("respects role indirection — a renamed pinned/archived tag flows through, never the literal name", () => {
    const pinned = builtInDefaultViewDef("pinned", RENAMED_ROLES);
    expect(pinned.query).toEqual({ tag: "starred" });
    const archived = builtInDefaultViewDef("archived", RENAMED_ROLES);
    expect(archived.query).toEqual({ tag: "shelved" });
  });

  it("degrades to list, carries no problems, and has no backing note", () => {
    const def = builtInDefaultViewDef("pinned", DEFAULT_ROLES);
    expect(def.kind).toBe("list");
    expect(def.problems).toEqual([]);
    expect(def.title).toBe("Pinned");
  });
});

describe("resolveDefaultViewDef", () => {
  it("falls back to the built-in def when there is no pack note at the canonical path", () => {
    const { def, isPackNote } = resolveDefaultViewDef("pinned", null, DEFAULT_ROLES);
    expect(isPackNote).toBe(false);
    expect(def.query).toEqual({ tag: "pinned" });
  });

  it("falls back to the built-in def when the lookup hasn't resolved yet (undefined)", () => {
    const { def, isPackNote } = resolveDefaultViewDef("archived", undefined, DEFAULT_ROLES);
    expect(isPackNote).toBe(false);
    expect(def.query).toEqual({ tag: "archived" });
  });

  it("a well-formed pack note at the canonical path wins over the built-in def", () => {
    const packNote = note({
      id: "pack-pinned",
      path: PINNED_VIEW_PATH,
      tags: ["view"],
      metadata: { kind: "list", query: JSON.stringify({ tag: "urgent" }) },
    });
    const { def, isPackNote } = resolveDefaultViewDef("pinned", packNote, DEFAULT_ROLES);
    expect(isPackNote).toBe(true);
    expect(def.query).toEqual({ tag: "urgent" });
    expect(def.noteId).toBe("pack-pinned");
  });

  it("a malformed pack note (unparseable query) falls back to the built-in def, not a blank/broken state", () => {
    const packNote = note({
      id: "pack-pinned-broken",
      path: PINNED_VIEW_PATH,
      tags: ["view"],
      metadata: { kind: "list", query: "{not valid json" },
    });
    const { def, isPackNote } = resolveDefaultViewDef("pinned", packNote, DEFAULT_ROLES);
    expect(isPackNote).toBe(false);
    expect(def.query).toEqual({ tag: "pinned" });
    expect(def.problems).toEqual([]);
  });

  it("a note at the canonical path that isn't tagged #view is ignored — falls back to the built-in def", () => {
    const notAView = note({
      id: "decoy",
      path: PINNED_VIEW_PATH,
      tags: ["project"],
      metadata: { kind: "list", query: JSON.stringify({ tag: "urgent" }) },
    });
    const { def, isPackNote } = resolveDefaultViewDef("pinned", notAView, DEFAULT_ROLES);
    expect(isPackNote).toBe(false);
    expect(def.query).toEqual({ tag: "pinned" });
  });

  it("honors a renamed view role when checking whether the pack note is a view", () => {
    const packNote = note({
      id: "pack-pinned",
      path: PINNED_VIEW_PATH,
      tags: ["saved-view"],
      metadata: { kind: "list", query: JSON.stringify({ tag: "starred", sort: "asc" }) },
    });
    const { def, isPackNote } = resolveDefaultViewDef("pinned", packNote, RENAMED_ROLES);
    expect(isPackNote).toBe(true);
    expect(def.query).toEqual({ tag: "starred", sort: "asc" });
  });
});
