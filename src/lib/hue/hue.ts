// The surface-owned hue module (EDITOR-STUDY §7/§9) — a display-side mapping
// from a tag name to one of ~8 curated "garden" hues. This is the minimal
// version landed by whichever PR train reaches it first (views-wave-1, per
// VIEWS-RENDER-SPEC §9); the editor's kind-coding chips import from here
// rather than forking their own copy.
//
// Zero data change: nothing is stored, nothing is written back to a note or
// a tag's schema. A hue is recomputed from the tag name on every render —
// hand-assigned for a handful of well-known roles, deterministically hashed
// into the remaining palette for everything else, so the SAME tag always
// gets the SAME hue on every device without any coordination.
//
// Consumers: `HueDot` (the chip/row leading dot), the editor's tag-chip
// glyphs (EDITOR-STUDY §7, wave 3), and a view's header/Rail-band dot, whose
// hue comes from the view's query's primary tag (VIEWS-RENDER-SPEC §9).

export const HUE_NAMES = ["sage", "sky", "sun", "coral", "grass", "clay", "ochre", "plum"] as const;

export type HueName = (typeof HUE_NAMES)[number];

// Hand-assigned roles (EDITOR-STUDY §7): the tags an operator is most likely
// to see on day one get a considered hue rather than whatever the hash
// lands on. Matched against the BARE tag name (no leading `#`, lower-cased).
const HAND_ASSIGNED: Record<string, HueName> = {
  capture: "sage",
  voice: "clay",
  person: "ochre",
  meeting: "sky",
  dream: "plum",
};

// djb2 — small, fast, stable across platforms (no reliance on string hash
// ordering guarantees the way a Set/Map iteration would need).
function djb2(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function bareTagName(tag: string): string {
  return tag.trim().replace(/^#+/, "").toLowerCase();
}

/**
 * Resolve a tag name to its hue. Returns `null` for an empty/absent tag —
 * callers render no dot at all in that case (a view with no subject tag
 * stays neutral, VIEWS-RENDER-SPEC §9), not a default hue.
 */
export function hueForTag(tag: string | null | undefined): HueName | null {
  if (!tag) return null;
  const bare = bareTagName(tag);
  if (!bare) return null;
  const assigned = HAND_ASSIGNED[bare];
  if (assigned) return assigned;
  return HUE_NAMES[djb2(bare) % HUE_NAMES.length];
}
