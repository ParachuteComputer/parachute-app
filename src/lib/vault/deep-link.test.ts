import { afterEach, describe, expect, it } from "vitest";
import {
  VAULT_SCOPE_PREFIX,
  noteShareUrl,
  parseNoteRef,
  resolveVaultRef,
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

describe("resolveVaultRef", () => {
  const vaults = {
    "v-beta": vault("v-beta", "beta"),
    "v-alpha": vault("v-alpha", "alpha"),
  };

  it("finds a vault by exact name", () => {
    expect(resolveVaultRef(vaults, "alpha")?.id).toBe("v-alpha");
    expect(resolveVaultRef(vaults, "beta")?.id).toBe("v-beta");
  });

  it("falls back to a case-insensitive match", () => {
    // Server-side vault names are lowercase slugs, but a link is as likely to be
    // hand-typed as generated, and `renameVault` lets the local label drift.
    expect(resolveVaultRef(vaults, "Alpha")?.id).toBe("v-alpha");
    expect(resolveVaultRef(vaults, "BETA")?.id).toBe("v-beta");
  });

  it("prefers an exact match over a case-folded one", () => {
    const mixed = { a: vault("a", "Aaron"), b: vault("b", "aaron") };
    expect(resolveVaultRef(mixed, "aaron")?.id).toBe("b");
    expect(resolveVaultRef(mixed, "Aaron")?.id).toBe("a");
  });

  it("tolerates surrounding whitespace", () => {
    expect(resolveVaultRef(vaults, " alpha ")?.id).toBe("v-alpha");
  });

  it("returns null for an unknown, empty, or absent name", () => {
    expect(resolveVaultRef(vaults, "gamma")).toBeNull();
    expect(resolveVaultRef(vaults, "")).toBeNull();
    expect(resolveVaultRef(vaults, "   ")).toBeNull();
    expect(resolveVaultRef(vaults, undefined)).toBeNull();
    expect(resolveVaultRef({}, "alpha")).toBeNull();
  });

  it("finds a vault by its id — the form that survives a local rename (app#191)", () => {
    // `vaultIdFromUrl` derives the id from the vault URL, so it is identical on
    // every device that connected the same vault; `name` is locally editable.
    // A link written with the id therefore resolves even where the label drifted.
    const renamed = { box_vault_aaron: vault("box_vault_aaron", "Aaron's stuff") };
    expect(resolveVaultRef(renamed, "box_vault_aaron")?.id).toBe("box_vault_aaron");
    expect(resolveVaultRef(renamed, "BOX_VAULT_AARON")?.id).toBe("box_vault_aaron");
    // …and the drifted label still works on the device that drifted it.
    expect(resolveVaultRef(renamed, "Aaron's stuff")?.id).toBe("box_vault_aaron");
  });

  it("prefers a NAME match over another vault's id", () => {
    // The readable form is what the app emits and what a human types, so when a
    // reference is both (pathologically) it resolves to the vault it NAMES.
    const clash = { a: vault("beta", "alpha"), b: vault("b-id", "beta") };
    expect(resolveVaultRef(clash, "beta")?.id).toBe("b-id");
  });

  it("prefers an exact id over a case-folded name", () => {
    const clash = { a: vault("aaron", "zeta"), b: vault("z-id", "AARON") };
    expect(resolveVaultRef(clash, "aaron")?.id).toBe("aaron");
  });

  it("is deterministic when two vaults case-fold to the same name", () => {
    // Key insertion order must not decide the answer — id order does.
    const one = { z: vault("z", "Aaron"), a: vault("a", "AARON") };
    const two = { a: vault("a", "AARON"), z: vault("z", "Aaron") };
    expect(resolveVaultRef(one, "aaron")?.id).toBe(resolveVaultRef(two, "aaron")?.id);
    expect(resolveVaultRef(one, "aaron")?.id).toBe("a");
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

describe("parseNoteRef", () => {
  it("takes the whole multi-segment remainder as the note path", () => {
    // A note is addressable by path, and a path has slashes. `/v/aaron/n/` +
    // `Projects/2026/Roadmap` is the hand-written form of the same address the
    // app emits percent-encoded.
    expect(parseNoteRef("Projects/2026/Roadmap")).toEqual({
      ref: "Projects/2026/Roadmap",
      suffix: "",
    });
  });

  it("passes a single-segment reference (a ULID id) straight through", () => {
    expect(parseNoteRef("01JBQZ0Q2M8T9V5X7YB3KD4WEN")).toEqual({
      ref: "01JBQZ0Q2M8T9V5X7YB3KD4WEN",
      suffix: "",
    });
  });

  it("claims a trailing /edit as the editor tail", () => {
    expect(parseNoteRef("Projects/2026/Roadmap/edit")).toEqual({
      ref: "Projects/2026/Roadmap",
      suffix: "/edit",
    });
    expect(parseNoteRef("Projects/edit")).toEqual({ ref: "Projects", suffix: "/edit" });
    // But a note literally NAMED `edit` is one segment — it is the reference,
    // not a tail. (It never reaches this parser in the router: one segment
    // matches the higher-ranked `:id` route. Pinned so the two agree.)
    expect(parseNoteRef("edit")).toEqual({ ref: "edit", suffix: "" });
  });

  it("tolerates leading and trailing slashes on the splat", () => {
    expect(parseNoteRef("/Projects/Roadmap/")).toEqual({ ref: "Projects/Roadmap", suffix: "" });
  });

  it("returns null when there is no reference left to resolve", () => {
    // `/v/<vault>/n/` — the caller decides where an empty note address goes
    // (that vault's list, not a 404).
    expect(parseNoteRef("")).toBeNull();
    expect(parseNoteRef("/")).toBeNull();
    expect(parseNoteRef(undefined)).toBeNull();
    expect(parseNoteRef(null)).toBeNull();
  });
});
