/**
 * The hosted account (Cloud) API — wire shapes.
 *
 * The app is the account MANAGER (SYNTHESIS "The shape"): after magic-link
 * sign-in the app holds a same-origin session cookie and mints a full account
 * token, then drives everything (create/open/list vaults, plan/usage) through
 * `/account/*` and `/auth/*` on the SAME origin (app.parachute.computer
 * post-cutover). No OAuth for the hosted path — OAuth stays for `/add`
 * (self-hosted) only.
 *
 * ⚠ CONTRACT-OF-RECORD FOR THE APP SIDE. Cloud's G1–G5 are built in parallel;
 * these are the exact shapes the app consumes, so cloud should be pinned to
 * them (the "don't let two impls guess a cross-repo interface" rule). Fields
 * Every response shape below is VERIFIED against cloud's merged source
 * (workers/identity/src/account-api.ts + account-token.ts).
 */

import type { ServicesCatalog } from "@/lib/vault/types";

/** `GET /account/session` — the boot oracle. Cheap; cookie-authed. */
export interface AccountSession {
  /** True once the session cookie is valid (post magic-link verify). */
  signed_in: boolean;
  /**
   * CSRF token for the subsequent state-changing POSTs. Returned on BOTH
   * branches (G2: anonymous CSRF on the signed-out branch too, so `/auth/magic`
   * can be a same-origin JSON POST).
   */
  csrf: string;
  /** Signed-in branch only (G1) — powers "Signed in as X". */
  email?: string;
  /**
   * Signed-in branch (G1, shipped), ISO-8601. There is NO `is_new` flag — the
   * authoritative new-account signal is `GET /account/vaults == []` (that's what
   * routes to first-vault). `account_created_at` is only for the warmth of the
   * "Account created ✓" cue (recently-created ⇒ fresh sign-up).
   */
  account_created_at?: string;
}

/**
 * Usage for one vault — cloud's real shape (account-api.ts): BYTES only,
 * nullable. There is NO note-count field on this endpoint, so the UI shows size
 * only (a note count would be a future cloud addition).
 */
export interface AccountVaultUsage {
  notes_bytes?: number;
  attachment_bytes?: number;
}

/** One row of `GET /account/vaults` (cloud account-api.ts). */
export interface AccountVault {
  /** The immutable slug. */
  name: string;
  /** Full vault REST URL (cloud's field name is `url`). */
  url?: string;
  /** BYTES only, nullable (see AccountVaultUsage). */
  usage?: AccountVaultUsage | null;
  /** ISO-8601. */
  created_at?: string;
}

/** `GET /account/vaults` — cloud returns ONLY `{ vaults }` (no plan summary;
 *  a plan/usage summary is a future account-manager endpoint — PR-2 seam). */
export interface AccountVaultsResponse {
  vaults: AccountVault[];
}

/**
 * `POST /account/vaults` (cloud account-api.ts) — creates a vault AND returns a
 * ready-to-use per-vault token inline (the "land you IN the vault, no extra
 * round-trip" hinge), so `createHostedVault` stores it directly.
 * VERIFIED against cloud source: `{ name, url, vault_token, services }`.
 */
export interface CreateVaultResponse {
  name: string;
  url?: string;
  /** The per-vault token STRING (not RFC-6749 `access_token`). */
  vault_token?: string;
  services?: ServicesCatalog;
}

/**
 * `POST /account/vaults/<name>/token` (C3) — mints a per-vault token.
 * VERIFIED against cloud: `{ vault_token, expires_at, services }`. NOTE it is
 * NOT the OAuth `TokenResponse` shape — the token is `vault_token` (a string),
 * `expires_at` is an ISO-8601 string, and there is no top-level `scope`/`vault`
 * (the app derives scope = `vault:<name>:{read,write}`; vault = the name). The
 * `services` catalog carries `services["vault:<name>"].url` + `services.vault.url`.
 */
export interface VaultTokenResponse {
  vault_token: string;
  /** ISO-8601 absolute expiry. */
  expires_at?: string;
  services?: ServicesCatalog;
}

/**
 * `POST /account/token` (C2) — mints the full account token
 * `account:<session-user>:admin`. VERIFIED against cloud account-token.ts:
 * `{ token, expires_at, scopes, aud }` — NOT RFC-6749 (`token` not
 * `access_token`; `scopes` array not `scope` string; `expires_at` ISO string).
 */
export interface AccountTokenResponse {
  token: string;
  /** ISO-8601 absolute expiry. */
  expires_at?: string;
  scopes?: string[];
  aud?: string;
}
