import type { Note } from "@/lib/vault/types";
import { describe, expect, it } from "vitest";
import { partitionPinned } from "./partition";

function note(id: string, tags: string[] = []): Note {
  return { id, createdAt: "2026-07-01T00:00:00Z", tags };
}

describe("partitionPinned", () => {
  it("splits pinned notes into their own group, preserving relative order in each", () => {
    const notes = [note("a", ["pinned"]), note("b"), note("c", ["pinned"]), note("d")];
    const { pinned, rest } = partitionPinned(notes, "pinned");
    expect(pinned.map((n) => n.id)).toEqual(["a", "c"]);
    expect(rest.map((n) => n.id)).toEqual(["b", "d"]);
  });

  it("an empty list of pinned notes leaves rest untouched", () => {
    const notes = [note("a"), note("b")];
    const { pinned, rest } = partitionPinned(notes, "pinned");
    expect(pinned).toEqual([]);
    expect(rest).toEqual(notes);
  });

  it("is vacuous when the view's own query is the pinned tag — everything stays in rest", () => {
    const notes = [note("a", ["pinned"]), note("b", ["pinned"])];
    const { pinned, rest } = partitionPinned(notes, "pinned", ["pinned"]);
    expect(pinned).toEqual([]);
    expect(rest).toEqual(notes);
  });

  it("respects a custom (role-remapped) pinned tag name", () => {
    const notes = [note("a", ["starred"]), note("b")];
    const { pinned, rest } = partitionPinned(notes, "starred");
    expect(pinned.map((n) => n.id)).toEqual(["a"]);
    expect(rest.map((n) => n.id)).toEqual(["b"]);
  });
});
