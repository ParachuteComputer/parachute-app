import type { Note } from "@/lib/vault/types";
import { describe, expect, it } from "vitest";
import { deriveSteps, hasUserAuthoredNote, stepsComplete } from "./checklist";

const mk = (over: Partial<Note>): Note => ({
  id: over.id ?? "n",
  createdAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
  ...over,
});

describe("hasUserAuthoredNote", () => {
  it("is false for an empty / undefined vault", () => {
    expect(hasUserAuthoredNote(undefined)).toBe(false);
    expect(hasUserAuthoredNote([])).toBe(false);
  });

  it("is false when only seed guides exist", () => {
    const seeds = [
      mk({ id: "a", path: "Welcome to your vault 🪂", tags: ["guide"] }),
      mk({ id: "b", path: "Getting Started", tags: ["guide"] }),
    ];
    expect(hasUserAuthoredNote(seeds)).toBe(false);
  });

  it("ignores the app's own system notes under .parachute/", () => {
    const notes = [mk({ id: "s", path: ".parachute/notes/settings" })];
    expect(hasUserAuthoredNote(notes)).toBe(false);
  });

  it("is true once a real user note exists alongside seeds", () => {
    const notes = [
      mk({ id: "a", path: "Welcome to your vault 🪂", tags: ["guide"] }),
      mk({ id: "u", path: "My first thought", tags: ["capture"] }),
    ];
    expect(hasUserAuthoredNote(notes)).toBe(true);
  });

  it("counts an imported note the same as a typed one (W3: import folds into write)", () => {
    // deriveSteps has no separate "import" step anymore — an imported note
    // satisfies `write` exactly like a typed one, because this is the only
    // signal either ever had: a real, non-seed, non-system note exists.
    const imported = [mk({ id: "i", path: "Imported/Old note", tags: ["imported"] })];
    expect(hasUserAuthoredNote(imported)).toBe(true);
  });
});

describe("deriveSteps (state-derived — W3)", () => {
  it("is a single auto step, `write`, driven only by hasUserNote", () => {
    const steps = deriveSteps({ hasUserNote: false });
    expect(steps).toEqual([{ id: "write", done: false }]);
  });

  it("reports write done once a user note exists — no manual tick, no persisted state involved", () => {
    const steps = deriveSteps({ hasUserNote: true });
    expect(steps).toEqual([{ id: "write", done: true }]);
  });

  it("carries no `connect`, `import`, or `install` step — dropped/folded per the W3 investigation", () => {
    const steps = deriveSteps({ hasUserNote: true });
    expect(steps.map((s) => s.id)).toEqual(["write"]);
  });

  it("stepsComplete mirrors hasUserNote exactly (the only step left)", () => {
    expect(stepsComplete(deriveSteps({ hasUserNote: true }))).toBe(true);
    expect(stepsComplete(deriveSteps({ hasUserNote: false }))).toBe(false);
  });
});
