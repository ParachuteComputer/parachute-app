import { readFileSync } from "node:fs";
import { join } from "node:path";

// The consolidated reduced-motion gate (the ONE `@media (prefers-reduced-motion:
// reduce)` block in index.css) stills every animation that bakes its own
// duration instead of consuming the zeroed --dur-* tokens. The save bar's
// pulse dot (views polish V6) is one of those — an INFINITE ambient animation
// is exactly what prefers-reduced-motion exists for, and no component test can
// see the omission (vitest runs with `css: false`). Pin it textually: the
// keyframe exists, the class consumes it, and the gate lists it.
// Not `import.meta.url` — the jsdom environment rewrites it to an http URL.
// Vitest runs from the repo root, so cwd-relative is stable.
const css = readFileSync(join(process.cwd(), "src/styles/index.css"), "utf8");

// Slice the gate block: from the media query to its `animation: none` verdict.
// LAST occurrence — an earlier standalone `reduce` block (skeleton/vault-media
// shimmer, ~:711) precedes the consolidated gate this test pins.
const gateStart = css.lastIndexOf("@media (prefers-reduced-motion: reduce)");
const gateEnd = css.indexOf("animation: none", gateStart);
const gate = gateStart === -1 || gateEnd === -1 ? "" : css.slice(gateStart, gateEnd);

describe("the reduced-motion gate (src/styles/index.css)", () => {
  it("provably found the gate block (positive control)", () => {
    expect(gateStart).toBeGreaterThan(-1);
    expect(gateEnd).toBeGreaterThan(gateStart);
    // A long-standing member — if THIS fails, the slice is wrong, not the CSS.
    expect(gate).toContain(".field-write-flash");
  });

  it("lists .view-modified-pulse — the save bar's dot stills under reduced motion", () => {
    expect(gate).toContain(".view-modified-pulse");
  });

  it("the pulse keyframe + consuming class actually exist to be gated", () => {
    expect(css).toContain("@keyframes view-modified-pulse");
    expect(css).toMatch(/\.view-modified-pulse\s*\{\s*animation: view-modified-pulse/);
  });
});
