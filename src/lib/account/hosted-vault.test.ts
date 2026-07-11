import { loadToken } from "@/lib/vault/storage";
import { useVaultStore } from "@/lib/vault/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "./client";
import { HOSTED_CLIENT_ID, isHostedVaultRecord, openHostedVault } from "./hosted-vault";

// Locks the DOOR-AGNOSTIC contract (Aaron's home-door principle): a home-door
// vault's issuer is the app's OWN serving origin (never a hardcoded cloud host),
// and the vault's REST URL comes from the C3 token's services catalog — the door
// tells the app where its vaults live, so the same code works served by cloud OR
// by a hub.

describe("openHostedVault — door-agnostic (same-origin home door)", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  it("maps cloud's C3 response and stores issuer = the serving origin, not a cloud host", async () => {
    // Cloud's REAL C3 shape: { vault_token, expires_at (ISO), services }.
    vi.spyOn(client, "mintVaultToken").mockResolvedValue({
      vault_token: "vault-tok",
      expires_at: "2026-07-11T00:00:00.000Z",
      services: { "vault:moss": { url: "https://u.parachute.computer/vault/moss" } },
    });

    const id = await openHostedVault("moss", "csrf");
    const rec = useVaultStore.getState().vaults[id];
    expect(rec?.issuer).toBe(window.location.origin); // same-origin home door
    expect(rec?.issuer).not.toContain("cloud.parachute.computer");
    // The vault REST URL comes from the door's services catalog (authoritative).
    expect(rec?.url).toBe("https://u.parachute.computer/vault/moss");
    expect(rec?.clientId).toBe(HOSTED_CLIENT_ID);
    expect(isHostedVaultRecord(rec?.clientId ?? "")).toBe(true);
    // The token is stored from vault_token + derived scope + ISO→ms expiry.
    const token = loadToken(id);
    expect(token?.accessToken).toBe("vault-tok");
    expect(token?.scope).toBe("vault:moss:read vault:moss:write");
    expect(token?.expiresAt).toBe(Date.parse("2026-07-11T00:00:00.000Z"));
  });

  it("throws (no fabricated cloud origin) when the C3 token omits its services URL", async () => {
    vi.spyOn(client, "mintVaultToken").mockResolvedValue({
      vault_token: "vault-tok",
      expires_at: "2026-07-11T00:00:00.000Z",
      // no services catalog → the door didn't tell us where the vault lives
    });
    await expect(openHostedVault("moss", "csrf")).rejects.toThrow(/services\.vault\.url/);
  });
});
