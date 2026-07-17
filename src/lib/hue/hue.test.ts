import { describe, expect, it } from "vitest";
import { HUE_NAMES, hueForTag } from "./hue";

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
