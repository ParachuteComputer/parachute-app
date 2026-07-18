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
//
// Voice Wave 2 (segmentation): a note can now carry MULTIPLE audio attachments
// (one per segment of a long recording). The derivation scans ALL of them —
// ANY pending → "Transcribing…"; none pending + any failed → the failed chip.
// Each segment fills its OWN per-part marker (`_Transcript pending (part N)._`
// / `_Transcription unavailable (part N)._`), so the marker fallback recognizes
// both the bare and the `(part N)` forms.

import type { NoteAttachment } from "@/lib/vault/types";

/** Body markers vault writes — the portable-markdown cross-door contract. The
 *  single-segment (bare) forms are kept as named constants for the seed sites
 *  that write them; the regexes below match bare AND per-part forms for the
 *  read. */
export const PENDING_MARKER = "_Transcript pending._";
export const UNAVAILABLE_MARKER = "_Transcription unavailable._";

// Bare `_Transcript pending._` OR the segmented `_Transcript pending (part 3)._`.
export const PENDING_MARKER_RE = /_Transcript pending(?: \(part \d+\))?\._/;
export const UNAVAILABLE_MARKER_RE = /_Transcription unavailable(?: \(part \d+\))?\._/;
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

type SegmentStatus = "pending" | "done" | "failed";

interface AttachmentTally {
  pending: number;
  failed: number;
  done: number;
  /** How many attachments carried a `transcribe_status` at all. 0 means fall
   *  back to the body markers. */
  total: number;
}

/**
 * Tally every audio attachment's `transcribe_status`. A note can carry several
 * (one per recording segment); the chip + poll both need the aggregate, not
 * just the first one.
 */
function tallyAttachmentStatuses(attachments: NoteAttachment[] | undefined): AttachmentTally {
  const tally: AttachmentTally = { pending: 0, failed: 0, done: 0, total: 0 };
  for (const a of attachments ?? []) {
    const s = a.metadata?.transcribe_status;
    if (s === "pending" || s === "done" || s === "failed") {
      tally[s as SegmentStatus] += 1;
      tally.total += 1;
    }
  }
  return tally;
}

/**
 * Derive a note's transcription state — attachment-status-first, body-marker
 * fallback. See the module header for the two-source contract. Multi-segment
 * precedence: ANY pending segment wins ("still transcribing"); only once none
 * are pending does a failed segment surface the failed/limit chip.
 */
export function deriveTranscriptionState(note: TranscribableNote): TranscriptionState {
  const content = note.content ?? "";
  const hasLimitMarker = VOICE_LIMIT_MARKER_RE.test(content);

  const { pending, failed, total } = tallyAttachmentStatuses(note.attachments);
  if (total > 0) {
    if (pending > 0) return "pending";
    if (failed > 0) return hasLimitMarker ? "voice-limit" : "failed";
    return "none"; // every segment done
  }

  // No structured status — fall back to the body markers (bare or per-part).
  if (PENDING_MARKER_RE.test(content)) return "pending";
  if (hasLimitMarker) return "voice-limit";
  if (UNAVAILABLE_MARKER_RE.test(content)) return "failed";
  return "none";
}

/**
 * Segment progress for the chip's "part k of n" hint — how many of a segmented
 * recording's parts have finished, out of the total. Returns `null` unless the
 * structured attachment statuses describe MORE THAN ONE segment (a single
 * recording gets the plain "Transcribing…" chip, byte-identical to before).
 * `done` is the count already terminal (done or failed); `k` = done + 1 is the
 * part now in flight.
 */
export function deriveTranscriptionProgress(
  note: TranscribableNote,
): { done: number; total: number } | null {
  const { pending, failed, done, total } = tallyAttachmentStatuses(note.attachments);
  if (total <= 1) return null;
  if (pending === 0) return null; // nothing in flight — no progress to show
  return { done: done + failed, total };
}

/**
 * True while a note's transcription is in a non-terminal state. The poll
 * fallback in `useNote` conditions on this so the transcript/failure converges
 * without a manual refresh even if the live socket drops.
 */
export function isTranscriptionPending(note: TranscribableNote): boolean {
  return deriveTranscriptionState(note) === "pending";
}

/**
 * Optimistic note shape for a "Retry transcription" tap: flip every failed
 * audio attachment back to pending and rewrite the failure body markers
 * (bare + per-part) to their pending forms, so `deriveTranscriptionState`
 * immediately reads "pending" and the chip shows "Transcribing…". Reverted by
 * the mutation's `onError` if the retry can't proceed.
 */
export function retryOptimisticNote<T extends TranscribableNote>(note: T): T {
  const attachments = note.attachments?.map((a) => {
    if (a.metadata?.transcribe_status === "failed") {
      return { ...a, metadata: { ...a.metadata, transcribe_status: "pending" } };
    }
    return a;
  });
  const content = note.content?.replace(
    /_Transcription unavailable( \(part \d+\))?\._/g,
    (_m, part) => `_Transcript pending${part ?? ""}._`,
  );
  return { ...note, ...(attachments ? { attachments } : {}), ...(content ? { content } : {}) };
}
