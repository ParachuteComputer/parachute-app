import { storedFromTokenResponse } from "@/lib/vault";
import { saveServicesCatalog } from "@/lib/vault/storage";
import { useVaultStore } from "@/lib/vault/store";
import type { TokenResponse } from "@/lib/vault/types";
import { SessionExpiredError, createVault, getSession, mintVaultToken } from "./client";
import { saveAccountToken } from "./store";
import { useAccountSessionStore } from "./store";

type Fetch = typeof fetch;

/**
 * The HOME DOOR is the app's own serving origin — NOT a hardcoded cloud host.
 * The app is served BY a door (cloud at app.parachute.computer today; a user's
 * own hub tomorrow) and is same-origin with it. So the account API is relative
 * (see client.ts) and a home-door vault's issuer is `window.location.origin` —
 * the same code runs served by cloud or by a hub, with zero cloud coupling. The
 * only place an explicit origin appears is the cross-origin `/add` connect path
 * (a parachute that ISN'T your home door), which keeps its OAuth.
 */
function homeDoorOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

/**
 * Sentinel client_id for home-door VaultRecords. These are NOT OAuth clients —
 * their per-vault tokens are re-minted from the session cookie (see
 * `remintHostedVault`), not refreshed via a token endpoint. The field is
 * required by VaultRecord; this marks the record as home-door-minted so the
 * OAuth refresh path is never taken for it.
 */
export const HOSTED_CLIENT_ID = "home-door";

/** Is this vault minted via the account session (home door), not OAuth? */
export function isHostedVaultRecord(clientId: string): boolean {
  return clientId === HOSTED_CLIENT_ID;
}

/**
 * Resolve the vault's REST URL from the C3 token's services catalog. The HOME
 * DOOR is authoritative about where its vaults live (cloud → u.parachute.computer;
 * a hub → the hub's own vault URL) — the app must not assume a cloud host, so
 * there is NO hardcoded fallback. A C3 response without a services URL is a
 * contract violation (the door must carry `services.vault.url` or the per-vault
 * key); surface it loudly rather than fabricate a wrong origin.
 */
function vaultUrlFromToken(token: TokenResponse, name: string): string {
  const perVaultKey = token.vault ? `vault:${token.vault}` : `vault:${name}`;
  const url = token.services?.[perVaultKey]?.url ?? token.services?.vault?.url;
  if (!url) {
    throw new Error(
      `Home-door token for vault "${name}" is missing services.vault.url — the account door's per-vault mint (C3) must carry the vault's REST URL in its services catalog.`,
    );
  }
  return url;
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
      // The home door is the serving origin — never a hardcoded cloud host.
      issuer: homeDoorOrigin(),
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
