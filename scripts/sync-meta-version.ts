#!/usr/bin/env bun

/**
 * Keep `meta.json`'s `version` field in lockstep with `package.json`.
 *
 * Why this exists: `meta.json` ships verbatim in the npm tarball (it's in
 * `package.json`'s `files` array, unlike `dist/`, which is generated).
 * parachute-surface reads it — via `meta-schema.ts` in surface-host — to
 * register this app and to know what version is installed. Because it's a
 * hand-maintained file, nobody kept it in sync with releases: it shipped
 * "0.1.3" through 0.22.11 and every release before that (parachute-app#136).
 *
 * The fix is to stop hand-maintaining it. This script derives `version` from
 * `package.json` and writes it into `meta.json` in place, so the source of
 * truth is package.json's version line (the thing governance already gates
 * releases on) rather than a second copy nobody remembers to bump.
 *
 * Wired into `build` (and therefore `prepack`, which `npm pack`/`npm
 * publish` both run) so the tarball always carries the real version — see
 * package.json scripts and release.yml's "build the SPA bundle" step.
 *
 * Run: `bun run sync-meta-version` (also runs automatically via `bun run
 * build`).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Rewrites the `"version": "..."` line in raw `meta.json` text to `version`,
 * leaving every other byte untouched — no re-serialization, so hand-chosen
 * formatting (compact arrays, key order, comments-via-`$schema`, whatever)
 * survives exactly as written. Returns the original text unchanged if there
 * is no `version` field to replace (caller decides whether that's an error)
 * or if it already matches.
 *
 * A targeted regex rather than `JSON.parse` + `JSON.stringify` deliberately:
 * this repo's `meta.json` is formatted by hand (e.g. `"scopes_required":
 * ["a", "b"]` on one line) in a way `JSON.stringify(obj, null, 2)` does not
 * reproduce — round-tripping through it would reformat the whole file on
 * every build for a one-field change.
 */
export function syncMetaVersion(raw: string, version: string): { raw: string; changed: boolean } {
  const match = raw.match(/"version"\s*:\s*"([^"]*)"/);
  if (!match) {
    return { raw, changed: false };
  }
  const [full, current] = match;
  if (current === version) {
    return { raw, changed: false };
  }
  const replaced =
    raw.slice(0, match.index) +
    full.replace(current, version) +
    raw.slice((match.index ?? 0) + full.length);
  return { raw: replaced, changed: true };
}

if (import.meta.main) {
  const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
  const pkgPath = join(root, "package.json");
  const metaPath = join(root, "meta.json");

  if (!existsSync(metaPath)) {
    console.error(`sync-meta-version: ${metaPath} does not exist`);
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  const rawMeta = readFileSync(metaPath, "utf8");

  // Parse only to validate the file is well-formed JSON and to report the
  // "before" value; the actual rewrite works on the raw text (see above).
  const before = (JSON.parse(rawMeta) as { version?: string }).version;

  const { raw: updated, changed } = syncMetaVersion(rawMeta, pkg.version);

  if (!changed) {
    console.log(`sync-meta-version: meta.json already at ${pkg.version}`);
  } else {
    writeFileSync(metaPath, updated);
    // Fail loudly if the regex rewrite produced invalid JSON — better than
    // shipping a broken meta.json in the tarball.
    JSON.parse(updated);
    console.log(`sync-meta-version: meta.json ${String(before)} -> ${pkg.version}`);
  }
}
