/**
 * Sandbox guards — the part where conservative beats convenient.
 *
 * bigvault stress-tests the app against a big vault, and a big vault is
 * exactly what a REAL home directory looks like. So every destructive step is
 * gated by construction, not convention:
 *
 * - The sandbox home must carry the `.bigvault-sandbox` marker file. We only
 *   create, wipe, or backdate a directory we created ourselves; an existing
 *   directory without the marker is refused, loudly — and a directory that
 *   contains or lives inside the real `~/.parachute` is refused outright,
 *   marker or not.
 * - The live trio (:1939 hub, :1940 vault, :1941 agent gateway) and
 *   privileged ports are refused; the seeder only ever dials 127.0.0.1 on a
 *   port it validated, never a caller-supplied URL.
 * - We never kill by port. Only the pid recorded at boot is signalled.
 * - An ambient PARACHUTE_HOME env var is ignored (and warned about) — the
 *   sandbox home comes from `--home` or the default, nothing else.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

export const MARKER = ".bigvault-sandbox";
export const DEFAULT_HOME = join(tmpdir(), "parachute-bigvault");
export const DEFAULT_PORT = 19572;
export const DEFAULT_TOKEN = "bigvault-token";
/** Where the live parachute stack listens — never ours to touch. */
export const LIVE_PORTS: ReadonlySet<number> = new Set([1939, 1940, 1941]);

const RUNTIME_FILE = "bigvault.json";

/** What `up` records so seed/backdate/probe/down can only ever act on it. */
export interface SandboxRuntime {
  port: number;
  token: string;
  pid: number;
  anchorMs: number;
  seed: number;
  params: { tags: number; notes: number; schemaShare: number; maxFields: number };
  noteCount: number;
  /** Probe hints: the busiest tag and the widest-schema tag. */
  heaviestTag: string;
  richestTag: string;
  startedAt: string;
}

const inside = (child: string, parent: string): boolean =>
  child === parent || child.startsWith(parent + sep);

/**
 * Validate (and if absent, create) a sandbox home. Returns the resolved path.
 * Throws rather than touching anything that isn't provably ours.
 */
export function assertSandboxHome(homeArg: string): string {
  const home = resolve(homeArg);
  const live = join(homedir(), ".parachute");
  if (home.split(sep).filter(Boolean).length < 2)
    throw new Error(`refusing sandbox home ${home} — too close to the filesystem root`);
  // Containment is checked on BOTH the lexical path and its canonical form.
  // `resolve()` normalizes `..` and `.` but does not follow symlinks, so a
  // symlink pointing at the real home would pass a lexical-only check. The
  // marker file below is the true backstop (wiping the live home would need a
  // marker planted inside it, which needs write access already) — this is the
  // belt to that suspenders, and it costs one syscall on a path we're about to
  // write to anyway. Canonicalize only what exists; a not-yet-created home has
  // no symlink to follow.
  const canonical = existsSync(home) ? realpathSync(home) : home;
  const canonicalLive = existsSync(live) ? realpathSync(live) : live;
  const contained = (a: string, b: string) => inside(a, b) || inside(b, a);
  if (
    home === homedir() ||
    canonical === homedir() ||
    contained(home, live) ||
    contained(canonical, canonicalLive)
  )
    throw new Error(
      `refusing sandbox home ${home} — it is, contains, or lives inside the real PARACHUTE_HOME (${live})`,
    );
  const marker = join(home, MARKER);
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true });
    writeFileSync(marker, "created by parachute-app scripts/bigvault — safe to delete\n");
    return home;
  }
  if (!existsSync(marker)) {
    const looksReal = existsSync(join(home, "vault"));
    throw new Error(
      `refusing to touch ${home} — it exists but was not created by bigvault (no ${MARKER} marker).${looksReal ? " It contains vault/ — this looks like a REAL PARACHUTE_HOME." : ""} Pick a fresh directory, or delete this one yourself if you are sure.`,
    );
  }
  return home;
}

/** Empty a sandbox home (marker-checked) and re-mark it. */
export function wipeSandboxHome(homeArg: string): string {
  const home = assertSandboxHome(homeArg);
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, MARKER), "created by parachute-app scripts/bigvault — safe to delete\n");
  return home;
}

/** Delete a sandbox home entirely (marker-checked; missing dir is a no-op). */
export function removeSandboxHome(homeArg: string): void {
  const home = resolve(homeArg);
  if (!existsSync(home)) return;
  rmSync(assertSandboxHome(home), { recursive: true, force: true });
}

export function assertSandboxPort(port: number): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error(`port must be an unprivileged port (1024–65535), got ${port}`);
  if (LIVE_PORTS.has(port))
    throw new Error(
      `refusing port ${port} — that is where the live parachute stack listens (hub :1939, vault :1940, agent :1941)`,
    );
}

export function writeRuntime(homeArg: string, runtime: SandboxRuntime): void {
  const home = assertSandboxHome(homeArg);
  writeFileSync(join(home, RUNTIME_FILE), `${JSON.stringify(runtime, null, 2)}\n`);
}

/** Read the runtime record — null when there is no marker-bearing sandbox. */
export function readRuntime(homeArg: string): SandboxRuntime | null {
  const home = resolve(homeArg);
  if (!existsSync(join(home, MARKER)) || !existsSync(join(home, RUNTIME_FILE))) return null;
  return JSON.parse(readFileSync(join(home, RUNTIME_FILE), "utf8")) as SandboxRuntime;
}
