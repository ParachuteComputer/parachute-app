import type { TokenResponse } from "@/lib/vault/types";
import type {
  AccountSession,
  AccountTokenResponse,
  AccountVault,
  AccountVaultsResponse,
} from "./types";

/**
 * Client for the hosted account API. Everything is SAME-ORIGIN post-cutover
 * (app.parachute.computer serves the app AND `/account/*` + `/auth/*`), so we
 * use relative paths and send the session cookie with `credentials: "include"`.
 * State-changing POSTs carry the CSRF token (from `GET /account/session`) in
 * the JSON body as `__csrf`, and the `X-Requested-With: fetch` header marks the
 * request as the JSON (in-app) variant so the server answers JSON, not a
 * server-rendered page (G2 / rc.49 precedent).
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

/** `POST /account/token` (C2) — mint the full account token. */
export async function mintAccountToken(
  csrf: string,
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<AccountTokenResponse> {
  const res = await post(fetchImpl, "/account/token", { __csrf: csrf });
  return jsonOrThrow<AccountTokenResponse>(res);
}

/** `GET /account/vaults` — the account's hosted vaults (drives the dispatch). */
export async function listVaults(
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<AccountVaultsResponse> {
  const res = await fetchImpl("/account/vaults", {
    credentials: "include",
    headers: { "X-Requested-With": "fetch" },
  });
  return jsonOrThrow<AccountVaultsResponse>(res);
}

/** `POST /account/vaults` — create a brand-new hosted vault (immutable slug). */
export async function createVault(
  name: string,
  csrf: string,
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<AccountVault> {
  const res = await post(fetchImpl, "/account/vaults", { name, __csrf: csrf });
  return jsonOrThrow<AccountVault>(res);
}

/** `POST /account/vaults/<name>/token` (C3) — mint a per-vault token the notes
 *  layer uses. TokenResponse-shaped so `storedFromTokenResponse` + `addVault`
 *  consume it unchanged. */
export async function mintVaultToken(
  name: string,
  csrf: string,
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<TokenResponse> {
  const res = await post(fetchImpl, `/account/vaults/${encodeURIComponent(name)}/token`, {
    __csrf: csrf,
  });
  return jsonOrThrow<TokenResponse>(res);
}

/** `POST /logout` — end the session. */
export async function logout(
  csrf: string,
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<void> {
  await post(fetchImpl, "/logout", { __csrf: csrf }).catch(() => {
    // best-effort — a failed logout still clears local state client-side
  });
}
