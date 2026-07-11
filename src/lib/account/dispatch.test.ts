import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyVaults, resolveBoot } from "./dispatch";
import { loadAccountToken, loadLastSigninEmail } from "./store";
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
  });
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
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
});
