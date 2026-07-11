import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyVaults, resolveBoot } from "./dispatch";
import { loadAccountToken, loadLastSigninEmail, useAccountSessionStore } from "./store";
import type { AccountVault } from "./types";

const V = (name: string): AccountVault => ({
  name,
  url: `https://u.parachute.computer/vault/${name}`,
});

// A routed mock fetch: match by pathname, return the queued JSON per endpoint.
function mockFetch(routes: Record<string, { status?: number; json?: unknown }>) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const path = new URL(url, "https://app.parachute.computer").pathname;
    const r = routes[path];
    if (!r) throw new Error(`unexpected fetch: ${path}`);
    return {
      ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
      status: r.status ?? 200,
      json: async () => r.json,
    } as Response;
  });
}

describe("classifyVaults", () => {
  it("no vaults → create your first", () => {
    expect(classifyVaults([])).toEqual({ kind: "first-vault" });
  });
  it("one vault → welcome-back with that vault", () => {
    expect(classifyVaults([V("moss")])).toEqual({ kind: "welcome-back", vault: V("moss") });
  });
  it("many vaults → the picker", () => {
    const vaults = [V("moss"), V("journal"), V("atlas")];
    expect(classifyVaults(vaults)).toEqual({ kind: "picker", vaults });
  });
});

describe("resolveBoot", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useAccountSessionStore.setState({ expired: false, gate: null });
  });
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useAccountSessionStore.setState({ expired: false, gate: null });
  });

  it("goes straight Home when a vault is already connected on this device (no network)", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const decision = await resolveBoot({ hasLocalActiveVault: true, fetchImpl });
    expect(decision).toEqual({ kind: "home" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("signed out → front door", async () => {
    const fetchImpl = mockFetch({ "/account/session": { json: { signed_in: false, csrf: "c" } } });
    const decision = await resolveBoot({ hasLocalActiveVault: false, fetchImpl });
    expect(decision).toEqual({ kind: "front-door" });
  });

  it("signed in → returns the vault list, and persists email + account token", async () => {
    const fetchImpl = mockFetch({
      "/account/session": { json: { signed_in: true, csrf: "c", email: "ag@unforced.org" } },
      // Cloud's REAL C2 shape: { token, expires_at, scopes, aud }.
      "/account/token": {
        json: {
          token: "acct-tok",
          expires_at: "2026-07-11T00:00:00.000Z",
          scopes: ["account:x:admin"],
        },
      },
      "/account/vaults": { json: { vaults: [V("moss"), V("journal")] } },
    });
    const decision = await resolveBoot({ hasLocalActiveVault: false, fetchImpl });
    expect(decision).toEqual({
      kind: "signed-in",
      email: "ag@unforced.org",
      vaults: [V("moss"), V("journal")],
    });
    expect(loadLastSigninEmail()).toBe("ag@unforced.org");
    expect(loadAccountToken()).toBe("acct-tok");
  });

  it("a session network failure degrades to the front door", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("network down");
    });
    const decision = await resolveBoot({ hasLocalActiveVault: false, fetchImpl });
    expect(decision).toEqual({ kind: "front-door" });
  });

  it("signed in but the vault list fails → net-error weather", async () => {
    const fetchImpl = mockFetch({
      "/account/session": { json: { signed_in: true, csrf: "c", email: "ag@unforced.org" } },
      "/account/token": { json: { token: "acct-tok", scopes: ["s"] } },
      "/account/vaults": { status: 500, json: { error: "boom" } },
    });
    const decision = await resolveBoot({ hasLocalActiveVault: false, fetchImpl });
    expect(decision.kind).toBe("net-error");
  });

  // HUB-PARITY P4 — a password door may sign a person in under a `username`
  // instead of `email` (no email identity model). The signed-in arm carries
  // it through, and the email-presence guard on saveLastSigninEmail holds.
  it("hub-shaped session (username, no email) → flows to the signed-in arm", async () => {
    const fetchImpl = mockFetch({
      "/account/session": { json: { signed_in: true, csrf: "c", username: "aaron" } },
      "/account/token": { json: { token: "acct-tok", scopes: ["account:x:admin"] } },
      "/account/vaults": { json: { vaults: [V("moss")] } },
    });
    const decision = await resolveBoot({ hasLocalActiveVault: false, fetchImpl });
    expect(decision).toEqual({ kind: "signed-in", username: "aaron", vaults: [V("moss")] });
    // No email on this session → the last-signin-email helper is never called.
    expect(loadLastSigninEmail()).toBeNull();
    expect(loadAccountToken()).toBe("acct-tok");
  });

  // HUB-PARITY P4 weather (design §2 row 4) — non-blocking gates, both set on
  // the shared `useAccountSessionStore` for the app-wide `HubGateBanner`.
  describe("hub gates (force_change_password / admin_locked)", () => {
    it("session.password_change_required pre-empts the gate before the token mint even runs", async () => {
      const fetchImpl = mockFetch({
        "/account/session": {
          json: { signed_in: true, csrf: "c", username: "aaron", password_change_required: true },
        },
        "/account/token": { json: { token: "acct-tok", scopes: ["s"] } },
        "/account/vaults": { json: { vaults: [] } },
      });
      await resolveBoot({ hasLocalActiveVault: false, fetchImpl });
      expect(useAccountSessionStore.getState().gate).toBe("force_change_password");
    });

    it('a 403 {error:"force_change_password"} on /account/token marks the gate and short-circuits to signed-in (no vault list retry)', async () => {
      const fetchImpl = mockFetch({
        "/account/session": { json: { signed_in: true, csrf: "c", username: "aaron" } },
        "/account/token": { status: 403, json: { error: "force_change_password" } },
        // Never requested: every C3 call (listVaults included) would just
        // re-attempt the SAME failing mint, so resolveBoot short-circuits
        // instead of retrying a doomed call.
        "/account/vaults": { json: { vaults: [{ name: "should-not-be-fetched" }] } },
      });
      const decision = await resolveBoot({ hasLocalActiveVault: false, fetchImpl });
      expect(useAccountSessionStore.getState().gate).toBe("force_change_password");
      expect(decision).toEqual({ kind: "signed-in", username: "aaron", vaults: [] });
    });

    it("a 423 on /account/token marks the admin_locked gate", async () => {
      const fetchImpl = mockFetch({
        "/account/session": { json: { signed_in: true, csrf: "c", username: "aaron" } },
        "/account/token": { status: 423, json: { error: "admin_locked" } },
        "/account/vaults": { json: { vaults: [] } },
      });
      await resolveBoot({ hasLocalActiveVault: false, fetchImpl });
      expect(useAccountSessionStore.getState().gate).toBe("admin_locked");
    });

    it("cloud's shipped shape (no password_change_required, /account/token 200s) never sets a gate", async () => {
      const fetchImpl = mockFetch({
        "/account/session": { json: { signed_in: true, csrf: "c", email: "ag@unforced.org" } },
        "/account/token": { json: { token: "acct-tok", scopes: ["s"] } },
        "/account/vaults": { json: { vaults: [] } },
      });
      await resolveBoot({ hasLocalActiveVault: false, fetchImpl });
      expect(useAccountSessionStore.getState().gate).toBeNull();
    });
  });
});
