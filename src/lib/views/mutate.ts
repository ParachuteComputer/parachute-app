import { useUpdateNote } from "@/lib/vault/queries";
import type { Note } from "@/lib/vault/types";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

// The shared "view mutation" primitive (view-experience wave, slice 1) — write
// ONE metadata field on a note and reflect it in the active view INSTANTLY.
//
// Why it exists: a view renders a live list of notes; editing a note from a
// view (moving a kanban card, ticking a task) is a one-field metadata write.
// The vault applies it as a shallow RFC-7386 merge with null-as-delete
// (`parachute-vault/core/src/notes.ts:2981-2994`), so one key moves and the
// note's siblings + body are untouched — and it's a queued op kind, so it works
// OFFLINE (enqueue path in `src/lib/sync/queue.ts`). The one thing the vanilla
// `useUpdateNote` does NOT do is keep the VIEW in sync: its `onSuccess`
// invalidates `["notes"]`/`["note"]`/`["tags"]` but not `["viewResults", …]`
// (`src/lib/vault/queries.ts:781-793`), so a moved card would snap back until
// the 30s poll / WS reconcile. This primitive layers the optimistic
// `["viewResults", …]` update (with rollback) on top.

/** A scalar metadata value a view can write, or `null` to clear (delete) it. */
export type ViewFieldValue = string | number | boolean | null;

/**
 * Apply a single metadata field to ONE note, returning a NEW note (metadata
 * siblings + body untouched). `null` DELETES the key locally, mirroring the
 * vault's shallow merge (null-as-delete); any other value is stored with its
 * ORIGINAL type (a number stays a number), so the optimistic cache matches what
 * the server will persist — and so an `indexed` integer/boolean field is never
 * handed a stringified value.
 */
export function applyFieldToNote(note: Note, field: string, value: ViewFieldValue): Note {
  const metadata = { ...(note.metadata ?? {}) };
  if (value === null) delete metadata[field];
  else metadata[field] = value;
  return { ...note, metadata };
}

/**
 * Apply a single metadata field to the note matching `noteId` within a view's
 * result list, leaving every other note as-is (same array shape/order). A
 * missing list passes through unchanged.
 */
export function applyFieldToViewCache(
  notes: Note[] | undefined,
  noteId: string,
  field: string,
  value: ViewFieldValue,
): Note[] | undefined {
  if (!notes) return notes;
  return notes.map((n) => (n.id === noteId ? applyFieldToNote(n, field, value) : n));
}

export interface ViewFieldMutation {
  /**
   * Write `field = value` on the note, painting the change into the active
   * view's result cache immediately and rolling back if the write fails.
   * `baselineUpdatedAt` (the note's last-known `updatedAt`) rides as
   * `if_updated_at` for optimistic concurrency; absent, the write is `force`d.
   * Rejects (after rollback) when the underlying write rejects — callers can
   * surface a toast.
   */
  move: (field: string, value: ViewFieldValue, baselineUpdatedAt?: string) => Promise<void>;
  isPending: boolean;
}

/**
 * A one-field metadata mutation bound to `noteId`, optimistic against a
 * specific view's `["viewResults", …]` cache key. Call it once per note (e.g.
 * inside a board card) — `viewResultsKey` is the exact key the view's
 * `useViewResults` reads (see `src/lib/views/queries.ts` `useViewResults`), so
 * the card that reads that query re-renders into its new lane the instant the
 * move is requested; the live-reconcile layer (`live-query.ts`) still provides
 * eventual truth.
 */
export function useViewFieldMutation(noteId: string, viewResultsKey: QueryKey): ViewFieldMutation {
  const qc = useQueryClient();
  const updateNote = useUpdateNote(noteId);

  const move = useCallback(
    async (field: string, value: ViewFieldValue, baselineUpdatedAt?: string) => {
      // Snapshot for rollback, then paint the move optimistically.
      const previous = qc.getQueryData<Note[]>(viewResultsKey);
      qc.setQueryData<Note[] | undefined>(viewResultsKey, (old) =>
        applyFieldToViewCache(old, noteId, field, value),
      );
      try {
        await updateNote.mutateAsync({
          metadata: { [field]: value },
          ...(baselineUpdatedAt ? { if_updated_at: baselineUpdatedAt } : { force: true }),
        });
      } catch (err) {
        // Restore the pre-move cache — the live layer still reconciles to truth.
        qc.setQueryData(viewResultsKey, previous);
        throw err;
      }
    },
    [qc, viewResultsKey, noteId, updateNote],
  );

  return { move, isPending: updateNote.isPending };
}
