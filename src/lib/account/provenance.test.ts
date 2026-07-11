import { describe, expect, it } from "vitest";
import { HOSTED_CLIENT_ID } from "./hosted-vault";
import { formatBytes, formatUsageBytes, homeDoorLabel, vaultProvenance } from "./provenance";

describe("vaultProvenance", () => {
  it("classifies a home-door vault as Cloud", () => {
    const p = vaultProvenance({
      clientId: HOSTED_CLIENT_ID,
      issuer: "https://app.parachute.computer",
      url: "https://u.parachute.computer/vault/moss",
    });
    expect(p).toEqual({ kind: "cloud", label: "Cloud" });
    expect(p.label).toBe(homeDoorLabel());
  });

  it("classifies an OAuth vault as self-hosted, host from the issuer", () => {
    const p = vaultProvenance({
      clientId: "some-oauth-client-id",
      issuer: "https://hub.example.com",
      url: "https://hub.example.com/vault/boulder",
    });
    expect(p).toEqual({
      kind: "self-hosted",
      host: "hub.example.com",
      label: "Self-hosted · hub.example.com",
    });
  });

  it("falls back to the vault URL host when the issuer is unparseable", () => {
    const p = vaultProvenance({
      clientId: "oauth",
      issuer: "",
      url: "https://box.local:1940/vault/x",
    });
    expect(p).toEqual({
      kind: "self-hosted",
      host: "box.local:1940",
      label: "Self-hosted · box.local:1940",
    });
  });

  it("never fabricates a host — neutral phrase when nothing parses", () => {
    const p = vaultProvenance({ clientId: "oauth", issuer: "nonsense", url: "also-nonsense" });
    expect(p).toEqual({
      kind: "self-hosted",
      host: "your server",
      label: "Self-hosted · your server",
    });
  });
});

describe("formatBytes", () => {
  it("returns null for zero / negative / non-finite", () => {
    expect(formatBytes(0)).toBeNull();
    expect(formatBytes(-1)).toBeNull();
    expect(formatBytes(Number.NaN)).toBeNull();
  });

  it("formats KB (at least 1)", () => {
    expect(formatBytes(500)).toBe("1 KB");
    expect(formatBytes(4096)).toBe("4 KB");
  });

  it("formats MB — one decimal below 10, rounded above", () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(68 * 1024 * 1024)).toBe("68 MB");
  });

  it("formats GB above 1024 MB", () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
    expect(formatBytes(20 * 1024 * 1024 * 1024)).toBe("20 GB");
  });
});

describe("formatUsageBytes", () => {
  it("sums notes + attachments", () => {
    expect(
      formatUsageBytes({ notes_bytes: 40 * 1024 * 1024, attachment_bytes: 28 * 1024 * 1024 }),
    ).toBe("68 MB");
  });

  it("returns null for undefined / null / empty", () => {
    expect(formatUsageBytes(undefined)).toBeNull();
    expect(formatUsageBytes(null)).toBeNull();
    expect(formatUsageBytes({})).toBeNull();
    expect(formatUsageBytes({ notes_bytes: 0, attachment_bytes: 0 })).toBeNull();
  });
});
