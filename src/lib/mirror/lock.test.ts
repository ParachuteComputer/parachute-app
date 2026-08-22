import { holdLock, installFifoLocks } from "@/test/locks";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MIRROR_LOCK_WAIT_MS,
  mirrorLockName,
  underMirrorVaultLock,
  withMirrorVaultLock,
} from "./lock";

// jsdom ships no Web Locks API, so these tests install a minimal fake
// LockManager on `navigator` and assert the SHAPE of each acquisition — the
// name, the `ifAvailable` mode, and what happens when the lock is contended.
// The behaviour under contention is the whole point of #79 item 2: background
// work skips, a user-initiated clear waits.

type LockRequest = { name: string; options: LockOptions | undefined };

function installLocks(opts: { grant: boolean }): {
  requests: LockRequest[];
  restore: () => void;
} {
  const requests: LockRequest[] = [];
  const request = vi.fn(async (name: string, a: unknown, b?: unknown): Promise<unknown> => {
    const options = typeof a === "function" ? undefined : (a as LockOptions);
    const cb = (typeof a === "function" ? a : b) as (lock: unknown) => Promise<unknown>;
    requests.push({ name, options });
    return cb(opts.grant ? { name, mode: "exclusive" } : null);
  });
  const original = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request },
  });
  return {
    requests,
    restore: () => {
      if (original) Object.defineProperty(navigator, "locks", original);
      else Reflect.deleteProperty(navigator as unknown as object, "locks");
    },
  };
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe("mirrorLockName", () => {
  it("derives one stable per-vault name", () => {
    expect(mirrorLockName("v1")).toBe("mirror:v1");
    expect(mirrorLockName("v2")).not.toBe(mirrorLockName("v1"));
  });
});

describe("withMirrorVaultLock (background: skip when contended)", () => {
  it("runs the body under an ifAvailable acquisition of the per-vault name", async () => {
    const locks = installLocks({ grant: true });
    restore = locks.restore;
    const body = vi.fn(async () => "ran");
    await expect(withMirrorVaultLock("v1", () => "skipped", body)).resolves.toBe("ran");
    expect(body).toHaveBeenCalledTimes(1);
    expect(locks.requests).toEqual([{ name: "mirror:v1", options: { ifAvailable: true } }]);
  });

  it("SKIPS the body when another holder has the lock", async () => {
    const locks = installLocks({ grant: false });
    restore = locks.restore;
    const body = vi.fn(async () => "ran");
    await expect(withMirrorVaultLock("v1", () => "skipped", body)).resolves.toBe("skipped");
    expect(body).not.toHaveBeenCalled();
  });

  it("degrades to running directly where Web Locks is unavailable", async () => {
    const body = vi.fn(async () => "ran");
    // jsdom's navigator has no `locks` at all — the default in this suite.
    expect((navigator as { locks?: unknown }).locks).toBeUndefined();
    await expect(withMirrorVaultLock("v1", () => "skipped", body)).resolves.toBe("ran");
    expect(body).toHaveBeenCalledTimes(1);
  });
});

describe("underMirrorVaultLock (user-initiated: wait for the holder, but not forever)", () => {
  it("acquires the SAME per-vault name WITHOUT ifAvailable, so it queues", async () => {
    const locks = installLocks({ grant: true });
    restore = locks.restore;
    const body = vi.fn(async () => "wiped");
    await expect(underMirrorVaultLock("v1", body)).resolves.toBe("wiped");
    expect(body).toHaveBeenCalledTimes(1);
    // Same name as the engine's drain/sweep — they contend, which is the point.
    expect(locks.requests[0]?.name).toBe(mirrorLockName("v1"));
    // No `ifAvailable`: a contended request WAITS instead of resolving null.
    expect(locks.requests[0]?.options?.ifAvailable).toBeUndefined();
  });

  it("carries an abort signal, so the wait is bounded in TIME not just in work", async () => {
    const locks = installLocks({ grant: true });
    restore = locks.restore;
    await underMirrorVaultLock("v1", async () => "wiped");
    // The only escape hatch on a queueing acquisition. Without it a holder
    // wedged on a fetch with no timeout pins the caller — and its `finally` —
    // forever. `ifAvailable` is mutually exclusive with `signal`, so this
    // helper (which never sets it) is the only one that can carry a deadline.
    expect(locks.requests[0]?.options?.signal).toBeInstanceOf(AbortSignal);
    expect(locks.requests[0]?.options?.signal?.aborted).toBe(false);
  });

  it("REJECTS instead of hanging when the holder never releases", async () => {
    restore = installFifoLocks();
    const wedged = holdLock(mirrorLockName("v1"));
    await wedged.held;

    const body = vi.fn(async () => "wiped");
    // A real deadline, just a short one — the production default is 15s.
    await expect(underMirrorVaultLock("v1", body, 25)).rejects.toThrow();
    // Crucially the body did NOT run: an abandoned acquisition writes nothing,
    // so the wipe can't land half-outside the lock it failed to take.
    expect(body).not.toHaveBeenCalled();

    wedged.release();
  });

  it("still runs the body when the holder releases before the deadline", async () => {
    restore = installFifoLocks();
    const wedged = holdLock(mirrorLockName("v1"));
    await wedged.held;

    const body = vi.fn(async () => "wiped");
    const queued = underMirrorVaultLock("v1", body, 5_000);
    // Queued behind the holder, not skipped.
    await Promise.resolve();
    expect(body).not.toHaveBeenCalled();

    wedged.release();
    await expect(queued).resolves.toBe("wiped");
  });

  it("degrades to running directly where Web Locks is unavailable", async () => {
    const body = vi.fn(async () => "wiped");
    await expect(underMirrorVaultLock("v1", body)).resolves.toBe("wiped");
    expect(body).toHaveBeenCalledTimes(1);
  });

  it("defaults to a deadline long enough for a real drain but short of a wedge", () => {
    expect(MIRROR_LOCK_WAIT_MS).toBe(15_000);
  });
});
