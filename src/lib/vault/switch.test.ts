import { useToastStore } from "@/lib/toast/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useVaultStore } from "./store";
import { announceVaultSwitch, switchVault, vaultDisplayLabel } from "./switch";
import type { VaultRecord } from "./types";

function makeVault(partial: Partial<VaultRecord> & Pick<VaultRecord, "id" | "url">): VaultRecord {
  return {
    name: "",
    issuer: "http://localhost:1939",
    clientId: "client-test",
    scope: "vault:read",
    addedAt: "2026-05-12T00:00:00.000Z",
    lastUsedAt: "2026-05-12T00:00:00.000Z",
    ...partial,
  };
}

beforeEach(() => {
  useVaultStore.setState({ vaults: {}, activeVaultId: null });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  useVaultStore.setState({ vaults: {}, activeVaultId: null });
  useToastStore.setState({ toasts: [] });
});

describe("vaultDisplayLabel", () => {
  it("prefers the vault's name", () => {
    expect(vaultDisplayLabel({ name: "moss", url: "https://u.example.com/vault/moss" })).toBe(
      "moss",
    );
  });

  it("falls back to the URL host, then the raw URL", () => {
    expect(vaultDisplayLabel({ name: "", url: "https://u.example.com/vault/moss" })).toBe(
      "u.example.com",
    );
    expect(vaultDisplayLabel({ name: "", url: "not-a-url" })).toBe("not-a-url");
  });
});

describe("switchVault (§4.4 switch-confirmation)", () => {
  it("activates the vault and toasts 'Now in {vault}'", () => {
    useVaultStore.setState({
      vaults: {
        a: makeVault({ id: "a", url: "https://u.example.com/vault/moss", name: "moss" }),
        b: makeVault({ id: "b", url: "https://u.example.com/vault/techne", name: "techne" }),
      },
      activeVaultId: "a",
    });
    expect(switchVault("b", { toast: true })).toBe(true);
    expect(useVaultStore.getState().activeVaultId).toBe("b");
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ message: "Now in techne", tone: "success" });
  });

  it("toasts by default — silence is the exception", () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "https://u.example.com/vault/moss", name: "moss" }) },
      activeVaultId: null,
    });
    switchVault("a");
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["Now in moss"]);
  });

  it("stays silent with toast: false", () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "https://u.example.com/vault/moss", name: "moss" }) },
      activeVaultId: null,
    });
    switchVault("a", { toast: false });
    expect(useVaultStore.getState().activeVaultId).toBe("a");
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("does not announce when the vault is already active (nothing switched)", () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "https://u.example.com/vault/moss", name: "moss" }) },
      activeVaultId: "a",
    });
    expect(switchVault("a", { toast: true })).toBe(true);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("returns false and leaves the store untouched for an unknown id", () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "https://u.example.com/vault/moss", name: "moss" }) },
      activeVaultId: "a",
    });
    expect(switchVault("ghost", { toast: true })).toBe(false);
    expect(useVaultStore.getState().activeVaultId).toBe("a");
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe("announceVaultSwitch", () => {
  it("pushes the confirmation toast", () => {
    announceVaultSwitch("fieldnotes");
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      message: "Now in fieldnotes",
      tone: "success",
    });
  });
});
