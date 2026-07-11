import { storedFromTokenResponse } from "@/lib/vault";
import { saveServicesCatalog } from "@/lib/vault/storage";
import { useVaultStore } from "@/lib/vault/store";
import type { TokenResponse } from "@/lib/vault/types";
import { SessionExpiredError, createVault, getSession, mintVaultToken } from "./client";
import { saveAccountToken } from "./store";
import { useAccountSessionStore } from "./store";

type Fetch = typeof fetch;

/** The hosted account issuer (Cloud). */
export const HOSTED_ACCOUNT_ISSUER = "https://cloud.parachute.computer";
/** Where hosted vaults live: u.parachute.computer/vault/<name>. */
export const HOSTED_VAULT_ORIGIN = "https://u.parachute.computer";
/**
 * Sentinel client_id for hosted VaultRecords. Hosted vaults are NOT OAuth
 * clients — their per-vault tokens are re-minted from the session cookie (see
 * `remintHostedVault`), not refreshed via a token endpoint. The field is
 * required by VaultRecord; this marks the record as hosted so the OAuth refresh
 * path is never taken for it.
 */
export const HOSTED_CLIENT_ID = "cloud-account";

/** Is this vault a hosted (Cloud) one, minted via the account session? */
export function isHostedVaultRecord(clientId: string): boolean {
  return clientId === HOSTED_CLIENT_ID;
}

function vaultUrlFromToken(token: TokenResponse, name: string): string {
  const perVaultKey = token.vault ? `vault:${token.vault}` : `vault:${name}`;
  return (
    token.services?.[perVaultKey]?.url ??
    token.services?.vault?.url ??
    `${HOSTED_VAULT_ORIGIN}/vault/${encodeURIComponent(name)}`
  );
}

/**
 * Mint a per-vault token (C3) for an existing hosted vault and store it as the
 * active VaultRecord — reuses the notes layer's `addVault` unchanged (the C3
 * response is TokenResponse-shaped). Returns the local vault id.
 */
export async function openHostedVault(
  name: string,
  csrf: string,
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<string> {
  const token = await mintVaultToken(name, csrf, fetchImpl);
  const url = vaultUrlFromToken(token, name);
  const id = useVaultStore.getState().addVault(
    {
      url,
      name: token.vault ?? name,
      issuer: HOSTED_ACCOUNT_ISSUER,
      clientId: HOSTED_CLIENT_ID,
      scope: token.scope,
    },
    storedFromTokenResponse(token),
  );
  if (token.services) saveServicesCatalog(id, token.services);
  return id;
}

/**
 * Create a brand-new hosted vault (immutable slug) then open it. The naming
 * onboarding + add-vault chooser call this.
 */
export async function createHostedVault(
  name: string,
  csrf: string,
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<string> {
  await createVault(name, csrf, fetchImpl);
  return openHostedVault(name, csrf, fetchImpl);
}

/**
 * Re-mint the active hosted vault's token from the still-valid session cookie
 * (the "sign in again to keep syncing" recovery). Re-reads the session for a
 * fresh CSRF, re-mints C3, and updates the stored token in place. On a 401 the
 * session itself is gone → surface the non-blocking banner and let the person
 * re-sign-in from the front door.
 */
export async function remintHostedVault(
  name: string,
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<string> {
  try {
    const session = await getSession(fetchImpl);
    if (!session.signed_in) {
      useAccountSessionStore.getState().markExpired();
      throw new SessionExpiredError();
    }
    const id = await openHostedVault(name, session.csrf, fetchImpl);
    useAccountSessionStore.getState().clearExpired();
    return id;
  } catch (err) {
    if (err instanceof SessionExpiredError) useAccountSessionStore.getState().markExpired();
    throw err;
  }
}

// Best-effort helper for a full sign-out: the caller clears local vaults; here
// we just drop the account token. Re-exported for convenience.
export { saveAccountToken };
