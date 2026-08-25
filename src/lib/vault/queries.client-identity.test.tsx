import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useActiveVaultClient } from "./queries";
import { saveToken } from "./storage";
import { useVaultStore } from "./store";
import type { VaultRecord } from "./types";

function makeVault(over: Partial<VaultRecord> = {}): VaultRecord {
  return {
    id: "v1",
    url: "https://example.test/vault/v1",
    name: "Test",
    issuer: "https://example.test",
    clientId: "cid",
    scope: "full",
    addedAt: "2026-01-01T00:00:00Z",
    lastUsedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function seed(over: Partial<VaultRecord> = {}) {
  const v = makeVault(over);
  useVaultStore.setState({ vaults: { [v.id]: v }, activeVaultId: v.id });
  saveToken(v.id, { accessToken: "tok", scope: "full", vault: v.url });
  return v;
}

describe("useActiveVaultClient identity (app#110)", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seed();
  });
  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  it("two hook instances share one VaultClient", () => {
    const { result } = renderHook(() => ({
      a: useActiveVaultClient(),
      b: useActiveVaultClient(),
    }));
    expect(result.current.a).not.toBeNull();
    expect(result.current.a).toBe(result.current.b);
  });

  it("a remount reuses the same VaultClient", () => {
    const first = renderHook(() => useActiveVaultClient());
    const held = first.result.current;
    expect(held).not.toBeNull();
    first.unmount();

    const second = renderHook(() => useActiveVaultClient());
    expect(second.result.current).toBe(held);
    second.unmount();
  });

  it("renameVault does not mint a new client", () => {
    const { result } = renderHook(() => useActiveVaultClient());
    const first = result.current;
    expect(first).not.toBeNull();
    act(() => {
      useVaultStore.getState().renameVault("v1", "Renamed");
    });
    expect(useVaultStore.getState().vaults.v1?.name).toBe("Renamed");
    expect(result.current).toBe(first);
  });

  it("touchActive does not mint a new client", () => {
    const { result } = renderHook(() => useActiveVaultClient());
    const first = result.current;
    const before = useVaultStore.getState().vaults.v1?.lastUsedAt;
    act(() => {
      useVaultStore.getState().touchActive("v1");
    });
    expect(useVaultStore.getState().vaults.v1?.lastUsedAt).not.toBe(before);
    expect(result.current).toBe(first);
  });

  it("switching vaults yields a different client", () => {
    const v2 = makeVault({ id: "v2", url: "https://example.test/vault/v2", name: "Other" });
    saveToken("v2", { accessToken: "tok2", scope: "full", vault: v2.url });
    act(() => {
      useVaultStore.setState((s) => ({ vaults: { ...s.vaults, v2 } }));
    });

    const { result } = renderHook(() => useActiveVaultClient());
    const first = result.current;
    expect(first).not.toBeNull();

    act(() => {
      useVaultStore.getState().setActiveVault("v2");
    });
    expect(result.current).not.toBeNull();
    expect(result.current).not.toBe(first);
  });

  it("returns null when the token is missing", () => {
    localStorage.clear();
    const { result } = renderHook(() => useActiveVaultClient());
    expect(result.current).toBeNull();
  });
});
