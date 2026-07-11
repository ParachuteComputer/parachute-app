import { useQuery } from "@tanstack/react-query";
import { getAccountSummary } from "./client";
import type { AccountSummary } from "./types";

/**
 * The shared account-summary hook (DESIGN-SPEC §2.4) — ONE TanStack query over
 * `GET /account/summary` for every plan/trial consumer: the vault switcher
 * (vault-limit upsell + trial foot line), the rail's Account badge (W2-5),
 * `/account`, and the Today trial nudge (W2-8). Sharing the query key means
 * they all read the same cached answer instead of racing four fetches.
 *
 * LAZY by design — it never gates first paint. Consumers pass `enabled` for
 * their own moment of need (the switcher enables it only while its panel is
 * open). `getAccountSummary` already seams every failure mode to `null`
 * (signed out, self-host door with no summary endpoint, network) so the data
 * shape is simply "a summary, or nothing honest to show" — callers render
 * plan-aware UI only when a summary is present and degrade to today's
 * behavior otherwise. `staleTime` 5 min: plan/trial state moves at
 * billing-cadence, not keystroke-cadence.
 */
export const ACCOUNT_SUMMARY_QUERY_KEY = ["account", "summary"] as const;

export function useAccountSummary(opts: { enabled?: boolean } = {}) {
  return useQuery<AccountSummary | null>({
    queryKey: ACCOUNT_SUMMARY_QUERY_KEY,
    queryFn: () => getAccountSummary(),
    staleTime: 5 * 60_000,
    enabled: opts.enabled ?? true,
  });
}
