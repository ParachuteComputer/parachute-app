#!/usr/bin/env bun

/**
 * Dist smoke test — asserts the built `dist/` is the shape the hub's static
 * server expects before we ship it to npm.
 *
 * Why this exists: `@openparachute/parachute-app` publishes a PREBUILT SPA.
 * Consumers do not build it — `parachute install app` runs `bun add -g
 * @openparachute/parachute-app`, then `parachute start app` spawns hub's
 * `src/notes-serve.ts --package @openparachute/parachute-app`, which resolves
 * `<package root>/dist` via `Bun.resolveSync("<pkg>/package.json", …)` and
 * serves files straight out of it. A tarball with a missing or truncated
 * `dist/` is therefore a broken install with no build step to save it, and
 * the failure only shows up on a self-hoster's box.
 *
 * The hub resolver hard-errors when `dist/` is absent; everything below that
 * (an index.html that never got its asset tags, an empty assets/, a missing
 * service worker) it will happily serve as a blank page. So we check the
 * shape here, in CI, on every build.
 *
 * Run: `bun run test:smoke` (after `bun run build`).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Standard ESM rather than Bun's `import.meta.dir` — this file is compiled by
// `tsc -b` under tsconfig.node.json, whose lib doesn't declare the Bun-only
// ImportMeta members.
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const dist = join(root, "dist");

const failures: string[] = [];
const notes: string[] = [];

function fail(msg: string): void {
  failures.push(msg);
}

function requireFile(relative: string, minBytes = 1): void {
  const path = join(dist, relative);
  if (!existsSync(path)) {
    fail(`missing dist/${relative}`);
    return;
  }
  const size = statSync(path).size;
  if (size < minBytes) {
    fail(`dist/${relative} is ${size} bytes (expected >= ${minBytes})`);
    return;
  }
  notes.push(`dist/${relative} — ${size} bytes`);
}

// 1. The resolver's hard requirement: dist/ itself.
if (!existsSync(dist)) {
  console.error(
    "verify-dist: dist/ does not exist. Run `bun run build` first.\n" +
      "(`prepack` does this automatically for `npm pack` / `npm publish`.)",
  );
  process.exit(1);
}

// 2. The SPA shell. notes-serve.ts falls back to this for every unmatched
//    route, so a missing index.html means every route 404s at the file read.
requireFile("index.html", 200);

// 3. index.html must actually reference a hashed bundle. A shell with no
//    <script> tag is the classic "build ran but emitted nothing" tarball:
//    it serves 200s and renders a blank page.
const indexHtml = readFileSync(join(dist, "index.html"), "utf8");
const scriptRefs = [...indexHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
const styleRefs = [...indexHtml.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(
  (m) => m[1],
);
if (scriptRefs.length === 0) fail("dist/index.html references no <script src=…> bundle");
if (styleRefs.length === 0) fail("dist/index.html references no stylesheet");

// 4. Every asset index.html points at must exist on disk. Catches a partial
//    copy into the tarball as well as a partial build.
for (const ref of [...scriptRefs, ...styleRefs]) {
  // Vite emits relative ("./assets/x.js") or root-absolute ("/assets/x.js")
  // URLs depending on `base`; both resolve against dist/.
  if (/^https?:\/\//.test(ref)) continue;
  const rel = ref.replace(/^\.?\//, "");
  if (!existsSync(join(dist, rel)))
    fail(`dist/index.html references ${ref}, which is not in dist/`);
}

// 5. assets/ must be non-empty — the hashed JS/CSS chunks the shell loads.
const assetsDir = join(dist, "assets");
if (!existsSync(assetsDir)) {
  fail("missing dist/assets/");
} else {
  const assets = readdirSync(assetsDir);
  if (assets.length === 0) fail("dist/assets/ is empty");
  else notes.push(`dist/assets/ — ${assets.length} files`);
}

// 6. PWA surface. The service worker + manifest are why notes-serve.ts strips
//    its --mount prefix; shipping without them silently downgrades the install
//    to a plain web page.
requireFile("sw.js", 100);
requireFile("manifest.webmanifest", 50);
requireFile("icon.svg", 50);

// 7. The runtime service-info endpoint hub's module surfaces read.
requireFile(".parachute/info", 20);
if (existsSync(join(dist, ".parachute/info"))) {
  const info = JSON.parse(readFileSync(join(dist, ".parachute/info"), "utf8")) as {
    name?: string;
    version?: string;
  };
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
  if (info.name !== "parachute-app") {
    fail(`dist/.parachute/info name is "${info.name}", expected "parachute-app"`);
  }
  if (info.version !== pkg.version) {
    fail(
      `dist/.parachute/info version is "${info.version}" but package.json is "${pkg.version}" — stale build`,
    );
  }
}

for (const note of notes) console.log(`  ok  ${note}`);

if (failures.length > 0) {
  console.error(`\nverify-dist: ${failures.length} problem(s) with dist/:`);
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}

console.log(`\nverify-dist: dist/ looks publishable (${notes.length} checks passed).`);
