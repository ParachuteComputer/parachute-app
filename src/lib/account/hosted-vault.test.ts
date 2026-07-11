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

  it("stores the vault with issuer = the serving origin, not a cloud host", async () => {
    vi.spyOn(client, "mintVaultToken").mockResolvedValue({
      access_token: "vault-tok",
      token_type: "bearer",
      scope: "vault:read vault:write",
      vault: "moss",
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
  });

  it("throws (no fabricated cloud origin) when the C3 token omits its services URL", async () => {
    vi.spyOn(client, "mintVaultToken").mockResolvedValue({
      access_token: "vault-tok",
      token_type: "bearer",
      scope: "vault:read vault:write",
      vault: "moss",
      // no services catalog → the door didn't tell us where the vault lives
    });
    await expect(openHostedVault("moss", "csrf")).rejects.toThrow(/services\.vault\.url/);
  });
});
