// Single-purpose chip for voice-memo notes. Notes seeds the draft with
// `_Transcript pending._` at capture time (see `memoNoteContent()` in
// `src/lib/capture/recorder.ts`); vault's transcription worker swaps it for
// either the transcript, `_Transcription unavailable._`, or (cloud) the
// monthly voice-cap marker when it finishes, and stamps the audio
// attachment's `transcribe_status`. We mirror that state into the editor so
// the user isn't staring at a placeholder wondering whether anything is
// happening.
//
// The ATTACHMENT status is the primary source and the body markers the
// fallback — the read lives in `deriveTranscriptionState` so the chip and the
// pending-poll predicate (`useNote`) can't disagree. Wave 1: the
// pending→failed/limit flip now surfaces live (the note view holds a
// `useLiveNote` subscription + a pending poll), where before it needed a
// manual refresh.

import { deriveTranscriptionState } from "@/lib/transcription-status";
import type { NoteAttachment } from "@/lib/vault/types";

export function TranscriptionStatus({
  content,
  attachments,
}: {
  content: string;
  attachments?: NoteAttachment[];
}) {
  const state = deriveTranscriptionState({ content, attachments });

  if (state === "pending") {
    return (
      <output
        aria-live="polite"
        className="mb-4 inline-flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-1.5 text-xs text-sky-300"
      >
        <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-400" />
        Transcribing…
      </output>
    );
  }

  if (state === "failed") {
    return (
      <output className="mb-4 inline-flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-200">
        Transcription unavailable — open the audio below and add a note by hand.
      </output>
    );
  }

  if (state === "voice-limit") {
    // Not a failure — the audio is fine, the monthly budget isn't. Calm
    // resting state (no spinner, no alarm colour): the honest wait until the
    // meter resets next month.
    return (
      <output className="mb-4 inline-flex items-center gap-2 rounded-md border border-border bg-bg/40 px-3 py-1.5 text-xs text-fg-muted">
        Monthly voice limit reached — transcription resumes next month. The audio is saved below.
      </output>
    );
  }

  return null;
}
