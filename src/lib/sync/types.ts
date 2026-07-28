import type { CreateNotePayload, UpdateNotePayload } from "@/lib/vault/client";
import type { NotesSettingsPatch } from "@/lib/vault/settings";
import type { Note } from "@/lib/vault/types";

// Shape of every row in the `pending` object store. Mutations flow through here
// FIFO by autoincrement `seq`. `targetId` may be a local-only ID that needs
// resolving against the id-map at drain time.
export type PendingKind =
  | "create-note"
  | "update-note"
  | "update-settings"
  | "delete-note"
  | "upload-attachment"
  | "link-attachment"
  | "delete-attachment";

export interface PendingCreateNote {
  kind: "create-note";
  // Local-only ID assigned at enqueue time so the UI has something to route on
  // immediately. When the drain succeeds, the server's real ID is mapped to this.
  localId: string;
  payload: CreateNotePayload;
}

export interface PendingUpdateNote {
  kind: "update-note";
  // Either a server ID or a local ID awaiting resolution via the id-map.
  targetId: string;
  payload: UpdateNotePayload;
  // Last-known `note.updatedAt` captured at enqueue time — supplied as
  // `if_updated_at` on drain so an offline write doesn't silently overwrite a
  // cross-device write that landed first. Optional for forward-compat with
  // rows enqueued before this field existed; the drain handler treats a
  // missing baseline like a 428 (refetch + retry).
  baselineUpdatedAt?: string;
}

export interface PendingDeleteNote {
  kind: "delete-note";
  targetId: string;
}

// Settings-note update. Carries the ORIGINAL patch (not a pre-merged full
// payload) so the drain handler can refetch the note, apply the patch onto
// whatever the server currently has, and PATCH with a fresh if_updated_at.
// A forced PATCH is the last-resort fallback after merge-retries are
// exhausted — otherwise we'd silently clobber another device's write that
// landed while we were offline.
export interface PendingUpdateSettings {
  kind: "update-settings";
  notePath: string;
  patch: NotesSettingsPatch;
  // The serverUpdatedAt we last observed when the row was enqueued. Used as
  // the initial `if_updated_at`; stale by the time the drain runs, but the
  // drain refetches to recover a fresh baseline regardless.
  baselineUpdatedAt: string | null;
}

export interface PendingUploadAttachment {
  kind: "upload-attachment";
  // Reference into the blob-store (OPFS or IDB fallback).
  blobId: string;
  filename: string;
  mimeType: string;
}

export interface PendingLinkAttachment {
  kind: "link-attachment";
  // Either a server note ID or a local ID.
  noteId: string;
  // Either a storage path the vault already knows, or a `blob:<blobId>` reference
  // which resolves to the server path once the matching upload-attachment row drains.
  pathRef: string;
  mimeType: string;
  // When true, ask the vault to transcribe this attachment and overwrite the
  // note's `_Transcript pending._` placeholder with the transcript. Vault's
  // transcription-worker does the actual work — Notes just flags intent.
  transcribe?: boolean;
  // A NUMBER, 0-based: tells the vault this is part k+1 of a segmented
  // recording so it fills that part's own `_Transcript pending (part N)._`
  // marker. Omitted for the single-segment common case (no per-part markers)
  // — the note shape stays byte-identical. MUST be top level, not nested
  // under a `metadata` object — both doors read `body.segment_index`
  // directly, and a nested copy is silently dropped in transit (the bug
  // this field's shape exists to prevent from recurring).
  segment_index?: number;
}

export interface PendingDeleteAttachment {
  kind: "delete-attachment";
  noteId: string;
  attachmentId: string;
}

export type PendingPayload =
  | PendingCreateNote
  | PendingUpdateNote
  | PendingUpdateSettings
  | PendingDeleteNote
  | PendingUploadAttachment
  | PendingLinkAttachment
  | PendingDeleteAttachment;

export type PendingStatus = "pending" | "needs-human";

export interface PendingRow {
  // Autoincrement primary key; determines FIFO drain order.
  seq: number;
  // Opaque client-side UUID, stable across the row's life for external reference.
  id: string;
  // Which vault this mutation targets — each has its own token + URL.
  vaultId: string;
  mutation: PendingPayload;
  createdAt: number;
  attemptCount: number;
  // When the engine should next attempt this row. Set on backoff; rows with
  // `nextAttemptAt > now` are skipped during drain.
  nextAttemptAt: number;
  lastError?: string;
  status: PendingStatus;
}

// Mapping of local → server IDs for notes created offline. Populated on
// successful create-note drain so subsequent update/delete rows can resolve.
export interface IdMapRow {
  localId: string;
  realId: string;
  vaultId: string;
  mappedAt: number;
}

// Mapping of blob-store blob-id → server storage path for attachments uploaded
// offline. Populated on upload-attachment drain so link-attachment rows resolve.
export interface BlobPathMapRow {
  blobId: string;
  serverPath: string;
  vaultId: string;
  mappedAt: number;
}

// Meta key/value store for engine state (schema version, auth-halted marker,
// storage-persist result).
export interface MetaRow {
  key: string;
  value: unknown;
}

export interface DrainOutcome {
  drained: number;
  stashed: number;
  deferred: number;
  authHalted: boolean;
}

// A row in the durable-offline mirror (`mirror_notes`, DB v2). The full server
// Note, plus the `vaultId` that makes the composite key [vaultId, id] unique
// across a restored/imported vault copy (which shares note ids with its
// origin), plus a bookkeeping bit for a future body-eviction pass. Stored
// verbatim from a cursor page (content + links + attachment rows) or from a
// write-path landing.
export interface MirrorNoteRow extends Note {
  // Discriminator for the composite key + `by-vault*` indexes. Never a Note
  // field on the wire — added when the row is written to the mirror.
  vaultId: string;
  // Set by Wave 4's storage-ceiling eviction when a row's body (content +
  // links + attachments) is dropped under quota pressure: the row's metadata
  // stays present so the note is still listable/openable, but `content` is
  // gone and must be refetched (a reader shows "Connect to load this note"
  // offline). Unset on a full row.
  contentEvicted?: boolean;
  // Retained title for an evicted row. Normally the list derives a note's
  // title from its `content` first line; once content is evicted there's no
  // line to derive from, so eviction snapshots the derived title here (the
  // same field the vault sends on its lean list shape — `displayTitle()` reads
  // it via a cast) so the row keeps its human title offline. `null` mirrors the
  // vault's "no first-line title" signal (empty note → fall to path/timestamp).
  displayTitle?: string | null;
}
