import { describe, expect, it } from "vitest";
import { HUE_NAMES, hueForEnumValue, hueForTag } from "./hue";

describe("hueForTag", () => {
  it("returns null for an absent/empty tag — neutral, not a default hue", () => {
    expect(hueForTag(undefined)).toBeNull();
    expect(hueForTag(null)).toBeNull();
    expect(hueForTag("")).toBeNull();
    expect(hueForTag("   ")).toBeNull();
  });

  it("hand-assigns the known roles from EDITOR-STUDY §7", () => {
    expect(hueForTag("capture")).toBe("sage");
    expect(hueForTag("voice")).toBe("clay");
    expect(hueForTag("person")).toBe("ochre");
    expect(hueForTag("meeting")).toBe("sky");
    expect(hueForTag("dream")).toBe("plum");
  });

  it("normalizes a leading # and case before matching", () => {
    expect(hueForTag("#capture")).toBe("sage");
    expect(hueForTag("Capture")).toBe("sage");
    expect(hueForTag("  #Meeting  ")).toBe("sky");
  });

  it("is deterministic for an unassigned tag — same name, same hue, every call", () => {
    const first = hueForTag("project");
    for (let i = 0; i < 20; i++) {
      expect(hueForTag("project")).toBe(first);
    }
    expect(HUE_NAMES).toContain(first);
  });

  it("hashes different unassigned tags across the palette, not all onto one hue", () => {
    const seen = new Set(
      ["project", "journal", "recipe", "wine", "budget", "travel", "gear", "garden"].map((t) =>
        hueForTag(t),
      ),
    );
    // Not asserting a specific distribution (hash-dependent) — just that the
    // hash isn't degenerately collapsing everything onto one hue.
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("hueForEnumValue", () => {
  it("hand-assigns done-ish states to grass", () => {
    for (const v of ["done", "complete", "completed", "shipped", "closed"]) {
      expect(hueForEnumValue(v)).toBe("grass");
    }
  });

  it("hand-assigns active-ish states to sun", () => {
    for (const v of ["in progress", "active", "doing"]) {
      expect(hueForEnumValue(v)).toBe("sun");
    }
    // "active" would hash to plum — the hand assignment must win.
  });

  it("hand-assigns blocked-ish states to the semantic danger token", () => {
    for (const v of ["blocked", "urgent", "critical"]) {
      expect(hueForEnumValue(v)).toBe("danger");
    }
    // "danger" is the app's alarm color, NOT a garden hue.
    expect(HUE_NAMES).not.toContain("danger");
  });

  it("normalizes case, hyphens, underscores, and whitespace before matching", () => {
    expect(hueForEnumValue("Done")).toBe("grass");
    expect(hueForEnumValue("  DONE  ")).toBe("grass");
    expect(hueForEnumValue("In Progress")).toBe("sun");
    expect(hueForEnumValue("in-progress")).toBe("sun");
    expect(hueForEnumValue("in_progress")).toBe("sun");
    expect(hueForEnumValue("IN   PROGRESS")).toBe("sun");
    expect(hueForEnumValue("Blocked")).toBe("danger");
  });

  it("is deterministic for an unassigned value — same value, same hue, every call", () => {
    const first = hueForEnumValue("someday");
    for (let i = 0; i < 20; i++) {
      expect(hueForEnumValue("someday")).toBe(first);
    }
    expect(HUE_NAMES).toContain(first);
  });

  it("normalization feeds the hash too — 'High' and 'high' share a hue", () => {
    expect(hueForEnumValue("High")).toBe(hueForEnumValue("high"));
    expect(hueForEnumValue("  high ")).toBe(hueForEnumValue("high"));
  });

  it("pins the hash's value→hue pairs — a silent hash/palette change breaks stability", () => {
    // These are djb2(value) % 8 into HUE_NAMES as of polish V2. They are a
    // COMPATIBILITY surface: users learn "High is clay" across every view
    // with zero storage, so a change here is a visible break, not a refactor.
    expect(hueForEnumValue("high")).toBe("clay");
    expect(hueForEnumValue("todo")).toBe("coral");
    expect(hueForEnumValue("backlog")).toBe("sage");
  });
});
