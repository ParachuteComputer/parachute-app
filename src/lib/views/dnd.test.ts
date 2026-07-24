import { hasNoteDrag, isFinePointer, readNoteDragId, setNoteDragData } from "@/lib/views/dnd";
import { makeDataTransfer, stubPointer } from "@/test/dnd";
import { describe, expect, it } from "vitest";

// The pure half of the desktop-drag module (views train E) — payload stamping,
// foreign-drag sniffing, pointer gating. The hook/component behavior (drop
// writes, hover state, click suppression) is exercised through the board and
// calendar dnd tests.

describe("note drag payload", () => {
  it("round-trips the note id under the custom MIME type with move semantics", () => {
    const dt = makeDataTransfer();
    setNoteDragData(dt, "note-1");
    expect(dt.effectAllowed).toBe("move");
    expect(hasNoteDrag(dt)).toBe(true);
    expect(readNoteDragId(dt)).toBe("note-1");
  });

  it("ignores foreign drags — text/plain or files never read as a note", () => {
    const dt = makeDataTransfer();
    dt.setData("text/plain", "not a note");
    expect(hasNoteDrag(dt)).toBe(false);
    expect(readNoteDragId(dt)).toBe(null);
  });

  it("tolerates a missing dataTransfer entirely", () => {
    expect(hasNoteDrag(null)).toBe(false);
    expect(readNoteDragId(null)).toBe(null);
  });
});

describe("isFinePointer", () => {
  it("is false on the jsdom baseline (no usable matchMedia) — no drag affordance", () => {
    expect(isFinePointer()).toBe(false);
  });

  it("is true on a fine-pointer (desktop) device", () => {
    const restore = stubPointer("fine");
    expect(isFinePointer()).toBe(true);
    restore();
  });

  it("is false on a coarse-pointer (touch) device", () => {
    const restore = stubPointer("coarse");
    expect(isFinePointer()).toBe(false);
    restore();
  });
});
