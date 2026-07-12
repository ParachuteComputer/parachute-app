/**
 * The SET UP shelf's "hide this for now" affordance (Wave-3 rework).
 *
 * Deliberately in-memory only — no localStorage, no per-vault persistence.
 * Before this rework, dismissing the shelf wrote a `dismissed` flag to a
 * per-device localStorage blob, which is exactly the bug this wave closes:
 * an established account looks un-onboarded (and un-dismissed) on a fresh
 * browser. The shelf's actual visibility is state-derived (`deriveSteps` in
 * `./checklist`, fed by live vault signals) — it naturally stops rendering
 * once the tracked step is done, on every device, with nothing to persist.
 *
 * What this hook still does: let the user hide the shelf for the rest of
 * THIS visit without lying about it later. Reload the page, revisit the
 * lens, or switch to another vault, and it re-evaluates fresh — if the vault
 * is still genuinely unonboarded, the guidance is honestly still there next
 * time, not one localStorage write away from vanishing forever on a vault
 * that never got past step one.
 */

import { useCallback, useState } from "react";

export interface UseHomeChecklist {
  /** Hidden for the rest of this mount — never persisted. */
  dismissed: boolean;
  /** Hide the shelf for the rest of this session. */
  dismiss: () => void;
}

export function useHomeChecklist(vaultId: string | null): UseHomeChecklist {
  const [dismissed, setDismissed] = useState(false);
  // Reset on a vault switch — "adjusting state during render" (not an
  // effect): dismissing vault A's nudge must never carry over and silently
  // hide vault B's real unfinished guidance. Tracking the last-seen vaultId
  // alongside `dismissed` lets the reset happen synchronously, in the same
  // render the switch shows up in, rather than flashing the stale dismissed
  // state for one frame before an effect catches up.
  const [lastVaultId, setLastVaultId] = useState(vaultId);
  if (vaultId !== lastVaultId) {
    setLastVaultId(vaultId);
    setDismissed(false);
  }

  const dismiss = useCallback(() => setDismissed(true), []);

  return { dismissed, dismiss };
}
