// The durable-offline mirror flag. Wave 1 ships the mirror STORE + hydration
// ENGINE + write-path upserts, but nothing READS the mirror yet (that's Wave
// 3). So with the flag on, the only observable effect is IndexedDB growth; with
// it off, every mirror code path is fully inert — no cursor traffic, no writes.
//
// Two ways to turn it on, in precedence order:
//   1. Flip `MIRROR_ENABLED_DEFAULT` to `true` (compile-time, ships on for all).
//   2. Set localStorage `parachute:mirror:enabled` to `"true"` (per-device, so a
//      dev or an eventual Settings toggle can opt a single browser in without a
//      rebuild). Read once at provider mount — a change takes effect on reload.
export const MIRROR_FLAG_KEY = "parachute:mirror:enabled";

// Wave 1 default: OFF. See the module note above.
export const MIRROR_ENABLED_DEFAULT = false;

export function isMirrorEnabled(): boolean {
  if (MIRROR_ENABLED_DEFAULT) return true;
  try {
    return localStorage.getItem(MIRROR_FLAG_KEY) === "true";
  } catch {
    // No localStorage (SSR / locked-down privacy mode) — treat as off.
    return false;
  }
}
