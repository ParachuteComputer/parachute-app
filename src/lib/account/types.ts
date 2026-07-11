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
  /**
   * HUB-PARITY P4 tolerance: a password door (no self-serve signup / no email
   * identity model) may sign a person in under a `username` instead of an
   * `email`. "Signed in as X" falls back `email ?? username` everywhere it
   * appears. Cloud never sends this (email-only) — present for hub parity.
   */
  username?: string;
  /**
   * HUB-PARITY P4: an operator-provisioned hub account may still be on its
   * initial/operator-set password. When true, the boot dispatcher pre-empts
   * the `/account/token` 403 `force_change_password` gate with the same
   * non-blocking "Finish setting your password" weather (a cleaner hop — no
   * need to wait for the mint to fail). Cloud never sends this.
   */
  password_change_required?: boolean;
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

/**
 * One plan/tier on the account. Every LIMIT field is OPTIONAL by design: a door
 * that doesn't meter a dimension omits it, and the manager UI renders only what
 * is present (never invents a cap or a number). See `AccountSummary`.
 */
export interface AccountPlan {
  /** Stable machine tier id — e.g. "trial" | "entry" | "standard" | "power". */
  tier: string;
  /** Human label — e.g. "Free trial", "Standard". */
  label: string;
  /** Monthly price in USD. 0 (or omitted) during a free trial. */
  price_monthly_usd?: number;
  /** Max vaults this plan allows. Omit = unmetered / unlimited. */
  vault_limit?: number;
  /** Vaults currently counted against the plan. */
  vaults_used?: number;
  /** Bytes stored across the WHOLE account (sum of every vault). Omit if the
   *  door doesn't compute an account-level roll-up. */
  storage_used_bytes?: number;
  /** Storage cap in bytes. Omit = unmetered. */
  storage_limit_bytes?: number;
  /** Days remaining in the free trial, when `tier` is a trial. */
  trial_days_left?: number;
}

/**
 * `GET /account/summary` — the account-level manager read: email + plan + a
 * usage roll-up + billing capability flags. This drives the Account surface's
 * plan/usage line and the Billing section.
 *
 * ⚠ CANONICAL, VERIFIED against cloud's merged source (`GET /account/summary`,
 * cloud rc.74+). The app SEAMS it: `getAccountSummary()` returns `null` on any
 * non-200 (404 while unbuilt, 401 signed-out), and the UI renders the
 * plan/usage line + Billing section only when a summary is present —
 * gracefully absent otherwise, never faking numbers.
 */
export interface AccountSummary {
  /** The account's email (mirrors `GET /account/session`.email). */
  email: string;
  /** ISO-8601 — account creation, for "member since" warmth. */
  account_created_at?: string;
  /** The current plan/tier + its limits. */
  plan: AccountPlan;
  /**
   * Whether this door has billing wired at all (Stripe configured on the
   * account API). `false` ⇒ the Billing section renders NOTHING — a
   * self-hosted hub / no-billing door has no plan to manage, so there's
   * nothing honest to show.
   */
  billing_enabled: boolean;
  /**
   * Whether the account already has a Stripe customer (an existing
   * subscriber, possibly on a comped/trial plan with billing set up). `true`
   * ⇒ the Billing section shows "Manage plan & billing" (the Stripe billing
   * portal); `false` ⇒ it shows the upgrade plan cards (Stripe Checkout).
   */
  has_billing_customer: boolean;
}

/** The tier ladder cloud's billing endpoints accept — `POST
 *  /account/billing/checkout`'s `tier` body field and `DoorPlan.id` below. */
export type BillingTier = "entry" | "standard" | "plus" | "power";

/** The billing-interval ladder `POST /account/billing/checkout` accepts. */
export type BillingInterval = "monthly" | "quarterly" | "yearly";

/**
 * One purchasable tier on the door's upgrade ladder, as advertised by the door
 * descriptor (`GET /.well-known/parachute-account`.plans — see
 * `descriptor.ts`). Distinct from `AccountPlan` above: `AccountPlan` is the
 * account's CURRENT tier + live usage; `DoorPlan` is a static catalog row the
 * Billing section renders as an "Upgrade to <name>" card.
 */
export interface DoorPlan {
  id: BillingTier;
  name: string;
  /** Max vaults this tier allows. */
  vaults?: number;
  /** Monthly price in USD. */
  price_month?: number;
}
