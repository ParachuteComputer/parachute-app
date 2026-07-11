import { loadToken } from "@/lib/vault/storage";
import { useVaultStore } from "@/lib/vault/store";
import { vaultIdFromUrl } from "@/lib/vault/url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "./client";
import {
  HOSTED_CLIENT_ID,
  createHostedVault,
  isHostedVaultRecord,
  openHostedVault,
} from "./hosted-vault";

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

    const id = await openHostedVault("moss");
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
    await expect(openHostedVault("moss")).rejects.toThrow(/services\.vault\.url/);
  });
});

// The activation-honesty split (W2-6, DESIGN-SPEC §4.2 / WALK-manager #2):
// creating a vault used to compose openHostedVault, silently switching the
// active vault mid-"creating". Now the create call MINTS ONLY — the local
// vault store must be byte-identical before and after.
describe("createHostedVault — mints only (create ≠ activate)", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  it("creates account-side but touches NOTHING on this device — even when the door hands back an inline token", async () => {
    // Seed a prior active vault — the person mid-ceremony is "in" moss.
    useVaultStore.setState({
      vaults: {
        "moss-id": {
          id: "moss-id",
          url: "https://u.parachute.computer/vault/moss",
          name: "moss",
          issuer: window.location.origin,
          clientId: HOSTED_CLIENT_ID,
          scope: "vault:moss:read vault:moss:write",
          addedAt: "2026-07-01T00:00:00.000Z",
          lastUsedAt: "2026-07-01T00:00:00.000Z",
        },
      },
      activeVaultId: "moss-id",
    });
    const before = useVaultStore.getState();

    // Cloud's REAL create shape — inline token + services included. The split
    // deliberately DISCARDS them (no stored credentials until Open).
    const createSpy = vi.spyOn(client, "createVault").mockResolvedValue({
      name: "fieldnotes",
      url: "https://u.parachute.computer/vault/fieldnotes",
      vault_token: "inline-tok",
      services: {
        "vault:fieldnotes": { url: "https://u.parachute.computer/vault/fieldnotes" },
      },
    });
    const mintSpy = vi.spyOn(client, "mintVaultToken");

    const canonical = await createHostedVault("fieldnotes");
    expect(canonical).toBe("fieldnotes");
    expect(createSpy).toHaveBeenCalledWith("fieldnotes", expect.anything());
    // No C3 mint, no record, no token, no active-vault change.
    expect(mintSpy).not.toHaveBeenCalled();
    const after = useVaultStore.getState();
    expect(after.activeVaultId).toBe("moss-id");
    expect(Object.keys(after.vaults)).toEqual(Object.keys(before.vaults));
    // The discarded inline token left no stored credential behind (tokens are
    // keyed by the URL-derived vault id).
    expect(loadToken(vaultIdFromUrl("https://u.parachute.computer/vault/fieldnotes"))).toBeNull();
  });

  it("returns the requested name when the door omits its canonical echo", async () => {
    vi.spyOn(client, "createVault").mockResolvedValue({ name: "" });
    await expect(createHostedVault("moss")).resolves.toBe("moss");
    expect(useVaultStore.getState().activeVaultId).toBeNull();
  });
});
