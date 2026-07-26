#!/usr/bin/env bun

/**
 * bigvault — a realistic-scale sandbox vault, one command.
 *
 * Why this exists: every test vault this repo ever drove the UI against had
 * ~15 notes and 3–4 tags, and two real bugs shipped that toy scale could not
 * show — the blind filter panel at 49 tags, and a tag page that fetched 620
 * notes into a ~128,000px document. A realistic vault (power-law tag counts,
 * slash families, schemas up to nine fields) has to be one command away or
 * nobody runs it. See scripts/bigvault/README.md.
 *
 *   bun run bigvault up                        # 47 tags / 2,600 notes on :19572
 *   bun run bigvault up --tags 500 --notes 10000   # find the next ceiling
 *   bun run bigvault status
 *   bun run bigvault down [--wipe]
 *
 * Needs a parachute-vault checkout for the server: sibling ../parachute-vault
 * by default, or --vault-repo / PARACHUTE_VAULT_REPO.
 *
 * Deterministic: same --seed/--anchor (and size flags), same vault. Sandboxed
 * by construction: marker-gated home, live ports refused, pid-only kills —
 * see sandbox.ts.
 */

import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { backdateVault } from "./backdate.ts";
import {
  DEFAULT_HOME,
  DEFAULT_PORT,
  DEFAULT_TOKEN,
  type SandboxRuntime,
  assertSandboxHome,
  assertSandboxPort,
  readRuntime,
  removeSandboxHome,
  wipeSandboxHome,
  writeRuntime,
} from "./sandbox.ts";
import { seedVault } from "./seed.ts";
import { DEFAULT_PARAMS, type TaxonomyParams, buildNotePlan, buildTaxonomy } from "./taxonomy.ts";

const HELP = `bigvault — a realistic-scale sandbox vault, one command

usage: bun run bigvault <up|down|status> [options]

  up       wipe + boot + seed + backdate + reboot; prints the vault URL + token
  down     stop the sandbox vault server (--wipe also deletes the sandbox home)
  status   what is running and what is in it

options (defaults in brackets):
  --tags N          tag count [${DEFAULT_PARAMS.tags}]
  --notes N         note count, spread power-law [${DEFAULT_PARAMS.notes}]
  --schema-share F  fraction of tags with field schemas, 0–1 [${DEFAULT_PARAMS.schemaShare}]
  --max-fields N    ceiling schema size; one tag always carries it [${DEFAULT_PARAMS.maxFields}]
  --seed N          PRNG seed — same seed, same vault [${DEFAULT_PARAMS.seed}]
  --anchor DATE     YYYY-MM-DD treated as "now" for timestamps [today UTC]
  --home DIR        sandbox home [$TMPDIR/parachute-bigvault]
  --port N          vault server port; 1939/1940/1941 are refused [${DEFAULT_PORT}]
  --token S         vault auth token [${DEFAULT_TOKEN}]
  --vault-repo DIR  parachute-vault checkout [../parachute-vault or $PARACHUTE_VAULT_REPO]
`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    tags: { type: "string" },
    notes: { type: "string" },
    "schema-share": { type: "string" },
    "max-fields": { type: "string" },
    seed: { type: "string" },
    anchor: { type: "string" },
    home: { type: "string" },
    port: { type: "string" },
    token: { type: "string" },
    "vault-repo": { type: "string" },
    wipe: { type: "boolean" },
    help: { type: "boolean" },
  },
});

function num(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number, got "${raw}"`);
  return n;
}

function parseAnchor(raw: string | undefined): number {
  if (raw === undefined) {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) throw new Error(`--anchor must be YYYY-MM-DD, got "${raw}"`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const base = (port: number): string => `http://127.0.0.1:${port}/vault/default`;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isPortResponsive(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch (err) {
    // A timeout means something accepted the connection — that counts.
    return err instanceof Error && err.name === "TimeoutError";
  }
}

/** Signal ONLY the given pid (never kill by port), then wait for the port. */
async function stopPid(pid: number, port: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 1) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return; // already gone
  }
  for (let i = 0; i < 20 && alive(pid); i++) await sleep(250);
  if (alive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* raced to exit — fine */
    }
  }
  for (let i = 0; i < 20 && (await isPortResponsive(port)); i++) await sleep(250);
}

function resolveVaultRepo(arg: string | undefined): string {
  const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
  const candidates = [
    arg,
    process.env.PARACHUTE_VAULT_REPO,
    join(repoRoot, "..", "parachute-vault"),
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    if (existsSync(join(resolve(c), "src", "server.ts"))) return resolve(c);
  }
  throw new Error(
    `no parachute-vault checkout found (tried: ${candidates.map((c) => resolve(c)).join(", ")}). Pass --vault-repo <path> or set PARACHUTE_VAULT_REPO.`,
  );
}

function bootVault(opts: {
  home: string;
  port: number;
  token: string;
  vaultRepo: string;
}): number {
  const log = openSync(join(opts.home, "vault-server.log"), "a");
  const child = spawn(process.execPath, ["src/server.ts"], {
    cwd: opts.vaultRepo,
    env: {
      ...process.env,
      PARACHUTE_HOME: opts.home,
      PARACHUTE_VAULT_NAME: "default",
      PORT: String(opts.port),
      VAULT_AUTH_TOKEN: opts.token,
    },
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  if (child.pid === undefined) throw new Error("failed to spawn the vault server");
  return child.pid;
}

async function waitForVault(port: number, token: string, home: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base(port)}/api/tags`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(
    `vault did not come up on :${port} within 30s — see ${join(home, "vault-server.log")}`,
  );
}

async function fetchTagCount(port: number, token: string): Promise<number> {
  const res = await fetch(`${base(port)}/api/tags`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const tags = (await res.json()) as unknown[];
  return tags.length;
}

async function up(): Promise<void> {
  const params: TaxonomyParams = {
    tags: num("tags", values.tags, DEFAULT_PARAMS.tags),
    notes: num("notes", values.notes, DEFAULT_PARAMS.notes),
    schemaShare: num("schema-share", values["schema-share"], DEFAULT_PARAMS.schemaShare),
    maxFields: num("max-fields", values["max-fields"], DEFAULT_PARAMS.maxFields),
    seed: num("seed", values.seed, DEFAULT_PARAMS.seed),
  };
  const anchorMs = parseAnchor(values.anchor);
  const port = num("port", values.port, DEFAULT_PORT);
  const token = values.token ?? DEFAULT_TOKEN;
  assertSandboxPort(port);
  const home = assertSandboxHome(values.home ?? DEFAULT_HOME);
  const vaultRepo = resolveVaultRepo(values["vault-repo"]);

  // Build the plan before touching anything — bad params die here.
  const taxonomy = buildTaxonomy(params);
  const plan = buildNotePlan(taxonomy, params.seed, anchorMs);
  const heaviest = taxonomy.reduce((a, b) => (b.count > a.count ? b : a));
  const richest = taxonomy.reduce((a, b) => {
    const fa = a.fields ? Object.keys(a.fields).length : 0;
    const fb = b.fields ? Object.keys(b.fields).length : 0;
    return fb > fa ? b : a;
  });
  const runtime: SandboxRuntime = {
    port,
    token,
    pid: 0,
    anchorMs,
    seed: params.seed,
    params: {
      tags: params.tags,
      notes: params.notes,
      schemaShare: params.schemaShare,
      maxFields: params.maxFields,
    },
    noteCount: plan.length,
    heaviestTag: heaviest.name,
    richestTag: richest.name,
    startedAt: new Date().toISOString(),
  };

  // Stop OUR previous server if one is recorded; refuse a port someone else holds.
  const previous = readRuntime(home);
  if (previous) await stopPid(previous.pid, previous.port);
  if (await isPortResponsive(port))
    throw new Error(
      `something else is listening on :${port} — not touching it. Choose --port, or stop that process yourself.`,
    );

  console.log(`== sandbox ${home} ==`);
  wipeSandboxHome(home);

  console.log(`== boot (vault repo: ${vaultRepo}) ==`);
  runtime.pid = bootVault({ home, port, token, vaultRepo });
  writeRuntime(home, runtime); // recorded immediately so a crashed run can still `down`
  await waitForVault(port, token, home);

  const anchorDate = new Date(anchorMs).toISOString().slice(0, 10);
  console.log(
    `== seed: ${taxonomy.length} tags, ${plan.length} notes ` +
      `(seed ${params.seed}, anchor ${anchorDate}) ==`,
  );
  await seedVault({ base: base(port), token, taxonomy, plan });

  console.log("== backdate: spreading touches over ~2 years ==");
  await stopPid(runtime.pid, port);
  const backdated = backdateVault(home, anchorMs);
  console.log(`   backdated ${backdated} notes`);

  runtime.pid = bootVault({ home, port, token, vaultRepo });
  writeRuntime(home, runtime);
  await waitForVault(port, token, home);

  const tagCount = await fetchTagCount(port, token);
  console.log("== ready ==");
  console.log(
    `   vault   http://localhost:${port}/vault/default  (${tagCount} tags, ~${plan.length} notes)`,
  );
  console.log(`   token   ${token}`);
  console.log(`   home    ${home}`);
  console.log("   Connect: bun run dev, then add a vault in the app with that URL + token.");
  console.log("   Tear down: bun run bigvault down [--wipe]");
}

async function down(): Promise<void> {
  const home = values.home ?? DEFAULT_HOME;
  const runtime = readRuntime(home);
  if (runtime) {
    await stopPid(runtime.pid, runtime.port);
    console.log(`stopped vault server (pid ${runtime.pid})`);
  } else {
    console.log(`no bigvault sandbox recorded at ${resolve(home)} — nothing to stop`);
  }
  if (values.wipe) {
    removeSandboxHome(home);
    console.log(`removed ${resolve(home)}`);
  }
}

async function status(): Promise<void> {
  const home = values.home ?? DEFAULT_HOME;
  const runtime = readRuntime(home);
  if (!runtime) {
    console.log(`no bigvault sandbox at ${resolve(home)} — run: bun run bigvault up`);
    return;
  }
  const running = alive(runtime.pid) && (await isPortResponsive(runtime.port));
  const p = runtime.params;
  console.log(`sandbox   ${resolve(home)}`);
  console.log(
    `params    ${p.tags} tags / ${p.notes} notes / schema-share ${p.schemaShare} / ` +
      `max-fields ${p.maxFields} / seed ${runtime.seed}`,
  );
  console.log(`anchor    ${new Date(runtime.anchorMs).toISOString().slice(0, 10)}`);
  console.log(`heaviest  #${runtime.heaviestTag}   richest schema  #${runtime.richestTag}`);
  if (running) {
    const tagCount = await fetchTagCount(runtime.port, runtime.token);
    console.log(`server    UP — http://localhost:${runtime.port}/vault/default (${tagCount} tags)`);
    console.log(`token     ${runtime.token}`);
  } else {
    console.log(`server    DOWN (last pid ${runtime.pid}) — re-run: bun run bigvault up`);
  }
}

if (process.env.PARACHUTE_HOME) {
  console.error(
    `note: ignoring PARACHUTE_HOME=${process.env.PARACHUTE_HOME} — bigvault only ever touches its own sandbox home.`,
  );
}

const command = positionals[0] ?? "help";
try {
  if (values.help || command === "help") {
    console.log(HELP);
  } else if (command === "up") {
    await up();
  } else if (command === "down") {
    await down();
  } else if (command === "status") {
    await status();
  } else {
    console.error(`unknown command: ${command}\n\n${HELP}`);
    process.exit(1);
  }
} catch (err) {
  console.error(`bigvault: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
