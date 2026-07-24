import { displayTitle } from "@/lib/note-title";
import { useToastStore } from "@/lib/toast/store";
import type { Note } from "@/lib/vault/types";
import type { QueryKey } from "@tanstack/react-query";
import { useCallback } from "react";
import { type ViewFieldValue, useViewFieldMutation } from "./mutate";

// The shared field-WRITE hook (views train, PR A) — the one door every lens
// writes a field through: chips + tap-to-move today, table cells + board drag
// next. It wraps the shipped `useViewFieldMutation` (optimistic viewResults
// paint, rollback, server-updatedAt patch-back — see mutate.ts; nothing is
// reimplemented here) and adds the MICROCONFIRMATION: data writes through a
// view are IMMEDIATE — they never wait for a "Save" — so the write confirms
// itself the moment it RESOLVES. Not optimistically: offline writes resolve
// instantly via the durable queue, so resolve-time is both instant and honest,
// while a rejected write (409 conflict, server error) confirms nothing.
//
//   resolve → a short success toast naming what changed ("✓ status → done")
//             + a brief coral-outline flash on the affected card
//   reject  → the shipped rollback stays; an error toast explains why;
//             no success confirmation fires.

/**
 * Microconfirmation toast duration — deliberately shorter than the Toaster's
 * 4s default so a burst of quick edits reads as pulses, not a toast wall.
 */
export const MICROCONFIRM_TOAST_MS = 1800;

/** The class `flashNoteCard` applies — `.field-write-flash` in index.css. */
export const CARD_FLASH_CLASS = "field-write-flash";

/**
 * How long the flash class stays applied. Slightly past the CSS animation's
 * 600ms so the removal never clips the fade's tail.
 */
export const CARD_FLASH_MS = 700;

/**
 * How a just-written value reads in the success toast when the caller has no
 * better label: booleans as Yes/No (matching `FieldValueControl`'s display),
 * everything else stringified. `null` (a cleared field) returns `null` — the
 * toast switches to its "cleared" phrasing rather than showing a value.
 */
export function formatFieldValue(value: ViewFieldValue): string | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * Flash the card(s) rendering `noteId` — a brief coral outline pulse, the
 * visual half of the microconfirmation (the toast names WHAT changed; the
 * flash shows WHERE). Targets `[data-note-id]`, which `NoteCard`/`NoteRow`
 * stamp; a note not currently on screen simply doesn't flash. Imperative by
 * design: the write hook shouldn't force every card into a store subscription
 * for a decorative pulse.
 */
export function flashNoteCard(noteId: string): void {
  if (typeof document === "undefined") return;
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(noteId)
      : noteId.replace(/["\\]/g, "\\$&");
  for (const el of document.querySelectorAll<HTMLElement>(`[data-note-id="${escaped}"]`)) {
    // Remove + reflow first so a write landing mid-flash restarts the pulse.
    el.classList.remove(CARD_FLASH_CLASS);
    void el.offsetWidth;
    el.classList.add(CARD_FLASH_CLASS);
    window.setTimeout(() => el.classList.remove(CARD_FLASH_CLASS), CARD_FLASH_MS);
  }
}

export interface ViewFieldWriteOptions {
  /**
   * Display label for the written value in the success toast — a board passes
   * the tapped lane's label so the toast echoes exactly what was tapped.
   * Defaults to `formatFieldValue(value)`.
   */
  valueLabel?: string;
  /**
   * Error-toast lead-in (the thrown error's message is appended after ": ").
   * Defaults to `Couldn't update ${field} on "${title}"`; the board overrides
   * to its shipped `Couldn't move "${title}"` phrasing.
   */
  errorPrefix?: string;
}

export interface ViewFieldWrite {
  /**
   * Write `field = value` on the note — immediate + self-confirming. Resolves
   * after the write settles either way (the error path toasts internally and
   * does NOT rethrow, mirroring the shipped call sites); the underlying
   * mutation owns the optimistic paint + rollback.
   */
  write: (field: string, value: ViewFieldValue, opts?: ViewFieldWriteOptions) => Promise<void>;
  isPending: boolean;
}

/**
 * A note-bound field write with the microconfirmation attached, optimistic
 * against `viewResultsKey` (the exact key the view's `useViewResults` reads).
 * Call once per rendered note, like `useViewFieldMutation` — which this wraps
 * (the note's `updatedAt` rides as the optimistic-concurrency baseline, as
 * both shipped call sites already did).
 */
export function useViewFieldWrite(note: Note, viewResultsKey: QueryKey): ViewFieldWrite {
  const pushToast = useToastStore((s) => s.push);
  const { move, isPending } = useViewFieldMutation(note.id, viewResultsKey);
  const noteId = note.id;
  const baselineUpdatedAt = note.updatedAt;
  const title = displayTitle(note).text;

  const write = useCallback(
    async (field: string, value: ViewFieldValue, opts?: ViewFieldWriteOptions) => {
      try {
        await move(field, value, baselineUpdatedAt);
      } catch (err) {
        // Rollback already happened inside the mutation — just explain.
        const prefix = opts?.errorPrefix ?? `Couldn't update ${field} on "${title}"`;
        pushToast(`${prefix}: ${err instanceof Error ? err.message : "unknown error"}`, "error");
        return;
      }
      const display = opts?.valueLabel ?? formatFieldValue(value);
      pushToast(display === null ? `✓ ${field} cleared` : `✓ ${field} → ${display}`, "success", {
        durationMs: MICROCONFIRM_TOAST_MS,
      });
      flashNoteCard(noteId);
    },
    [move, baselineUpdatedAt, title, noteId, pushToast],
  );

  return { write, isPending };
}
