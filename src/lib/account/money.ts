/**
 * The money story (T-318, Aaron 10-29: "Parachute open beta"). Cloud reports
 * its money switch as `billing_mode` on `GET /account/summary` and on the door
 * descriptor; "open_beta" means: free for now, no trial clock, nothing to buy.
 *
 * The canonical strings live here rather than being rendered from the door's
 * `money_story` / `money_line` fields: those are untrusted input from a door we
 * may not control, and the copy is a shared contract (the same words as cloud's
 * console, signup and terms).
 *
 * A door that doesn't send `billing_mode` (an older cloud, or a self-hosted hub,
 * which serves no summary at all) keeps exactly its pre-T-318 rendering.
 */
import type { DoorDescriptor } from "./descriptor";
import type { AccountSummary } from "./types";

export const OPEN_BETA_SHORT = "Free during the open beta.";
export const OPEN_BETA_LONG =
  "Parachute is in open beta, and it's free for now. Before any paid plan, we'll tell you well ahead, and everyone already here gets notice and a fair path.";

/** The account summary says this is the free open beta. */
export function isOpenBeta(summary: AccountSummary | null | undefined): boolean {
  return summary?.billing_mode === "open_beta";
}

/** The door descriptor says this is the free open beta. */
export function isOpenBetaDoor(descriptor: DoorDescriptor | null | undefined): boolean {
  return descriptor?.billing_mode === "open_beta";
}

/**
 * The trial countdown to show, or null. Never a countdown in open beta — even
 * if a door sent one — so no chip, nudge or "(90d)" can render there. Every
 * ambient trial surface (rail chip, switcher foot, Recent nudge, Account chip)
 * reads through this.
 */
export function trialDaysLeftOf(summary: AccountSummary | null | undefined): number | null {
  if (!summary || isOpenBeta(summary)) return null;
  const days = summary.plan?.trial_days_left;
  return typeof days === "number" ? days : null;
}
