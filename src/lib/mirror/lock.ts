// The per-vault Web Lock that serializes every mutation of a vault's mirror
// across TABS. The drain, the reconcile sweep, and "Clear offline copy" all
// write the same `mirror_notes` rows + the same `mirror:<vaultId>:*` meta keys,
// so they must not interleave — most sharply the clear-vs-drain window, where a
// drain in flight during a wipe can re-commit `lastSyncedAt` AFTER the meta was
// dropped, leaving the offline read gate OPEN over a just-emptied mirror (#79
// item 2). The name is derived in ONE place here so a second caller can't
// serialize against a subtly different string and believe it holds the lock.
//
// Both helpers degrade to running the body DIRECTLY where the Web Locks API is
// unavailable (older browsers, jsdom under tests). The single-tab case stays
// correct there — every in-tab caller carries its own re-entrancy guard — and
// only the cross-tab window reopens, which is exactly the pre-lock behaviour.
//
// Neither is re-entrant: a body that acquires the same vault's lock again will
// stall (queueing) or take the locked branch (ifAvailable). Keep nested
// sections outside the locked region — that is why the engine runs its sweep
// and eviction AFTER the drain's lock section rather than inside it.

/** The per-vault lock name. One definition; never inline the template. */
export function mirrorLockName(vaultId: string): string {
  return `mirror:${vaultId}`;
}

function webLocks(): LockManager | undefined {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks?.request ? locks : undefined;
}

/**
 * Run `fn` under the per-vault mirror lock, SKIPPING if another holder has it.
 *
 * For BACKGROUND work (the poll drain, the reconcile sweep, eviction): a tick
 * that can't get the lock has no business queueing behind the tab that can — it
 * would just stack up duplicate walks — so it resolves `onLocked()` instead and
 * the next tick retries from the same watermark.
 */
export async function withMirrorVaultLock<T>(
  vaultId: string,
  onLocked: () => T | Promise<T>,
  fn: () => Promise<T>,
): Promise<T> {
  const locks = webLocks();
  if (!locks) return fn();
  return locks.request(mirrorLockName(vaultId), { ifAvailable: true }, async (lock) => {
    if (!lock) return await onLocked();
    return await fn();
  }) as Promise<T>;
}

/**
 * Run `fn` under the per-vault mirror lock, WAITING for the current holder.
 *
 * For USER-INITIATED work ("Clear offline copy"): skipping would silently
 * no-op a button the user pressed, and running anyway is the very race we're
 * closing — so this one queues. A drain is bounded (page cap + per-page commits),
 * so the wait is the length of at most one in-flight drain, spent behind the
 * caller's own busy state.
 */
export async function underMirrorVaultLock<T>(vaultId: string, fn: () => Promise<T>): Promise<T> {
  const locks = webLocks();
  if (!locks) return fn();
  return locks.request(mirrorLockName(vaultId), async () => await fn()) as Promise<T>;
}
