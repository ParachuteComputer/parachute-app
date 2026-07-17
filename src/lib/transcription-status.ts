// Shared reading of a voice note's transcription state — the ONE place that
// interprets "is this note transcribing / did it fail / did it hit the voice
// cap / is it done?" Both the status chip (`TranscriptionStatus`) and the
// pending-poll predicate (`useNote`) derive from here so they can never
// disagree about whether a note is still in flight.
//
// Two sources, in priority order (Wave 1 hardening):
//
//   1. The ATTACHMENT record — vault stamps the audio attachment's `metadata`
//      with `transcribe_status: "pending" | "done" | "failed"` on BOTH doors
//      (self-host `parachute-vault/src/routes.ts` + the transcription worker;
//      cloud `workers/vault/src/vault-do.ts:markTerminal`/`markDone`). This is
//      the primary, structured signal — the note fetch already includes
//      attachments (`useNote` fetches `includeAttachments: true`).
//   2. The BODY MARKERS — the cross-door portable-markdown contract vault
//      writes into the note body. Kept as the fallback for older self-host
//      vaults that predate attachment status, and for surfaces that render a
//      note without its attachments loaded. NEVER removed — they're the
//      wire-visible contract.
//
// The voice-cap case needs BOTH: `markTerminal` stores `transcribe_status:
// "failed"` for the monthly-limit terminal too (it can't distinguish itself
// from a genuine failure in the attachment row), so the limit is told apart
// from a real failure ONLY by the `_Monthly voice limit reached…_` body
// marker.

import type { NoteAttachment } from "@/lib/vault/types";

/** Body markers vault writes — the portable-markdown cross-door contract. */
export const PENDING_MARKER = "_Transcript pending._";
export const UNAVAILABLE_MARKER = "_Transcription unavailable._";
// The voice-cap marker carries a human sentence after the lead phrase
// (`… — transcription resumes next month.`); match the stable lead so copy
// tweaks server-side don't break the read. Mirrors vault's
// `TRANSCRIPT_LIMIT_REACHED` / `ANY_TERMINAL_MARKER` regex.
export const VOICE_LIMIT_MARKER_RE = /_Monthly voice limit reached[^\n]*\._/;

/**
 * The rendered transcription state of a note:
 *   - `pending`     — transcription in flight (spinner chip, aria-live).
 *   - `failed`      — terminal failure (amber "unavailable" chip).
 *   - `voice-limit` — cloud monthly voice cap reached (calm resting chip).
 *   - `none`        — done, or not a voice note (no chip, and the poll stops).
 */
export type TranscriptionState = "pending" | "failed" | "voice-limit" | "none";

/** The minimal note shape this module reads. */
export interface TranscribableNote {
  content?: string;
  attachments?: NoteAttachment[];
}

/**
 * The first audio attachment's `transcribe_status`, if any attachment on the
 * note carries one. Returns `undefined` when no attachment declares a status
 * (older self-host, or attachments not loaded) — callers fall back to markers.
 */
function attachmentStatus(
  attachments: NoteAttachment[] | undefined,
): "pending" | "done" | "failed" | undefined {
  for (const a of attachments ?? []) {
    const s = a.metadata?.transcribe_status;
    if (s === "pending" || s === "done" || s === "failed") return s;
  }
  return undefined;
}

/**
 * Derive a note's transcription state — attachment-status-first, body-marker
 * fallback. See the module header for the two-source contract.
 */
export function deriveTranscriptionState(note: TranscribableNote): TranscriptionState {
  const content = note.content ?? "";
  const hasLimitMarker = VOICE_LIMIT_MARKER_RE.test(content);

  const status = attachmentStatus(note.attachments);
  if (status === "pending") return "pending";
  if (status === "done") return "none";
  if (status === "failed") return hasLimitMarker ? "voice-limit" : "failed";

  // No structured status — fall back to the body markers.
  if (content.includes(PENDING_MARKER)) return "pending";
  if (hasLimitMarker) return "voice-limit";
  if (content.includes(UNAVAILABLE_MARKER)) return "failed";
  return "none";
}

/**
 * True while a note's transcription is in a non-terminal state. The poll
 * fallback in `useNote` conditions on this so the transcript/failure converges
 * without a manual refresh even if the live socket drops.
 */
export function isTranscriptionPending(note: TranscribableNote): boolean {
  return deriveTranscriptionState(note) === "pending";
}
