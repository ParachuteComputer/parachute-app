import { clearAccountToken, loadAccountToken, saveAccountToken } from "./store";
import type {
  AccountSession,
  AccountTokenResponse,
  AccountVaultsResponse,
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

type Fetch = typeof fetch;

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new SessionExpiredError();
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      detail = body.error || body.message || detail;
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
  return (await res.json()) as AccountSession;
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

// --- The Bearer layer: `/account/vaults*` (C3) -------------------------------

/**
 * Mint a fresh account bearer from the live session cookie (C2) and cache it
 * (sessionStorage, via the account store). Throws `SessionExpiredError` if the
 * session itself is gone — no cookie means no bearer can be minted, and the
 * caller (or the re-mint recovery) surfaces the "sign in again" banner.
 */
async function mintAccountBearer(fetchImpl: Fetch): Promise<string> {
  const session = await getSession(fetchImpl);
  if (!session.signed_in) throw new SessionExpiredError();
  const { token } = await mintAccountToken(session.csrf, fetchImpl);
  saveAccountToken(token);
  return token;
}

/** The cached account bearer, or a freshly minted one (C2). */
async function ensureAccountBearer(fetchImpl: Fetch): Promise<string> {
  return loadAccountToken() ?? (await mintAccountBearer(fetchImpl));
}

/**
 * A Bearer-gated `/account/vaults*` request with ONE automatic re-mint on 401.
 * Attaches `Authorization: Bearer <account token>`; if the server 401s the
 * bearer (its ~10-min TTL lapsed), clears it, re-mints from the still-live
 * session cookie, and retries once. A POST body is JSON-encoded (no CSRF — the
 * Bearer layer isn't CSRF-gated).
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
    const reqInit: RequestInit = { method: init.method, credentials: "include", headers };
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
