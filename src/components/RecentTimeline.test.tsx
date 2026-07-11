import { groupNotesByDay } from "@/components/RecentTimeline";
import type { Note } from "@/lib/vault/types";
import { describe, expect, it } from "vitest";

// groupNotesByDay used to be re-exported from the Today route for its own
// unit test's convenience; W2-3 (F8) removed that route's front-door
// timeline (folded into Home), so this test now sits next to the function it
// actually tests.

describe("groupNotesByDay", () => {
  // Build local-time timestamps at noon so day bucketing is host-timezone
  // stable (the keys are local dates, matching the calendar surfaces).
  const mk = (id: string, month: number, day: number, hour = 12): Note => {
    const ts = new Date(2026, month - 1, day, hour).toISOString();
    return { id, createdAt: ts, updatedAt: ts };
  };

  it("buckets by the updated day and sorts days newest-first", () => {
    const groups = groupNotesByDay([mk("a", 4, 15, 10), mk("b", 4, 17, 10), mk("c", 4, 17, 8)]);
    expect(groups.map((g) => g.key)).toEqual(["2026-04-17", "2026-04-15"]);
    // Within a day, newest-first.
    expect(groups[0]?.notes.map((n) => n.id)).toEqual(["b", "c"]);
  });

  it("skips notes with an unparseable date", () => {
    const groups = groupNotesByDay([{ id: "a", createdAt: "not-a-date", updatedAt: "not-a-date" }]);
    expect(groups).toEqual([]);
  });
});
