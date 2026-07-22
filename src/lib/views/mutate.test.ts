import type { Note } from "@/lib/vault/types";
import { describe, expect, it } from "vitest";
import { applyFieldToNote, applyFieldToViewCache } from "./mutate";

// The pure half of the shared view-mutation primitive (view-experience wave,
// slice 1) — the "which field, which value" transform, decidable without a
// QueryClient. The optimistic-cache + rollback wiring around it is exercised in
// the BoardView component test.

function note(id: string, metadata?: Record<string, unknown>): Note {
  return { id, createdAt: "2026-07-22T00:00:00Z", metadata };
}

describe("applyFieldToNote", () => {
  it("writes exactly one metadata key, leaving siblings and body untouched", () => {
    const before = note("a", { status: "active", priority: 2, owner: "aaron" });
    const after = applyFieldToNote(before, "status", "done");
    expect(after.metadata).toEqual({ status: "done", priority: 2, owner: "aaron" });
    // A new object, not a mutation of the input.
    expect(after).not.toBe(before);
    expect(before.metadata?.status).toBe("active");
  });

  it("preserves the value TYPE — an integer lane value is stored as a number, not '3'", () => {
    const after = applyFieldToNote(note("a", { priority: 1 }), "priority", 3);
    expect(after.metadata?.priority).toBe(3);
    expect(typeof after.metadata?.priority).toBe("number");
  });

  it("preserves a boolean value's type", () => {
    const after = applyFieldToNote(note("a", { done: false }), "done", true);
    expect(after.metadata?.done).toBe(true);
    expect(typeof after.metadata?.done).toBe("boolean");
  });

  it("DELETES the key for the unset lane (null-as-delete), keeping siblings", () => {
    const after = applyFieldToNote(note("a", { status: "active", owner: "aaron" }), "status", null);
    expect("status" in (after.metadata ?? {})).toBe(false);
    expect(after.metadata).toEqual({ owner: "aaron" });
  });

  it("writes onto a note that had no metadata at all", () => {
    const after = applyFieldToNote(note("a"), "status", "active");
    expect(after.metadata).toEqual({ status: "active" });
  });
});

describe("applyFieldToViewCache", () => {
  it("updates only the matching note; every other note is untouched (same identity)", () => {
    const a = note("a", { status: "active" });
    const b = note("b", { status: "active" });
    const list = [a, b];
    const next = applyFieldToViewCache(list, "b", "status", "done");
    expect(next?.map((n) => n.metadata?.status)).toEqual(["active", "done"]);
    // Unchanged note keeps its reference; changed note is a fresh object.
    expect(next?.[0]).toBe(a);
    expect(next?.[1]).not.toBe(b);
  });

  it("passes a missing (undefined) list through unchanged", () => {
    expect(applyFieldToViewCache(undefined, "a", "status", "done")).toBeUndefined();
  });

  it("is a no-op shape when no note matches the id", () => {
    const list = [note("a", { status: "active" })];
    const next = applyFieldToViewCache(list, "zzz", "status", "done");
    expect(next?.[0]?.metadata?.status).toBe("active");
  });
});
