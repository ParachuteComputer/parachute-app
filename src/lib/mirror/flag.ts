// The durable-offline mirror flag. Waves 1-4 shipped the full mirror — store,
// hydration engine, write-path upserts, local-first reads, deletes-reconcile,
// staleness UX, storage ceiling, and Settings controls — all behind this flag.
// It is now ON by default: a fresh browser hydrates its vault into IndexedDB
// and serves reads local-first.
//
// The localStorage `parachute:mirror:enabled` override still works per-device,
// and now cuts BOTH ways (read once at provider mount — a change takes effect on
// reload):
//   - `"false"` forces the mirror OFF on this browser (opt-out without a rebuild).
//   - `"true"`  forces it ON (redundant with the default today; kept for parity).
// With neither key set, `MIRROR_ENABLED_DEFAULT` decides.
export const MIRROR_FLAG_KEY = "parachute:mirror:enabled";

// Activation default: ON. The mirror ships engaged for every browser.
export const MIRROR_ENABLED_DEFAULT = true;

export function isMirrorEnabled(): boolean {
  try {
    const override = localStorage.getItem(MIRROR_FLAG_KEY);
    if (override === "true") return true;
    if (override === "false") return false;
  } catch {
    // No localStorage (SSR / locked-down privacy mode) — fall through to the
    // compile-time default.
  }
  return MIRROR_ENABLED_DEFAULT;
}
