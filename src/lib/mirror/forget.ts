import { openLensDB } from "@/lib/sync/db";
import { underMirrorVaultLock } from "./lock";
import { clearMirrorCursor, clearMirrorForVault, clearMirrorMeta } from "./store";

/**
 * Drop this browser's offline mirror of a vault that was removed from it
 * (deleted, its account deleted, or disconnected): every note row, the cursor
 * and the sync meta, so the notes do not stay on the device and a vault
 * re-added at the same URL starts cold instead of reading the old rows back.
 * The mirror is a cache of server data, so nothing un-synced is lost; the
 * write queue (`pending`) is left alone. Queues behind an in-flight drain (the
 * per-vault lock) so the drain can't write rows back after the wipe; past the
 * lock's deadline it wipes anyway. Best-effort, never throws.
 */
export async function forgetVaultMirror(vaultId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openLensDB();
    try {
      const wipe = async () => {
        await clearMirrorForVault(db, vaultId);
        await clearMirrorCursor(db, vaultId);
        await clearMirrorMeta(db, vaultId);
      };
      await underMirrorVaultLock(vaultId, wipe).catch(wipe);
    } finally {
      db.close();
    }
  } catch {
    // No IndexedDB (private mode, quota): nothing was mirrored to drop.
  }
}
