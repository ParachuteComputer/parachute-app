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
