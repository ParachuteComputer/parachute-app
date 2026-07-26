/**
 * The "write your first note" boolean, as a BOUNDED existence check
 * (app#110 Finding B, piece 1).
 *
 * Before this hook, the nav model computed `hasUserAuthoredNote` by running
 * `useNotesForDateViews` — a permanent full-vault live subscription
 * (limit=5000, ~1.25 MiB at 2.6k notes) — to keep re-deriving a `.some()`
 * that, once true, can never go false in normal use. An onboarded vault
 * streamed itself forever to recompute `true`.
 *
 * The check here asks the server the actual question. `exclude_tag=guide`
 * pushes the seed-content half of the predicate server-side; the system-note
 * half (`.parachute/` paths) CANNOT be pushed — the REST grammar has no path
 * exclusion (`path_prefix` is positive-only) — so each page is re-filtered
 * client-side through the same `hasUserAuthoredNote` the shelf has always
 * used. One predicate definition, two layers applying what they can.
 *
 * Why not `limit=1`: the app's own settings note (`.parachute/notes/settings`,
 * rewritten by tag-roles on settings changes) is not a `#guide` note and is
 * *recently touched* on exactly the vaults that aren't onboarded yet — so a
 * single-row probe would return it first and report "onboarded" on a vault
 * the user never wrote in. Hence the page walk: a page containing a
 * qualifying note answers true; a SHORT page ends the set and answers false;
 * a full page of nothing-but-system-rows pages forward. In practice page 1
 * decides — the app writes exactly one system note — the walk is correctness
 * insurance, not a hot path. (vault#628 tracks a path-exclusion param; when
 * it ships this collapses to a pure `limit=1` server round-trip.)
 *
 * No latch, no persistence: the answer is recomputed from the vault, so a
 * fresh browser reads the same truth as the device that onboarded (the W3
 * property, kept). Liveness trade, same shape #114 ratified: an in-app first
 * note completes the shelf immediately (`useCreateNote` invalidates this
 * key); a first note written from OUTSIDE the app lands on staleTime/focus
 * refetch instead of a socket push — fine for a setup shelf.
 */

import { useActiveVaultClient, useVaultStore } from "@/lib/vault";
import type { VaultClient } from "@/lib/vault";
import { useQuery } from "@tanstack/react-query";
import { SEED_GUIDE_TAG, hasUserAuthoredNote } from "./checklist";

/** Page size for the walk. Big enough that page 1 decides on any real vault
 * (system notes number ~1), small enough that the probe stays ~12 KB worst
 * case per page instead of the 1.25 MiB the stream cost. */
export const HAS_USER_NOTE_PAGE = 25;

/**
 * Walk `exclude_tag=guide` pages (newest first) until a page holds a note
 * passing the full client predicate (→ true) or a short page ends the set
 * (→ false). Exported for direct unit-testing with a stub client.
 */
export async function probeHasUserAuthoredNote(client: VaultClient): Promise<boolean> {
  for (let offset = 0; ; offset += HAS_USER_NOTE_PAGE) {
    const p = new URLSearchParams();
    p.set("exclude_tag", SEED_GUIDE_TAG);
    p.set("sort", "desc");
    p.set("limit", String(HAS_USER_NOTE_PAGE));
    p.set("include_content", "false");
    if (offset > 0) p.set("offset", String(offset));
    const page = await client.queryNotes(p);
    if (hasUserAuthoredNote(page)) return true;
    if (page.length < HAS_USER_NOTE_PAGE) return false;
  }
}

/**
 * The boolean, cached per vault. Three-valued on purpose: `data` is `true`
 * (onboarded), `false` (genuinely no user note — show the shelf), or
 * `undefined` (pending / offline — UNKNOWN). Consumers must treat undefined
 * as "don't nag": the old stream had a mirror seed so an onboarded vault
 * never flashed the Set-up band on a cold offline launch, and collapsing
 * unknown into false would regress exactly that.
 */
export function useHasUserAuthoredNote() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);

  return useQuery({
    queryKey: ["hasUserAuthoredNote", activeId],
    enabled: !!client,
    queryFn: () => probeHasUserAuthoredNote(client!),
    staleTime: 60_000,
  });
}
