import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "./store";
import type { VaultRecord } from "./types";

/**
 * The switch-confirmation rule (DESIGN-SPEC §4.4, WALK-manager #2): every path
 * that changes the active vault confirms with a "Now in {vault}" toast — the
 * switcher rows, /vaults' Make active, the picker, the creation ceremony's
 * Open, the welcome-back auto-open, an OAuth connect landing. One
 * implementation point, so no call site sprinkles its own toast copy.
 */

/**
 * A vault's display label — its name, else its URL's host, else the raw URL.
 * Shared by the switcher rows, the rail trigger, and the switch toast so the
 * identity a person reads is the identity the toast confirms.
 */
export function vaultDisplayLabel(v: Pick<VaultRecord, "name" | "url">): string {
  if (v.name) return v.name;
  try {
    return new URL(v.url).host;
  } catch {
    return v.url;
  }
}

/**
 * Announce an activation that already happened (the hosted-open paths:
 * `openHostedVault` activates inside `addVault`, so callers confirm after the
 * await). Deliberately NOT baked into `openHostedVault` itself — the
 * token-refresh path (`remintHostedVault`) re-opens the SAME vault in the
 * background and must never announce a switch that didn't happen.
 */
export function announceVaultSwitch(label: string): void {
  useToastStore.getState().push(`Now in ${label}`, "success");
}

/**
 * Switch the active vault by local id and confirm with the toast (on by
 * default — silence is the exception, not the rule). No-op announce when the
 * vault is already active (nothing changed, nothing to confirm) or the id is
 * unknown (returns false; the store is left untouched).
 */
export function switchVault(id: string, opts: { toast?: boolean } = {}): boolean {
  const store = useVaultStore.getState();
  const record = store.vaults[id];
  if (!record) return false;
  const alreadyActive = store.activeVaultId === id;
  store.setActiveVault(id);
  if ((opts.toast ?? true) && !alreadyActive) {
    announceVaultSwitch(vaultDisplayLabel(record));
  }
  return true;
}
