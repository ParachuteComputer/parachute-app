/**
 * The guards are the reason this tool is allowed to exist: it wipes and
 * backdates a vault home, so "only ever a directory we created" has to be
 * enforced by code, not convention. These tests pin every refusal.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MARKER,
  assertSandboxHome,
  assertSandboxPort,
  removeSandboxHome,
  wipeSandboxHome,
} from "./sandbox.ts";

const scratch: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bigvault-guard-test-"));
  scratch.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("assertSandboxHome", () => {
  it("refuses the real PARACHUTE_HOME and anything inside or above it", () => {
    const live = join(homedir(), ".parachute");
    expect(() => assertSandboxHome(live)).toThrow(/refusing/i);
    expect(() => assertSandboxHome(join(live, "vault"))).toThrow(/refusing/i);
    expect(() => assertSandboxHome(homedir())).toThrow(/refusing/i);
  });

  it("refuses paths near the filesystem root", () => {
    expect(() => assertSandboxHome("/")).toThrow(/refusing/i);
    expect(() => assertSandboxHome("/tmp")).toThrow(/refusing/i);
  });

  it("refuses an existing directory it did not create (no marker)", () => {
    const dir = tempDir(); // exists, but carries no marker
    expect(() => assertSandboxHome(dir)).toThrow(/marker/i);
  });

  it("calls out a directory that looks like a real vault home", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "vault"));
    expect(() => assertSandboxHome(dir)).toThrow(/REAL PARACHUTE_HOME/);
  });

  it("creates a fresh directory with the marker, then accepts it", () => {
    const dir = join(tempDir(), "fresh");
    const home = assertSandboxHome(dir);
    expect(existsSync(join(home, MARKER))).toBe(true);
    expect(assertSandboxHome(dir)).toBe(home); // idempotent
  });
});

describe("wipeSandboxHome / removeSandboxHome", () => {
  it("wipes only marker-bearing homes, and re-marks after wiping", () => {
    const dir = join(tempDir(), "sandbox");
    assertSandboxHome(dir);
    writeFileSync(join(dir, "leftover.txt"), "x");
    wipeSandboxHome(dir);
    expect(existsSync(join(dir, "leftover.txt"))).toBe(false);
    expect(existsSync(join(dir, MARKER))).toBe(true);

    const unmarked = tempDir();
    expect(() => wipeSandboxHome(unmarked)).toThrow(/marker/i);
  });

  it("removes only marker-bearing homes; a missing dir is a no-op", () => {
    const dir = join(tempDir(), "sandbox");
    assertSandboxHome(dir);
    removeSandboxHome(dir);
    expect(existsSync(dir)).toBe(false);
    removeSandboxHome(dir); // gone already — fine

    const unmarked = tempDir();
    expect(() => removeSandboxHome(unmarked)).toThrow(/marker/i);
    expect(existsSync(unmarked)).toBe(true); // untouched
  });
});

describe("assertSandboxPort", () => {
  it("refuses the live parachute ports and privileged ports", () => {
    expect(() => assertSandboxPort(1939)).toThrow(/live/i);
    expect(() => assertSandboxPort(1940)).toThrow(/live/i);
    expect(() => assertSandboxPort(1941)).toThrow(/live/i);
    expect(() => assertSandboxPort(80)).toThrow(/unprivileged/i);
    expect(() => assertSandboxPort(70000)).toThrow(/unprivileged/i);
  });

  it("accepts a throwaway high port", () => {
    expect(() => assertSandboxPort(19572)).not.toThrow();
  });
});
