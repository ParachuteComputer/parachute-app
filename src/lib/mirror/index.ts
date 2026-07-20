export { isMirrorEnabled, MIRROR_ENABLED_DEFAULT, MIRROR_FLAG_KEY } from "./flag";
export {
  MirrorEngine,
  type MirrorContext,
  type MirrorEngineOptions,
  type MirrorSyncResult,
  isCursorRejection,
} from "./engine";
export {
  clearMirrorForVault,
  countMirrorNotes,
  createMirrorWriteSink,
  getMirrorLastSyncedAt,
  getMirrorNote,
  getMirrorState,
  listMirrorNotes,
  mirrorRecordLocalIdLanded,
  mirrorRecordRemove,
  mirrorRecordUpsert,
  removeMirrorNote,
  upsertMirrorNote,
  upsertMirrorNotes,
} from "./store";
export type { MirrorNoteRow, MirrorPhase, MirrorState, MirrorWriteSink } from "./types";
