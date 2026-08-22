import { MirrorEngine } from "@/lib/mirror/engine";
import { isMirrorEnabled } from "@/lib/mirror/flag";
import { underMirrorVaultLock } from "@/lib/mirror/lock";
import {
  clearMirrorCursor,
  clearMirrorForVault,
  clearMirrorMeta,
  createMirrorWriteSink,
  getMirrorLastSyncedAt,
  getMirrorState,
} from "@/lib/mirror/store";
import type { MirrorPhase, MirrorSlice, MirrorUxState } from "@/lib/mirror/types";
import { type BlobStore, createBlobStore } from "@/lib/sync/blob-store";
import { type LensDB, openLensDB } from "@/lib/sync/db";
import { SyncEngine } from "@/lib/sync/engine";
import { requestPersistent } from "@/lib/sync/storage-quota";
import { useActiveVaultClient } from "@/lib/vault/queries";
import { useVaultStore } from "@/lib/vault/store";
import { useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface SyncContext {
  db: LensDB | null;
  blobStore: BlobStore | null;
  engine: SyncEngine | null;
  isOnline: boolean;
  // Flipped by the engine around each drain attempt. UI shows a subtle
  // "syncing" affordance while true.
  isDraining: boolean;
  // Wall-clock ms of the most recent drain that actually flushed rows. Null
  // if nothing has drained since mount. Persisted to localStorage so the
  // status panel can show a meaningful "Last synced" across reloads.
  lastSyncedAt: number | null;
  // Durable-offline mirror status + controls (Wave 4). Flag-gated: "off" and
  // no-op actions when the mirror flag is off.
  mirror: MirrorSlice;
}

const LAST_SYNCED_KEY = "lens:sync:lastSyncedAt";

function loadLastSyncedAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SYNCED_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

const MIRROR_OFF: MirrorSlice = {
  enabled: false,
  state: "off",
  lastSyncedAt: null,
  syncNow: async () => {},
  clearOffline: async () => {},
};

const SyncCtx = createContext<SyncContext>({
  db: null,
  blobStore: null,
  engine: null,
  isOnline: true,
  isDraining: false,
  lastSyncedAt: null,
  mirror: MIRROR_OFF,
});

// Fold the engine phase + online-ness into the one user-facing status the
// staleness UX + Settings read. Offline always wins (we're serving the saved
// copy); before the first sync we read as "hydrating" rather than falsely
// "synced".
function deriveMirrorState(
  enabled: boolean,
  isOnline: boolean,
  phase: MirrorPhase | undefined,
  lastSyncedAt: number | null,
): MirrorUxState {
  if (!enabled) return "off";
  if (!isOnline) return "offline";
  if (phase === "error") return "error";
  if (phase === "hydrating") return "hydrating";
  if (phase === undefined && lastSyncedAt === null) return "hydrating";
  return "synced";
}

export function useSync(): SyncContext {
  return useContext(SyncCtx);
}

// Provider-scoped IndexedDB lifecycle: the DB handle is opened on mount and
// closed on unmount. When writing tests that unmount route components which
// perform fire-and-forget enqueues during cleanup (e.g. TextCapture's
// unmount-flush), be aware that the provider's cleanup closes the DB in the
// same tick — if both unmount together, in-flight IDB transactions race the
// close and fake-indexeddb raises InvalidStateError. Real SPA navigation
// doesn't tear down the provider, so to reproduce the true shape in tests,
// toggle only the inner component's mount (see TextCapture.test.tsx for the
// pattern) rather than unmounting the whole render tree.
export function SyncProvider({ children }: { children: ReactNode }): ReactNode {
  const [db, setDb] = useState<LensDB | null>(null);
  const [blobStore, setBlobStore] = useState<BlobStore | null>(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [isDraining, setIsDraining] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(() => loadLastSyncedAt());
  const client = useActiveVaultClient();
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const qc = useQueryClient();

  // Mirror flag read once at mount (the engine + all Wave-4 UX gate on it); a
  // change takes effect on reload, matching the engine's own read.
  const mirrorEnabled = useMemo(() => isMirrorEnabled(), []);
  // Active-vault mirror status, fed by the mirror engine's callbacks. Phase is
  // the engine's own MirrorPhase; progress ticks only during a cold hydration.
  const [mirrorPhase, setMirrorPhase] = useState<MirrorPhase | undefined>(undefined);
  const [mirrorProgress, setMirrorProgress] = useState<{ done: number } | undefined>(undefined);
  const [mirrorLastSyncedAt, setMirrorLastSyncedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let openedHandle: LensDB | null = null;
    openLensDB()
      .then((handle) => {
        if (cancelled) {
          handle.close();
          return;
        }
        openedHandle = handle;
        setDb(handle);
        setBlobStore(createBlobStore(handle));
        void requestPersistent();
      })
      .catch(() => {
        // IDB unavailable (privacy mode, Safari edge cases) — the app still
        // works, just without an offline queue. The mutation hooks fall back
        // to direct calls.
      });
    return () => {
      cancelled = true;
      openedHandle?.close();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  // The engine outlives a single render, but its callbacks need the current
  // client / vault id / query client. Stash those in refs so the useMemo deps
  // stay stable (only rebuild when the DB handle swaps).
  const clientRef = useRef(client);
  const activeVaultIdRef = useRef(activeVaultId);
  const qcRef = useRef(qc);
  clientRef.current = client;
  activeVaultIdRef.current = activeVaultId;
  qcRef.current = qc;

  const engine = useMemo(() => {
    if (!db || !blobStore) return null;
    return new SyncEngine({
      db,
      blobStore,
      // Passed unconditionally; the sink's writes no-op when the mirror flag is
      // off, so a drain keeps the mirror current only when the flag is on.
      mirror: createMirrorWriteSink(db),
      resolveContext: () => {
        const c = clientRef.current;
        const v = activeVaultIdRef.current;
        if (!c || !v) return null;
        return { client: c, vaultId: v };
      },
      onDrainStart: () => {
        setIsDraining(true);
      },
      onDrain: (outcome) => {
        setIsDraining(false);
        if (outcome.drained > 0) {
          const now = Date.now();
          setLastSyncedAt(now);
          try {
            localStorage.setItem(LAST_SYNCED_KEY, String(now));
          } catch {
            // quota/private-mode — not worth surfacing
          }
          const v = activeVaultIdRef.current;
          qcRef.current.invalidateQueries({ queryKey: ["notes", v] });
          qcRef.current.invalidateQueries({ queryKey: ["tags", v] });
          qcRef.current.invalidateQueries({ queryKey: ["vaultInfo", v] });
        }
      },
    });
  }, [db, blobStore]);

  useEffect(() => {
    if (!engine) return;
    engine.start();
    return () => engine.stop();
  }, [engine]);

  // Durable-offline mirror engine (Wave 1). Only created when the flag is on,
  // so it's fully inert otherwise (no cursor traffic, no timers). The flag is
  // read once at mount — a change takes effect on the next reload. Its
  // resolveContext follows the active vault, so a vault switch hydrates that
  // vault from its own stored cursor on the next tick.
  const mirrorEngine = useMemo(() => {
    if (!db || !mirrorEnabled) return null;
    // Ignore a callback for a vault that is no longer active (a switch mid-tick):
    // the status shown always tracks the active vault, refilled by its own load
    // effect below.
    const forActive = (vaultId: string) => vaultId === activeVaultIdRef.current;
    return new MirrorEngine({
      db,
      resolveContext: () => {
        const c = clientRef.current;
        const v = activeVaultIdRef.current;
        if (!c || !v) return null;
        return { client: c, vaultId: v };
      },
      onStateChange: (vaultId, state) => {
        if (!forActive(vaultId)) return;
        setMirrorPhase(state.phase);
        if (state.phase === "live") {
          setMirrorProgress(undefined);
          void getMirrorLastSyncedAt(db, vaultId).then((at) => {
            if (forActive(vaultId)) setMirrorLastSyncedAt(at ?? null);
          });
        }
      },
      onProgress: (vaultId, done) => {
        if (forActive(vaultId)) setMirrorProgress({ done });
      },
    });
  }, [db, mirrorEnabled]);

  useEffect(() => {
    if (!mirrorEngine) return;
    mirrorEngine.start();
    return () => mirrorEngine.stop();
  }, [mirrorEngine]);

  // Load the active vault's persisted mirror status on mount / vault switch, so
  // a reload paints the last-known status (and a switch doesn't show the prior
  // vault's). Reset first so a switch never flashes the old vault's numbers.
  useEffect(() => {
    if (!db || !mirrorEnabled || !activeVaultId) {
      setMirrorPhase(undefined);
      setMirrorProgress(undefined);
      setMirrorLastSyncedAt(null);
      return;
    }
    let live = true;
    setMirrorProgress(undefined);
    void Promise.all([
      getMirrorState(db, activeVaultId),
      getMirrorLastSyncedAt(db, activeVaultId),
    ]).then(([state, at]) => {
      if (!live) return;
      setMirrorPhase(state?.phase);
      setMirrorLastSyncedAt(at ?? null);
    });
    return () => {
      live = false;
    };
  }, [db, mirrorEnabled, activeVaultId]);

  // Settings "Sync now": one incremental cursor run + sweep + eviction. The
  // engine's own state callbacks refresh the status; nothing to do with the
  // result here.
  const syncNow = useCallback(async () => {
    await mirrorEngine?.syncOnce();
  }, [mirrorEngine]);

  // Settings "Clear offline copy": wipe this vault's mirror rows, reset its
  // cursor, AND drop its sync-state meta (state / lastSyncedAt / lastSweepAt /
  // tags) so a cleared vault reads truly EMPTY — a reload can't repaint a stale
  // "synced / last synced X ago", and the re-fill runs COLD (hydration progress
  // shown) instead of being treated as a warm no-op. Deliberately touches ONLY
  // the `mirror_notes` store + the mirror cursor/sync-state meta — never
  // `pending`, `id_map`, `blob_path_map`, or `blobs`, which hold un-synced user
  // work. Invalidate the mirror-seeded read caches so any placeholder painted
  // from the mirror clears.
  //
  // The wipe runs UNDER the engine's per-vault Web Lock (#79 item 2). Without
  // it, a drain in flight (this tab's poll or ANOTHER tab's) can commit its
  // `lastSyncedAt` watermark AFTER the meta wipe, leaving the offline read gate
  // OPEN over a mirror whose rows were just deleted — a "synced, last updated
  // just now" vault with nothing in it. It self-heals on the next sweep, but the
  // lock closes the window outright. This acquisition QUEUES rather than
  // skipping (`underMirrorVaultLock`, not the engine's `ifAvailable` variant):
  // a button the user pressed must never silently no-op, so the wipe waits out
  // the in-flight drain behind the Settings row's own busy state.
  //
  // That wait is DEADLINED (`MIRROR_LOCK_WAIT_MS`). A holder wedged on a fetch
  // that never resolves would otherwise keep this promise pending forever, and
  // with it `Settings.onClear`'s `finally` — pinning `busy` at "clear" and
  // leaving the entire Offline section inert with nothing reported. Past the
  // deadline the acquisition rejects, the wipe does NOT run, and the rejection
  // propagates to the caller's catch: the user is told and can retry.
  const clearOffline = useCallback(async () => {
    if (!db || !activeVaultId) return;
    await underMirrorVaultLock(activeVaultId, async () => {
      await clearMirrorForVault(db, activeVaultId);
      await clearMirrorCursor(db, activeVaultId);
      await clearMirrorMeta(db, activeVaultId);
    });
    setMirrorPhase(undefined);
    setMirrorProgress(undefined);
    setMirrorLastSyncedAt(null);
    qc.invalidateQueries({ queryKey: ["notes", activeVaultId] });
    qc.invalidateQueries({ queryKey: ["notesForDateViews", activeVaultId] });
    qc.invalidateQueries({ queryKey: ["notesForPathTree", activeVaultId] });
    qc.invalidateQueries({ queryKey: ["tags", activeVaultId] });
  }, [db, activeVaultId, qc]);

  const mirror = useMemo<MirrorSlice>(
    () => ({
      enabled: mirrorEnabled,
      state: deriveMirrorState(mirrorEnabled, isOnline, mirrorPhase, mirrorLastSyncedAt),
      progress: mirrorProgress,
      lastSyncedAt: mirrorLastSyncedAt,
      syncNow,
      clearOffline,
    }),
    [
      mirrorEnabled,
      isOnline,
      mirrorPhase,
      mirrorProgress,
      mirrorLastSyncedAt,
      syncNow,
      clearOffline,
    ],
  );

  const value = useMemo<SyncContext>(
    () => ({ db, blobStore, engine, isOnline, isDraining, lastSyncedAt, mirror }),
    [db, blobStore, engine, isOnline, isDraining, lastSyncedAt, mirror],
  );

  return <SyncCtx.Provider value={value}>{children}</SyncCtx.Provider>;
}
