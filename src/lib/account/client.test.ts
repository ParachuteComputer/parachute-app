import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SessionExpiredError,
  createVault,
  getAccountSummary,
  listVaults,
  logout,
  mintVaultToken,
} from "./client";
import { loadAccountToken } from "./store";
import type { AccountSummary } from "./types";

// Round-trips the REAL cloud wire (workers/identity/src/account-api.ts +
// account-auth.ts), NOT mocked assumptions — the class of test that hid the P0
// "401 on the first vault call" bug: the `/account/*` C3 surface is BEARER-gated
// (account token, aud="account"), so every C3 call MUST carry
// `Authorization: Bearer <account token>`. These tests assert that header IS
// sent, that the account token is minted (C2 `{token}`) + cached + re-minted on
// 401, and that logout is form-encoded (cloud's logout is form-only).

const SESSION_OK = { signed_in: true, csrf: "csrf-123", email: "a@b.c" };
const ACCOUNT_TOKEN_KEY = "lens:account_token";

function res(body: unknown, status = 200): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "content-type": "application/json" } });
}

function headersOf(init?: RequestInit): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

describe("the Bearer layer — /account/vaults* (C3)", () => {
  it("mints the account token (C2) and attaches it as Bearer on the C3 GET", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);
      if (path === "/account/session") return res(SESSION_OK);
      if (path === "/account/token")
        return res({ token: "acct-tok", scopes: ["account:u1:admin"] });
      if (path === "/account/vaults" && (init?.method ?? "GET") === "GET")
        return res({ vaults: [] });
      return res("unexpected", 500);
    });

    const out = await listVaults(fetchImpl);
    expect(out).toEqual({ vaults: [] });

    // C2 mint used the session CSRF (cookie+CSRF layer)…
    const mint = fetchImpl.mock.calls.find(([p]) => String(p) === "/account/token");
    expect(mint).toBeTruthy();
    expect(JSON.parse(mint?.[1]?.body as string)).toEqual({ __csrf: "csrf-123" });
    // …and the C3 GET carried the minted bearer.
    const list = fetchImpl.mock.calls.find(([p]) => String(p) === "/account/vaults");
    expect(headersOf(list?.[1]).authorization).toBe("Bearer acct-tok");
    // The minted token is cached for reuse.
    expect(loadAccountToken()).toBe("acct-tok");
  });

  it("reuses a cached account token — no C2 mint", async () => {
    sessionStorage.setItem(ACCOUNT_TOKEN_KEY, "cached-tok");
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/account/vaults") return res({ vaults: [] });
      return res("unexpected", 500);
    });

    await listVaults(fetchImpl);
    // Exactly one call — straight to the C3 GET, no session/mint round-trips.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(headersOf(fetchImpl.mock.calls[0]?.[1]).authorization).toBe("Bearer cached-tok");
  });

  it("de-dupes concurrent mints — two parallel C3 calls mint the token ONCE", async () => {
    let mints = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = String(input);
      if (path === "/account/session") return res(SESSION_OK);
      if (path === "/account/token") {
        mints++;
        return res({ token: "acct-tok" });
      }
      if (path === "/account/vaults") return res({ vaults: [] });
      return res("unexpected", 500);
    });

    await Promise.all([listVaults(fetchImpl), listVaults(fetchImpl)]);
    expect(mints).toBe(1);
  });

  it("re-mints once on a 401 and retries with the fresh token", async () => {
    sessionStorage.setItem(ACCOUNT_TOKEN_KEY, "stale-tok");
    let vaultsCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);
      if (path === "/account/session") return res(SESSION_OK);
      if (path === "/account/token") return res({ token: "fresh-tok" });
      if (path === "/account/vaults") {
        vaultsCalls++;
        return headersOf(init).authorization === "Bearer stale-tok"
          ? res("", 401)
          : res({ vaults: [] });
      }
      return res("unexpected", 500);
    });

    const out = await listVaults(fetchImpl);
    expect(out).toEqual({ vaults: [] });
    expect(vaultsCalls).toBe(2); // stale → 401, fresh → 200
    expect(loadAccountToken()).toBe("fresh-tok"); // cache updated
  });

  it("createVault: Bearer + JSON { name }, NO __csrf on the C3 body", async () => {
    sessionStorage.setItem(ACCOUNT_TOKEN_KEY, "acct-tok");
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === "/account/vaults" && init?.method === "POST")
        return res(
          { name: "moss", url: "https://u/vault/moss", vault_token: "vt", services: {} },
          201,
        );
      return res("unexpected", 500);
    });

    const out = await createVault("moss", fetchImpl);
    expect(out.name).toBe("moss");
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(headersOf(init).authorization).toBe("Bearer acct-tok");
    expect(headersOf(init)["content-type"]).toBe("application/json");
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({ name: "moss" });
    expect(body.__csrf).toBeUndefined();
  });

  it("mintVaultToken: Bearer, NO __csrf (empty JSON body)", async () => {
    sessionStorage.setItem(ACCOUNT_TOKEN_KEY, "acct-tok");
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (/\/account\/vaults\/moss\/token$/.test(String(input)) && init?.method === "POST")
        return res({ vault_token: "vt", expires_at: "2026-07-11T00:00:00.000Z", services: {} });
      return res("unexpected", 500);
    });

    const out = await mintVaultToken("moss", fetchImpl);
    expect(out.vault_token).toBe("vt");
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(headersOf(init).authorization).toBe("Bearer acct-tok");
    expect(JSON.parse(init?.body as string).__csrf).toBeUndefined();
  });

  it("a mint while signed OUT throws SessionExpiredError before any C3 attempt", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/account/session") return res({ signed_in: false, csrf: "x" });
      return res("unexpected", 500);
    });

    await expect(listVaults(fetchImpl)).rejects.toBeInstanceOf(SessionExpiredError);
    expect(fetchImpl.mock.calls.some(([p]) => String(p) === "/account/vaults")).toBe(false);
  });
});

describe("getAccountSummary — Bearer-gated (account:<id>:read) + seamed", () => {
  const summary: AccountSummary = {
    email: "a@b.c",
    account_created_at: "2026-01-01T00:00:00Z",
    plan: { tier: "standard", label: "Standard", price_monthly_usd: 5, vault_limit: 3 },
  };

  it("returns the summary on 200, riding the account Bearer (no cookie)", async () => {
    sessionStorage.setItem(ACCOUNT_TOKEN_KEY, "acct-tok");
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/account/summary") return res(summary);
      return res("unexpected", 500);
    });

    await expect(getAccountSummary(fetchImpl)).resolves.toEqual(summary);
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(headersOf(init).authorization).toBe("Bearer acct-tok");
    expect(init?.credentials).toBeUndefined(); // no cookie on the Bearer layer
  });

  it("returns null on 404 (endpoint not built yet) — graceful absent", async () => {
    sessionStorage.setItem(ACCOUNT_TOKEN_KEY, "acct-tok");
    const fetchImpl = vi.fn<typeof fetch>(async () => res("not found", 404));
    await expect(getAccountSummary(fetchImpl)).resolves.toBeNull();
  });

  it("returns null on 403 (underscoped)", async () => {
    sessionStorage.setItem(ACCOUNT_TOKEN_KEY, "acct-tok");
    const fetchImpl = vi.fn<typeof fetch>(async () => res("", 403));
    await expect(getAccountSummary(fetchImpl)).resolves.toBeNull();
  });

  it("returns null when signed out (no bearer to mint) — no-cloud-door degrade", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/account/session") return res({ signed_in: false, csrf: "x" });
      return res("unexpected", 500);
    });
    await expect(getAccountSummary(fetchImpl)).resolves.toBeNull();
  });

  it("returns null on a network failure (never throws)", async () => {
    sessionStorage.setItem(ACCOUNT_TOKEN_KEY, "acct-tok");
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    await expect(getAccountSummary(fetchImpl)).resolves.toBeNull();
  });
});

describe("logout — form-encoded (cloud's logout is form-only)", () => {
  it("posts an x-www-form-urlencoded body, not JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => res("", 200));
    await logout("csrf-123", fetchImpl);
    const [path, init] = fetchImpl.mock.calls[0]!;
    expect(String(path)).toBe("/logout");
    expect(init?.method).toBe("POST");
    expect(headersOf(init)["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(init?.body).toBe("__csrf=csrf-123");
    expect(init?.credentials).toBe("include");
  });

  it("swallows a network failure (best-effort)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    await expect(logout("csrf-123", fetchImpl)).resolves.toBeUndefined();
  });
});
