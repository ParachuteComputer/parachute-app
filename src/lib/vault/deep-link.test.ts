import { afterEach, describe, expect, it } from "vitest";
import {
  VAULT_SCOPE_PREFIX,
  findVaultByName,
  noteShareUrl,
  vaultScopedNotePath,
} from "./deep-link";
import type { VaultRecord } from "./types";

function vault(id: string, name: string): VaultRecord {
  return {
    id,
    url: `http://localhost:1940/vault/${name}`,
    name,
    issuer: "http://localhost:1940",
    clientId: "c",
    scope: "full",
    addedAt: "2026-08-30T00:00:00.000Z",
    lastUsedAt: "2026-08-30T00:00:00.000Z",
  };
}

describe("findVaultByName", () => {
  const vaults = {
    "v-beta": vault("v-beta", "beta"),
    "v-alpha": vault("v-alpha", "alpha"),
  };

  it("finds a vault by exact name", () => {
    expect(findVaultByName(vaults, "alpha")?.id).toBe("v-alpha");
    expect(findVaultByName(vaults, "beta")?.id).toBe("v-beta");
  });

  it("falls back to a case-insensitive match", () => {
    // Server-side vault names are lowercase slugs, but a link is as likely to be
    // hand-typed as generated, and `renameVault` lets the local label drift.
    expect(findVaultByName(vaults, "Alpha")?.id).toBe("v-alpha");
    expect(findVaultByName(vaults, "BETA")?.id).toBe("v-beta");
  });

  it("prefers an exact match over a case-folded one", () => {
    const mixed = { a: vault("a", "Aaron"), b: vault("b", "aaron") };
    expect(findVaultByName(mixed, "aaron")?.id).toBe("b");
    expect(findVaultByName(mixed, "Aaron")?.id).toBe("a");
  });

  it("tolerates surrounding whitespace", () => {
    expect(findVaultByName(vaults, " alpha ")?.id).toBe("v-alpha");
  });

  it("returns null for an unknown, empty, or absent name", () => {
    expect(findVaultByName(vaults, "gamma")).toBeNull();
    expect(findVaultByName(vaults, "")).toBeNull();
    expect(findVaultByName(vaults, "   ")).toBeNull();
    expect(findVaultByName(vaults, undefined)).toBeNull();
    expect(findVaultByName({}, "alpha")).toBeNull();
  });

  it("is deterministic when two vaults case-fold to the same name", () => {
    // Key insertion order must not decide the answer — id order does.
    const one = { z: vault("z", "Aaron"), a: vault("a", "AARON") };
    const two = { a: vault("a", "AARON"), z: vault("z", "Aaron") };
    expect(findVaultByName(one, "aaron")?.id).toBe(findVaultByName(two, "aaron")?.id);
    expect(findVaultByName(one, "aaron")?.id).toBe("a");
  });
});

describe("vaultScopedNotePath", () => {
  it("builds the /v/<vault>/n/<id> shape", () => {
    expect(vaultScopedNotePath("aaron", "abc123")).toBe("/v/aaron/n/abc123");
    expect(VAULT_SCOPE_PREFIX).toBe("/v");
  });

  it("carries the /edit tail", () => {
    expect(vaultScopedNotePath("aaron", "abc123", "/edit")).toBe("/v/aaron/n/abc123/edit");
  });

  it("percent-encodes both segments so a pathy id can't forge extra segments", () => {
    expect(vaultScopedNotePath("aaron", "Projects/README")).toBe("/v/aaron/n/Projects%2FREADME");
    expect(vaultScopedNotePath("my vault", "a b")).toBe("/v/my%20vault/n/a%20b");
  });

  it("is NOT the reserved /vault namespace", () => {
    // `/vault/<name>/*` is the hub's per-vault proxy and the my.-phase vault
    // worker's data plane — an SPA route there would be a genuine collision.
    // This pins the one-letter prefix that avoids it.
    expect(vaultScopedNotePath("aaron", "x").startsWith("/vault/")).toBe(false);
    expect(vaultScopedNotePath("aaron", "x").startsWith("/v/")).toBe(true);
  });
});

describe("noteShareUrl", () => {
  const originalPath = window.location.pathname;
  afterEach(() => {
    window.history.replaceState({}, "", originalPath);
  });

  it("is absolute and vault-scoped at the root mount", () => {
    window.history.replaceState({}, "", "/n/abc123");
    expect(noteShareUrl("aaron", "abc123", "https://app.parachute.computer")).toBe(
      "https://app.parachute.computer/v/aaron/n/abc123",
    );
  });

  it("carries the runtime mount prefix so a pasted link survives on a mounted host", () => {
    // Under a `/notes` or `/surface/<slug>` mount the bare `/v/...` form would
    // 404 on paste — the mount has to ride along.
    window.history.replaceState({}, "", "/notes/n/abc123");
    expect(noteShareUrl("aaron", "abc123", "https://box.example")).toBe(
      "https://box.example/notes/v/aaron/n/abc123",
    );
    window.history.replaceState({}, "", "/surface/parachute/n/abc123");
    expect(noteShareUrl("aaron", "abc123", "https://box.example")).toBe(
      "https://box.example/surface/parachute/v/aaron/n/abc123",
    );
  });

  it("defaults to the current origin", () => {
    window.history.replaceState({}, "", "/n/abc123");
    expect(noteShareUrl("aaron", "abc123")).toBe(`${window.location.origin}/v/aaron/n/abc123`);
  });
});
