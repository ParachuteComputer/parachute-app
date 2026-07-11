import { saveServicesCatalog } from "@/lib/vault/storage";
import { useVaultStore } from "@/lib/vault/store";
import type { ServicesCatalog, StoredToken } from "@/lib/vault/types";
import { SessionExpiredError, createVault, getSession, mintVaultToken } from "./client";
import { saveAccountToken } from "./store";
import { useAccountSessionStore } from "./store";
import type { VaultTokenResponse } from "./types";

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
 * Resolve the vault's REST URL from the C3 services catalog. The HOME DOOR is
 * authoritative about where its vaults live (cloud → u.parachute.computer; a hub
 * → the hub's own vault URL) — the app must not assume a cloud host, so there is
 * NO hardcoded fallback. Cloud's `buildServicesCatalog` emits both
 * `services["vault:<name>"]` and the collapsed `services.vault`. A response
 * without either is a contract violation; surface it loudly.
 */
function vaultUrlFromServices(services: ServicesCatalog | undefined, name: string): string {
  const url = services?.[`vault:${name}`]?.url ?? services?.vault?.url;
  if (!url) {
    throw new Error(
      `Home-door token for vault "${name}" is missing services.vault.url — the account door must carry the vault's REST URL in its services catalog.`,
    );
  }
  return url;
}

/**
 * Map cloud's per-vault token response (`{ vault_token, expires_at, services }`)
 * into a notes-layer `StoredToken`. Cloud does NOT echo the scope on the token
 * response, so we set it to what the mint grants (read+write); `vault` is the
 * name. `expires_at` is ISO-8601 → absolute ms.
 */
function storedFromVaultToken(resp: VaultTokenResponse, name: string): StoredToken {
  const parsed = resp.expires_at ? Date.parse(resp.expires_at) : Number.NaN;
  return {
    accessToken: resp.vault_token,
    scope: `vault:${name}:read vault:${name}:write`,
    vault: name,
    ...(Number.isFinite(parsed) ? { expiresAt: parsed } : {}),
  };
}

/** Store a home-door vault token response as the active VaultRecord. */
function storeHomeDoorVault(name: string, resp: VaultTokenResponse): string {
  const url = vaultUrlFromServices(resp.services, name);
  const id = useVaultStore.getState().addVault(
    {
      url,
      name,
      // The home door is the serving origin — never a hardcoded cloud host.
      issuer: homeDoorOrigin(),
      clientId: HOSTED_CLIENT_ID,
      scope: `vault:${name}:read vault:${name}:write`,
    },
    storedFromVaultToken(resp, name),
  );
  if (resp.services) saveServicesCatalog(id, resp.services);
  return id;
}

/**
 * Mint a per-vault token (C3) for an existing hosted vault and store it as the
 * active VaultRecord. Returns the local vault id.
 */
export async function openHostedVault(
  name: string,
  csrf: string,
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<string> {
  const resp = await mintVaultToken(name, csrf, fetchImpl);
  return storeHomeDoorVault(name, resp);
}

/**
 * Create a brand-new hosted vault (immutable slug). Cloud's create returns a
 * ready-to-use per-vault token inline (the "land you IN the vault" hinge), so we
 * store it directly — no second C3 round-trip. If a future door omits the inline
 * token, fall back to an explicit C3 mint.
 */
export async function createHostedVault(
  name: string,
  csrf: string,
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<string> {
  const created = await createVault(name, csrf, fetchImpl);
  const vaultName = created.name || name;
  if (created.vault_token && created.services) {
    return storeHomeDoorVault(vaultName, {
      vault_token: created.vault_token,
      services: created.services,
    });
  }
  return openHostedVault(vaultName, csrf, fetchImpl);
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
