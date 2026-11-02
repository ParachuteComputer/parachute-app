import { openLensDB } from "@/lib/sync/db";
import { underMirrorVaultLock } from "./lock";
import { dropMirrorVault } from "./store";

/**
 * Drop this browser's offline mirror of a vault that was removed from it
 * (deleted, its account deleted, or disconnected): every note row, the cursor
 * and the sync meta, so the notes do not stay on the device and a vault
 * re-added at the same URL starts cold instead of reading the old rows back.
 * The mirror is a cache of server data, so nothing un-synced is lost; the
 * write queue (`pending`) is left alone.
 *
 * Runs under the per-vault lock and waits for it with NO deadline: a drain in
 * another tab may hold it for long (a page fetch on a slow link), and wiping
 * beside it would let that drain commit its page and watermark after the wipe.
 * Nothing awaits this, so the wait wedges no UI. The engine also refuses to
 * write a vault that is gone from the registry and wipes it itself
 * (`isVaultRemoved`), which covers a drain that starts after the removal and
 * a tab closed before its queued wipe ran. Best-effort, never throws.
 */
export async function forgetVaultMirror(vaultId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    // Open the database only once the lock is ours, so a long wait doesn't keep
    // a connection open that would block a schema upgrade in another tab.
    await underMirrorVaultLock(
      vaultId,
      async () => {
        const db = await openLensDB();
        try {
          await dropMirrorVault(db, vaultId);
        } finally {
          db.close();
        }
      },
      null,
    );
  } catch {
    // No IndexedDB (private mode, quota): nothing was mirrored to drop.
  }
}
