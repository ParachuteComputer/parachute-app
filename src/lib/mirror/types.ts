import type { Note } from "@/lib/vault/types";

// Re-exported so mirror consumers import the row shape from one place; the
// canonical definition lives with the other IDB row types in sync/types.
export type { MirrorNoteRow } from "@/lib/sync/types";

// Where the hydration engine is for a given vault. Persisted per-vault in
// `meta` under `mirror:<vaultId>:state` so the (future) UI can show sync
// status across reloads.
export type MirrorPhase = "idle" | "hydrating" | "live" | "error";

export interface MirrorState {
  phase: MirrorPhase;
  // Set when phase is "error" — the last failure's message, for surfacing.
  lastError?: string;
}

// The mirror's user-facing status, derived from the engine phase + online-ness
// (Wave 4 staleness UX + Settings). "off" when the flag is off — every UX below
// is inert in that state.
export type MirrorUxState = "off" | "hydrating" | "synced" | "offline" | "error";

// The `mirror` slice hung off SyncContext so the chrome staleness line, the
// note "saved copy" chip, and the Settings offline row read one source of
// truth. All flag-gated: when off, `state` is "off" and the actions are no-ops.
export interface MirrorSlice {
  enabled: boolean;
  state: MirrorUxState;
  // Cumulative notes saved so far during the first (cold) hydration — drives the
  // one-time "Saving your vault for offline" progress line. Absent otherwise.
  progress?: { done: number };
  // Wall-clock ms of the mirror's last completed sync (persisted per vault),
  // null before the first. Drives "updated {relative} ago".
  lastSyncedAt: number | null;
  // Settings "Sync now": an incremental cursor run + sweep + eviction now.
  syncNow: () => Promise<void>;
  // Settings "Clear offline copy": wipe this vault's mirror rows (and reset the
  // cursor so a later sync re-fills). NEVER touches the write queue / un-synced
  // work — only the `mirror_notes` store.
  clearOffline: () => Promise<void>;
}

// The write-path seam the queue drain calls into so an online-landing note
// keeps the mirror current. Every method is flag-gated internally (a no-op when
// the mirror is off), so callers invoke it unconditionally. `vaultId` is passed
// per call because the drain runs per vault.
export interface MirrorWriteSink {
  upsert(vaultId: string, note: Note): Promise<void>;
  remove(vaultId: string, id: string): Promise<void>;
  // A note created offline (local id) has drained; its server id is now known.
  // Drops the optimistic local-id row and writes the authoritative server row
  // in one transaction.
  localIdLanded(vaultId: string, localId: string, serverNote: Note): Promise<void>;
}
