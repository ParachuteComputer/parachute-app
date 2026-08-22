export { isMirrorEnabled, MIRROR_ENABLED_DEFAULT, MIRROR_FLAG_KEY } from "./flag";
export {
  MirrorEngine,
  type MirrorClient,
  type MirrorContext,
  type MirrorEngineOptions,
  type MirrorSweepResult,
  type MirrorSyncResult,
  isCursorRejection,
} from "./engine";
export {
  MIRROR_CEILING_BYTES,
  type EvictionPlan,
  type MirrorEvictResult,
  derivePreview,
  evictOverCeiling,
  evictedShell,
  measureMirrorBytes,
  mirrorRowBytes,
  planEviction,
} from "./evict";
export { mirrorLockName, underMirrorVaultLock, withMirrorVaultLock } from "./lock";
export { readNote, readNotesList } from "./read";
export {
  type MirrorDiff,
  type MirrorRowRef,
  collectProtectedIds,
  diffMirror,
  makeIsProtected,
  referencedNoteId,
} from "./reconcile";
export {
  clearMirrorForVault,
  clearMirrorMeta,
  countMirrorNotes,
  createMirrorWriteSink,
  getMirrorLastSweepAt,
  getMirrorLastSyncedAt,
  getMirrorNote,
  getMirrorState,
  getMirrorTags,
  listMirrorNotes,
  mirrorRecordLocalIdLanded,
  mirrorRecordRemove,
  mirrorRecordUpsert,
  removeMirrorNote,
  removeMirrorNotes,
  setMirrorLastSweepAt,
  setMirrorTags,
  upsertMirrorNote,
  upsertMirrorNotes,
} from "./store";
export type { MirrorNoteRow, MirrorPhase, MirrorState, MirrorWriteSink } from "./types";
