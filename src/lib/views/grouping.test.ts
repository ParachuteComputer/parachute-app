import type { Note } from "@/lib/vault/types";
import { describe, expect, it } from "vitest";
import {
  defaultMonth,
  groupIntoLanes,
  parseNoteDate,
  placeOnCalendar,
  resolveLaneOrder,
} from "./grouping";

// The grouping/placement logic behind the board + calendar kinds (Views Wave
// 2b) — pinned at the pure layer where "which note lands where" is decidable
// without a DOM.

function note(id: string, metadata?: Record<string, unknown>): Note {
  return { id, createdAt: "2026-07-01T00:00:00Z", metadata };
}

describe("groupIntoLanes", () => {
  it("groups notes into lanes by the field value; a note with the field lands in its lane", () => {
    const notes = [
      note("a", { status: "active" }),
      note("b", { status: "dormant" }),
      note("c", { status: "active" }),
    ];
    const lanes = groupIntoLanes(notes, "status");
    const active = lanes.find((l) => l.key === "active");
    const dormant = lanes.find((l) => l.key === "dormant");
    expect(active?.notes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(dormant?.notes.map((n) => n.id)).toEqual(["b"]);
  });

  it("puts notes missing the field into a trailing 'No {field}' lane, last", () => {
    const notes = [
      note("a", { status: "active" }),
      note("b", {}),
      note("c", { status: "" }), // empty-after-trim counts as absent
      note("d"), // no metadata at all
    ];
    const lanes = groupIntoLanes(notes, "status");
    const last = lanes[lanes.length - 1];
    expect(last.uncategorized).toBe(true);
    expect(last.label).toBe("No status");
    expect(last.notes.map((n) => n.id)).toEqual(["b", "c", "d"]);
  });

  it("honors a provided enum order; absent values emit no empty lane", () => {
    const notes = [
      note("a", { status: "dormant" }),
      note("b", { status: "active" }),
      note("c", { status: "incubating" }),
    ];
    const lanes = groupIntoLanes(notes, "status", ["active", "incubating", "dormant", "archived"]);
    expect(lanes.map((l) => l.key)).toEqual(["active", "incubating", "dormant"]);
  });

  it("falls back to alphabetical order for values not named in the order list", () => {
    const notes = [
      note("a", { stage: "zeta" }),
      note("b", { stage: "alpha" }),
      note("c", { stage: "mid" }),
    ];
    const lanes = groupIntoLanes(notes, "stage");
    expect(lanes.map((l) => l.key)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("renders one big uncategorized lane when no note carries the field", () => {
    const notes = [note("a"), note("b")];
    const lanes = groupIntoLanes(notes, "status");
    expect(lanes).toHaveLength(1);
    expect(lanes[0].uncategorized).toBe(true);
    expect(lanes[0].notes).toHaveLength(2);
  });

  it("stringifies scalar (numeric/boolean) lane values", () => {
    const lanes = groupIntoLanes(
      [note("a", { priority: 1 }), note("b", { done: true })],
      "priority",
    );
    expect(lanes.find((l) => l.key === "1")?.notes.map((n) => n.id)).toEqual(["a"]);
  });

  it("carries each lane's ORIGINAL typed value — a number stays a number, not '3'", () => {
    const lanes = groupIntoLanes(
      [note("a", { priority: 3 }), note("b", { priority: 3 }), note("c", { priority: 1 })],
      "priority",
    );
    const high = lanes.find((l) => l.key === "3");
    expect(high?.value).toBe(3);
    expect(typeof high?.value).toBe("number");
    // The key is still the stringified grouping key.
    expect(high?.key).toBe("3");
  });

  it("carries a string lane's value as the string, and the uncategorized lane's value as null", () => {
    const lanes = groupIntoLanes([note("a", { status: "active" }), note("b")], "status");
    expect(lanes.find((l) => l.key === "active")?.value).toBe("active");
    expect(lanes.find((l) => l.uncategorized)?.value).toBeNull();
  });
});

describe("resolveLaneOrder", () => {
  it("uses the tag schema's declared enum when present", () => {
    expect(resolveLaneOrder("status", { status: { type: "string", enum: ["x", "y"] } })).toEqual([
      "x",
      "y",
    ]);
  });

  it("falls back to a built-in order for a known field with no schema", () => {
    expect(resolveLaneOrder("status")).toContain("active");
    expect(resolveLaneOrder("status").indexOf("active")).toBeLessThan(
      resolveLaneOrder("status").indexOf("archived"),
    );
  });

  it("returns [] (pure alphabetical) for an unknown field", () => {
    expect(resolveLaneOrder("whatever")).toEqual([]);
  });
});

describe("parseNoteDate", () => {
  it("reads an ISO date on its wall-clock day, with no timezone shift", () => {
    const d = parseNoteDate("2026-07-14");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(6); // July, 0-based
    expect(d?.getDate()).toBe(14);
  });

  it("reads the date portion of a full ISO datetime", () => {
    const d = parseNoteDate("2026-07-14T09:30:00Z");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(6);
    expect(d?.getDate()).toBe(14);
  });

  it("returns null for missing / empty / non-string / unparseable values", () => {
    expect(parseNoteDate(undefined)).toBeNull();
    expect(parseNoteDate("")).toBeNull();
    expect(parseNoteDate("   ")).toBeNull();
    expect(parseNoteDate(12345)).toBeNull();
    expect(parseNoteDate("not a date")).toBeNull();
  });
});

describe("placeOnCalendar", () => {
  it("buckets notes by day and collects the undated separately", () => {
    const notes = [
      note("a", { meeting_date: "2026-07-14" }),
      note("b", { meeting_date: "2026-07-14T15:00:00Z" }),
      note("c", { meeting_date: "2026-07-20" }),
      note("d", {}), // no date
      note("e", { meeting_date: "garbage" }), // unparseable
    ];
    const { byDay, undated, dates } = placeOnCalendar(notes, "meeting_date");
    expect(byDay.get("2026-07-14")?.map((n) => n.id)).toEqual(["a", "b"]);
    expect(byDay.get("2026-07-20")?.map((n) => n.id)).toEqual(["c"]);
    expect(undated.map((n) => n.id)).toEqual(["d", "e"]);
    expect(dates.size).toBe(3);
  });
});

describe("defaultMonth", () => {
  it("opens on the month of the most recent dated note (1-based month)", () => {
    const dates = [new Date(2026, 2, 3), new Date(2026, 6, 20), new Date(2026, 4, 1)];
    expect(defaultMonth(dates)).toEqual({ year: 2026, month: 7 }); // July
  });

  it("falls back to the given fallback's month when nothing is dated", () => {
    expect(defaultMonth([], new Date(2025, 0, 15))).toEqual({ year: 2025, month: 1 });
  });
});
