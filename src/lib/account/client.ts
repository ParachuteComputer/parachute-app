import {
  clearAccountToken,
  loadAccountIdentity,
  loadAccountToken,
  saveAccountToken,
  useAccountSessionStore,
} from "./store";
import type {
  AccountSession,
  AccountSummary,
  AccountTokenResponse,
  AccountVaultsResponse,
  BillingInterval,
  BillingTier,
  CreateVaultResponse,
  VaultTokenResponse,
} from "./types";

/**
 * Client for the hosted account API. Everything is SAME-ORIGIN post-cutover
 * (app.parachute.computer serves the app AND `/account/*` + `/auth/*`), so we
 * use relative paths.
 *
 * TWO auth layers — the cutover P0 (parachute-cloud db99485e). Cloud's
 * `/account/*` splits in two (verified against workers/identity/src):
 *
 *   · COOKIE + CSRF layer — `GET /account/session`, `POST /account/token` (C2),
 *     `POST /auth/magic`. Cookie-authed (`credentials: "include"`) with the CSRF
 *     token in the JSON body as `__csrf`. This is how the account bearer is
 *     obtained.
 *   · BEARER layer — the `/account/vaults*` REST surface (C3): list, create,
 *     per-vault mint. **Bearer-gated by the account token** (account-auth.ts:
 *     `aud="account"`, `account:<id>:{read,admin}`), NOT the cookie. Every C3
 *     call attaches `Authorization: Bearer <account token>`. There is NO CSRF on
 *     this layer (Bearer requests aren't CSRF-vulnerable), so C3 bodies carry
 *     none. This is the fix for the "401 on the first vault call" P0 — the
 *     client mints the account token (C2), caches it, attaches it, and re-mints
 *     once on a 401.
 *
 * All calls take an injectable `fetchImpl` so the flow is unit-testable without
 * a live origin (the endpoints are built cloud-side in parallel — this file is
 * the app-side contract of record).
 */

/** Thrown on a 401 — the session cookie is missing/expired. Drives the
 *  non-blocking "your sign-in ended" banner + the re-mint path. */
export class SessionExpiredError extends Error {
  constructor(message = "Your session has ended.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

/** Thrown on any other non-2xx account response. */
export class AccountApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AccountApiError";
    this.status = status;
  }
}

/** The billing-endpoint error reasons the UI branches on (cloud rc.74's
 *  `POST /account/billing/{portal,checkout}`). `"unknown"` covers a 503 with
 *  no parseable body, or any other shape we don't recognize — the UI folds
 *  every code into the same non-blocking "billing isn't available" message,
 *  but the code is there for callers that want to distinguish. */
export type BillingErrorCode =
  | "no_billing_customer"
  | "already_subscribed"
  | "invalid_tier"
  | "invalid_interval"
  | "invalid_plan"
  | "unconfigured"
  | "unknown";

const KNOWN_BILLING_ERROR_CODES: readonly BillingErrorCode[] = [
  "no_billing_customer",
  "already_subscribed",
  "invalid_tier",
  "invalid_interval",
  "invalid_plan",
];

/** Thrown by `openBillingPortal` / `startCheckout` on any non-2xx response —
 *  an `AccountApiError` with a typed `code` so the UI can branch (e.g. show
 *  the "Billing isn't available right now" inline message) without parsing
 *  the message string itself. */
export class BillingApiError extends AccountApiError {
  readonly code: BillingErrorCode;
  constructor(status: number, code: BillingErrorCode, message: string) {
    super(status, message);
    this.name = "BillingApiError";
    this.code = code;
  }
}

type Fetch = typeof fetch;

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new SessionExpiredError();
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      // F12: the C3 vault surface's `restError` (account-api.ts) sends BOTH a
      // machine `error` code (`vault_taken`, `vault_limit_reached`, …) and a
      // human `message` ("That vault name is already taken.") — prefer the
      // friendly `message` so a plan-limit hit reads as prose, not a bare wire
      // code. `error` is still the fallback for shapes that omit `message`
      // (e.g. the OAuth-flavored `{error, error_description}` account-token
      // responses, or a self-hosted hub predating this convention).
      detail = body.message || body.error || detail;
    } catch {
      // non-JSON error body — keep the status
    }
    throw new AccountApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

/** Cookie + CSRF JSON POST — the session/mint layer (`/account/token`, `/auth/magic`). */
function post(fetchImpl: Fetch, path: string, body: Record<string, unknown>): Promise<Response> {
  return fetchImpl(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", "X-Requested-With": "fetch" },
    body: JSON.stringify(body),
  });
}

/** `email ?? username` — the identity string cached alongside the account
 *  bearer (see `store.ts`'s `StoredAccountToken`), and the value ambient
 *  "Signed in as X" surfaces render. `null` when the door session names
 *  neither (signed out, or a shape we don't recognize). */
function identityOf(session: Pick<AccountSession, "email" | "username">): string | null {
  return session.email ?? session.username ?? null;
}

/**
 * AUTH-W2 move 2: the cached account bearer can't outlive the cookie's
 * identity. Every `getSession()` read compares the door's answer against
 * whichever identity the cached bearer was minted for — if the cookie now
 * names someone else (another tab signed out/in as a different account, or
 * signed out entirely) the cache is a lie for THIS tab, so it's dropped: the
 * bearer clears (next Bearer call re-mints from the now-current cookie) and
 * `identityEpoch` bumps so ambient vault/summary reads (keyed off it) drop
 * their stale rows too, instead of quietly serving the old account's data
 * until the ~10-minute bearer TTL happened to lapse on its own.
 *
 * No-ops when nothing is cached yet (first load, or already reconciled) —
 * only a REAL mismatch against a live cache triggers the drop.
 */
function reconcileIdentity(session: AccountSession): void {
  const cachedIdentity = loadAccountIdentity();
  if (cachedIdentity === null) return;
  if (identityOf(session) === cachedIdentity) return;
  clearAccountToken();
  useAccountSessionStore.getState().bumpIdentityEpoch();
}

/** `GET /account/session` — the boot oracle. Never throws on signed-out; the
 *  `signed_in` flag carries that. Only network failure rejects. */
export async function getSession(
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<AccountSession> {
  const res = await fetchImpl("/account/session", {
    credentials: "include",
    headers: { "X-Requested-With": "fetch" },
  });
  if (!res.ok) throw new AccountApiError(res.status, `session ${res.status}`);
  const session = (await res.json()) as AccountSession;
  reconcileIdentity(session);
  return session;
}

/**
 * `POST /auth/code` — verify the 6-digit short-form spelling of the magic
 * link (`CheckEmail.tsx`'s "type the code instead" field).
 *
 * FORM-ENCODED, NOT JSON — verified live against cloud's merged source
 * (`workers/identity/src/auth-handlers.ts` `handleCodeVerifyPost`): unlike
 * `/auth/magic`, this handler has no `wantsJson`/`prefersJson` branch at all —
 * it unconditionally reads `req.formData()` and answers either a same-origin
 * REDIRECT (success — the session cookie lands on the response before we ever
 * see it) or a 200 HTML re-render of the ceremony page (every failure: wrong
 * code, expired, unknown email, attempt-cap — all folded into one neutral
 * message by design, no oracle). The JSON variant was deferred out of Wave 1;
 * this is what's actually deployed today (AUTH-W2-BRIEF §2).
 *
 * So: post form-encoded with `redirect: "manual"` and read the RESPONSE
 * SHAPE, never the body. A same-origin redirect becomes an opaque
 * `res.type === "opaqueredirect"` response (status 0, headers unreadable —
 * but the browser already applied the Set-Cookie from the real network
 * response before filtering it into this shape, so the session is live);
 * anything else is a failure. We don't parse the HTML — there's nothing in it
 * we need that the endpoint's own single neutral failure message doesn't
 * already say.
 *
 * KNOWN GAP (documented, not silently swallowed): an account with TOTP
 * enrolled diverts server-side to `/login/2fa` via the SAME redirect shape a
 * success does — `finishPrimaryAuth` on cloud stashes a pending login rather
 * than minting a session. This function would report `true` (a redirect DID
 * happen) even though no session landed; the caller's next `getSession()`
 * read will show `signed_in: false` and the flow safely degrades (Welcome.tsx
 * already bounces `!signed_in` to the front door) rather than hanging. TOTP
 * is explicitly out of scope for this wave (AUTH-W2-BRIEF §2) — the app has
 * no 2FA UI yet, on ANY sign-in path, not just this one.
 */
export async function verifySignInCode(
  email: string,
  code: string,
  csrf: string,
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<boolean> {
  const res = await fetchImpl("/auth/code", {
    method: "POST",
    credentials: "include",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, code, __csrf: csrf }).toString(),
  });
  return res.type === "opaqueredirect";
}

/** `POST /auth/magic` (JSON variant) — sends the sign-in link. `next` is the
 *  in-app path to return to after `/auth/verify` sets the cookie. */
export async function requestMagicLink(
  email: string,
  csrf: string,
  next = "/",
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<void> {
  const res = await post(fetchImpl, "/auth/magic", { email, __csrf: csrf, next });
  if (!res.ok) throw new AccountApiError(res.status, `magic ${res.status}`);
}

/** `POST /account/token` (C2) — mint the full account token (cookie + CSRF). */
export async function mintAccountToken(
  csrf: string,
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<AccountTokenResponse> {
  const res = await post(fetchImpl, "/account/token", { __csrf: csrf });
  return jsonOrThrow<AccountTokenResponse>(res);
}

// --- The Bearer layer: `/account/*` C3 surface -------------------------------

// A single in-flight C2 mint, shared across concurrent C3 callers: the Account
// surface fires listVaults + the summary read at once, and without this each
// would mint its own account token (duplicate getSession + /account/token
// round-trips, last-write-wins on the cache). While a mint is in flight every
// caller awaits the SAME promise; it clears on settle so the next lapse re-mints.
let inflightMint: Promise<string> | null = null;

/**
 * Mint a fresh account bearer from the live session cookie (C2) and cache it
 * (sessionStorage, via the account store), de-duping concurrent mints. Throws
 * `SessionExpiredError` if the session itself is gone — no cookie means no
 * bearer can be minted, and the caller (or the re-mint recovery) surfaces the
 * "sign in again" banner.
 */
function mintAccountBearer(fetchImpl: Fetch): Promise<string> {
  if (inflightMint) return inflightMint;
  inflightMint = (async () => {
    const session = await getSession(fetchImpl);
    if (!session.signed_in) throw new SessionExpiredError();
    const { token } = await mintAccountToken(session.csrf, fetchImpl);
    saveAccountToken(token, identityOf(session));
    return token;
  })().finally(() => {
    inflightMint = null;
  });
  return inflightMint;
}

/** The cached account bearer, or a freshly minted one (C2). */
async function ensureAccountBearer(fetchImpl: Fetch): Promise<string> {
  return loadAccountToken() ?? (await mintAccountBearer(fetchImpl));
}

/**
 * A Bearer-gated `/account/*` request with ONE automatic re-mint on 401.
 * Attaches `Authorization: Bearer <account token>`; if the server 401s the
 * bearer (its ~10-min TTL lapsed), clears it, re-mints from the still-live
 * session cookie, and retries once. A POST body is JSON-encoded (no CSRF — the
 * Bearer layer isn't CSRF-gated). No cookie is sent: the C3 gate reads only the
 * Authorization header.
 */
async function bearerFetch(
  fetchImpl: Fetch,
  path: string,
  init: { method: "GET" } | { method: "POST"; body?: Record<string, unknown> },
): Promise<Response> {
  const send = (token: string): Promise<Response> => {
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      "X-Requested-With": "fetch",
    };
    const reqInit: RequestInit = { method: init.method, headers };
    if (init.method === "POST") {
      headers["content-type"] = "application/json";
      reqInit.body = JSON.stringify(init.body ?? {});
    }
    return fetchImpl(path, reqInit);
  };

  let res = await send(await ensureAccountBearer(fetchImpl));
  if (res.status === 401) {
    // The account bearer lapsed — drop it and re-mint from the live cookie once.
    clearAccountToken();
    res = await send(await mintAccountBearer(fetchImpl));
  }
  return res;
}

/**
 * The tri-state summary read (W2-8, DESIGN-SPEC §3.1) — the seam that lets the
 * Account surface distinguish *failed* from *absent* instead of folding both
 * into `null`-means-nothing-to-show (WALK-manager #1: a transient 500 used to
 * silently vanish ALL plan information, indistinguishable from a self-host
 * door with no billing).
 *
 *   · `AccountSummary` — a real 200 answer.
 *   · `null`           — ABSENT: the door answered 404/501, i.e. it does not
 *     serve a summary at all. This is a hub's honest steady-state (the hub
 *     door ships `/account/session|token|vaults` but no `/account/summary`),
 *     so it must NOT render a retry card that can never succeed — there is
 *     simply nothing to show, same as `billing_enabled: false`.
 *   · `"error"`        — FAILED: network, 5xx, auth hiccup — anything that may
 *     be transient. The Plan & billing card renders its own retry state.
 */
export type AccountSummaryState = AccountSummary | null | "error";

export async function getAccountSummaryState(
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<AccountSummaryState> {
  try {
    const res = await bearerFetch(fetchImpl, "/account/summary", { method: "GET" });
    if (res.ok) return (await res.json()) as AccountSummary;
    // 404/501 = the door doesn't offer a summary (absent, not broken).
    if (res.status === 404 || res.status === 501) return null;
    return "error";
  } catch {
    // Mint/network failure — transient until proven otherwise.
    return "error";
  }
}

// NOTE: ambient consumers (switcher, nav badge, Home's trial line/nudge) read
// the same tri-state through `useAccountSummary` + `summaryOrNull`
// (use-summary.ts) — failed and absent both mean "no ambience"; only the
// Account surface distinguishes them. There is deliberately no separate
// collapse-to-null fetch function to drift.

/** `GET /account/vaults` — the account's hosted vaults (drives the dispatch). */
export async function listVaults(
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<AccountVaultsResponse> {
  const res = await bearerFetch(fetchImpl, "/account/vaults", { method: "GET" });
  return jsonOrThrow<AccountVaultsResponse>(res);
}

/** `POST /account/vaults` — create a brand-new hosted vault (immutable slug).
 *  Bearer-gated (`account:<id>:admin`); the account token is sourced internally. */
export async function createVault(
  name: string,
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<CreateVaultResponse> {
  const res = await bearerFetch(fetchImpl, "/account/vaults", { method: "POST", body: { name } });
  return jsonOrThrow<CreateVaultResponse>(res);
}

/** `POST /account/vaults/<name>/token` (C3) — mint a per-vault token. Cloud
 *  returns `{ vault_token, expires_at, services }` (NOT the OAuth TokenResponse);
 *  `hosted-vault.ts` maps it into a StoredToken. Scope defaults to read+write
 *  server-side when the body omits `scopes`. Bearer-gated (`account:<id>:admin`). */
export async function mintVaultToken(
  name: string,
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<VaultTokenResponse> {
  const res = await bearerFetch(fetchImpl, `/account/vaults/${encodeURIComponent(name)}/token`, {
    method: "POST",
  });
  return jsonOrThrow<VaultTokenResponse>(res);
}

/** `{ url }` on 200 — the shape both billing endpoints return. */
interface BillingUrlResponse {
  url: string;
}

/**
 * Parse a billing-endpoint response: `{ url }` on 200, a typed
 * `BillingApiError` on any non-2xx (409/400/503), `SessionExpiredError` on
 * 401 (same as every other Bearer call). A 503 means billing isn't
 * configured on this door at all, regardless of body shape.
 *
 * The 200 body is GUARDED: a contract-violating `200 {}` / blank / non-string
 * `url` would otherwise `window.location.assign(undefined)` → a bogus
 * navigation to `/undefined`. We require a non-empty string `url` and throw a
 * typed `BillingApiError` otherwise, so the UI shows its inline message rather
 * than navigating nowhere.
 */
async function billingResult(res: Response): Promise<BillingUrlResponse> {
  if (res.status === 401) throw new SessionExpiredError();
  if (res.ok) {
    const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
    if (body && typeof body.url === "string" && body.url.length > 0) return { url: body.url };
    throw new BillingApiError(res.status, "unknown", "Billing returned no redirect URL.");
  }
  if (res.status === 503) {
    throw new BillingApiError(503, "unconfigured", "Billing isn't configured for this door.");
  }
  let code: BillingErrorCode = "unknown";
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error && (KNOWN_BILLING_ERROR_CODES as string[]).includes(body.error)) {
      code = body.error as BillingErrorCode;
    }
  } catch {
    // non-JSON error body — keep "unknown"
  }
  throw new BillingApiError(res.status, code, code === "unknown" ? `${res.status}` : code);
}

/**
 * `POST /account/billing/portal` (Bearer, no body) — mints a Stripe
 * billing-portal session for an EXISTING subscriber and returns its URL. The
 * caller redirects straight there (`window.location.assign`) — the app never
 * touches Stripe or pricing itself, it just carries the account bearer and
 * follows the door's answer. `409 no_billing_customer` (comped/no-customer)
 * and `503` (billing unconfigured) surface as a `BillingApiError`.
 */
export async function openBillingPortal(
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<BillingUrlResponse> {
  const res = await bearerFetch(fetchImpl, "/account/billing/portal", { method: "POST" });
  return billingResult(res);
}

/**
 * `POST /account/billing/checkout` (Bearer, `{ tier, interval? }`) — mints a
 * Stripe Checkout session for a NEW subscription and returns its URL. `409
 * already_subscribed`, `400 invalid_tier|invalid_interval|invalid_plan`, and
 * `503` (billing unconfigured) surface as a `BillingApiError`.
 */
export async function startCheckout(
  tier: BillingTier,
  interval?: BillingInterval,
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<BillingUrlResponse> {
  const body: Record<string, unknown> = { tier };
  if (interval) body.interval = interval;
  const res = await bearerFetch(fetchImpl, "/account/billing/checkout", { method: "POST", body });
  return billingResult(res);
}

/**
 * `POST /logout` — end the session. Cloud's logout is FORM-encoded + CSRF
 * (console.ts `handleLogoutPost` reads `req.formData()`), so we post a form
 * body, not JSON — a JSON POST silently no-ops server-side. Same-origin with
 * the session cookie; best-effort (local state clears regardless of the answer).
 */
export async function logout(
  csrf: string,
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<void> {
  await fetchImpl("/logout", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ __csrf: csrf }).toString(),
  }).catch(() => {
    // best-effort — a failed logout still clears local state client-side
  });
}
