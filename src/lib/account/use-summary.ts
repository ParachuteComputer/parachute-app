import { useQuery } from "@tanstack/react-query";
import { type AccountSummaryState, getAccountSummaryState } from "./client";
import { useAccountSessionStore } from "./store";
import type { AccountSummary } from "./types";

/**
 * The shared account-summary hook (DESIGN-SPEC §2.4) — ONE TanStack query over
 * `GET /account/summary` for every plan/trial consumer: the vault switcher
 * (vault-limit upsell + trial foot line), the rail/sheet's Account badge
 * (W2-5), `/account`'s Plan & billing card (W2-8), Home's PlanBacklink and the
 * Recent-lens trial nudge (W2-8). Sharing the query key means they all read the same
 * cached answer instead of racing fetches.
 *
 * LAZY by design — it never gates first paint. Consumers pass `enabled` for
 * their own moment of need (the switcher enables it only while its panel is
 * open; Home only for a hosted vault).
 *
 * The data is the TRI-STATE `AccountSummaryState` (client.ts): a summary, or
 * `null` (the door serves no summary — absent), or `"error"` (a transient
 * failure). The sentinel is a VALUE, not a thrown error, so the query itself
 * always "succeeds" and TanStack's retry/error machinery stays out of the
 * picture. Ambient consumers should read through `summaryOrNull` — a chip has
 * no retry affordance, so failed and absent look the same to them. `/account`
 * reads the raw state and renders the retry card on `"error"` (WALK-manager
 * #1: a hiccup must never silently vanish the plan).
 *
 * `staleTime`: 5 min for a real answer (plan/trial state moves at
 * billing-cadence, not keystroke-cadence) but 0 for `"error"` — a failure is
 * never worth caching, so the next consumer mount refetches and transient
 * blips self-heal.
 */
export const ACCOUNT_SUMMARY_QUERY_KEY = ["account", "summary"] as const;

/** Ambient read: collapse the tri-state to "a summary, or nothing to show". */
export function summaryOrNull(state: AccountSummaryState | undefined): AccountSummary | null {
  return state === undefined || state === "error" ? null : state;
}

export function useAccountSummary(opts: { enabled?: boolean } = {}) {
  // AUTH-W2 move 2: `identityEpoch` folds into the query key so an account
  // switch (client.ts `reconcileIdentity`) hands every consumer a FRESH query
  // — no stale summary cached under the old identity, no manual invalidation
  // to remember at each call site.
  const identityEpoch = useAccountSessionStore((s) => s.identityEpoch);
  return useQuery<AccountSummaryState>({
    queryKey: [...ACCOUNT_SUMMARY_QUERY_KEY, identityEpoch],
    queryFn: () => getAccountSummaryState(),
    staleTime: (query) => (query.state.data === "error" ? 0 : 5 * 60_000),
    enabled: opts.enabled ?? true,
  });
}
