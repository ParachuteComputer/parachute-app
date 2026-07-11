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

/** Usage for one vault (ASSUMED structured; UI formats "68 MB · 42 notes"). */
export interface AccountVaultUsage {
  bytes?: number;
  notes?: number;
}

/** One row of `GET /account/vaults` — a hosted (Cloud) vault on this account. */
export interface AccountVault {
  /** The immutable slug — also the address tail (u.parachute.computer/vault/<name>). */
  name: string;
  /** Full vault URL, e.g. https://u.parachute.computer/vault/moss. ASSUMED field. */
  address?: string;
  /** ASSUMED field. */
  usage?: AccountVaultUsage;
  /** ISO-8601. ASSUMED field. */
  created_at?: string;
}

/** `GET /account/vaults`. ASSUMED envelope (`{ vaults }` vs bare array). */
export interface AccountVaultsResponse {
  vaults: AccountVault[];
  /** Plan slot accounting for the add-vault chooser ("2 of 3 plan slots used"). ASSUMED. */
  plan?: AccountPlan;
}

/** Plan + usage summary for the Account surface (PR-2). ASSUMED shape. */
export interface AccountPlan {
  /** e.g. "entry" | "standard" | "plus" | "power" | "trial". */
  tier?: string;
  /** Human label, e.g. "Standard". */
  label?: string;
  price_monthly_usd?: number;
  vault_limit?: number;
  vaults_used?: number;
  bytes_limit?: number;
  bytes_used?: number;
  /** Free-trial days remaining, when on trial. */
  trial_days_left?: number;
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
