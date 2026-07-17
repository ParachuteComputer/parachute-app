// Mirrors vault `core/src/seed-packs.ts:884-887` — the four default-page view
// paths the opt-in `starter-ontology` pack seeds (VIEWS-RENDER-SPEC §0/§6).
// The vault doesn't publish these as an importable package this app depends
// on, so they're mirrored as literals with this lockstep comment (the same
// pattern §7 prescribes for `useDefaultViewDef`): if vault renames a seed
// path, this list drifts until someone notices — acceptable for wave 1,
// where the only consumer is the Rail band's dedup (excluding a shipped
// default from also showing up as a plain view row), not the wave-2
// default-page cutover itself.
export const DEFAULT_VIEW_PATHS: readonly string[] = [
  "Views/All notes",
  "Views/Recent",
  "Views/Pinned",
  "Views/Archive",
];

// The canonical path prefix new views are created under (VIEWS-RENDER-SPEC
// §6 creation flow) — distinct from the legacy saved-views prefix
// (`UI/Views/`, `src/lib/saved-views/spec.ts`), which stays read-only going
// forward (§8: read forever, write forward).
export const VIEWS_PATH_PREFIX = "Views/";

export function viewPathForName(name: string): string {
  const safe = name.trim().replace(/[/\\]/g, "-");
  return `${VIEWS_PATH_PREFIX}${safe || "Untitled view"}`;
}
