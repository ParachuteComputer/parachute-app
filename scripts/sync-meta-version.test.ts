import { describe, expect, it } from "vitest";
import { syncMetaVersion } from "./sync-meta-version";

const SAMPLE = `{
  "$schema": "https://parachute.computer/schemas/app-ui-meta.json",
  "name": "parachute",
  "displayName": "Parachute",
  "tagline": "The Parachute app — your parachute's front door.",
  "version": "0.1.3",
  "path": "/surface/parachute",
  "iconUrl": "icon.svg",
  "scopes_required": ["vault:*:read", "vault:*:write"],
  "pwa": true,
  "pwa_service_worker": "sw.js",
  "required_schema": {
    "tags": [
      {
        "name": "capture",
        "description": "Notes captured directly by the user (text or voice)."
      }
    ]
  }
}
`;

describe("syncMetaVersion", () => {
  it("rewrites a stale version to match package.json", () => {
    const { raw, changed } = syncMetaVersion(SAMPLE, "0.22.11");
    expect(changed).toBe(true);
    expect(JSON.parse(raw).version).toBe("0.22.11");
  });

  it("is a no-op when the version already matches", () => {
    const { raw, changed } = syncMetaVersion(SAMPLE, "0.1.3");
    expect(changed).toBe(false);
    expect(raw).toBe(SAMPLE);
  });

  it("touches only the version field — every other byte is untouched", () => {
    const { raw } = syncMetaVersion(SAMPLE, "0.22.11");
    const expected = SAMPLE.replace('"version": "0.1.3"', '"version": "0.22.11"');
    expect(raw).toBe(expected);
    // Hand-formatted single-line array survives (this is exactly what a
    // parse+stringify round-trip would have destroyed).
    expect(raw).toContain('"scopes_required": ["vault:*:read", "vault:*:write"],');
  });

  it("produces valid JSON with the new version parseable back out", () => {
    const { raw } = syncMetaVersion(SAMPLE, "1.2.3-rc.4");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe("1.2.3-rc.4");
    expect(parsed.name).toBe("parachute");
    expect(parsed.scopes_required).toEqual(["vault:*:read", "vault:*:write"]);
  });

  it("is a no-op when there is no version field to rewrite", () => {
    const noVersion = `{ "name": "parachute" }`;
    const { raw, changed } = syncMetaVersion(noVersion, "0.22.11");
    expect(changed).toBe(false);
    expect(raw).toBe(noVersion);
  });
});
