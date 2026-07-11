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
 * marked ASSUMED aren't nailed down in SYNTHESIS — reconcile before cutover.
 */

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
 * `POST /account/vaults` (cloud) → `{ name, url, vault_token, services }`. We
 * consume name + url here; `createHostedVault` mints the per-vault token via C3
 * (well-defined TokenResponse shape) rather than depend on `vault_token`'s exact
 * type — a redundant call we can drop once `vault_token` is pinned.
 */
export interface CreateVaultResponse {
  name: string;
  url: string;
}

/**
 * `POST /account/token` (C2) — mints the full account token
 * `account:<session-user>:admin`. RFC-6749-shaped so the same envelope reader
 * works. The app holds this to drive account management.
 */
export interface AccountTokenResponse {
  access_token: string;
  token_type: "bearer";
  scope: string;
  expires_in?: number;
}
