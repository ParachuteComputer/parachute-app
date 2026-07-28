// The note body + per-segment upload/link plan for a voice capture. Kept as a
// PURE function (no React, no queue) so the sacred single-segment byte-identity
// and the segmented per-part contract can both be pinned directly in tests —
// NoteNew's `saveWithAudio` just executes the plan (validate → blob → enqueue).

import { memoFilename } from "./recorder";
import type { AudioSegment } from "./segmented-recorder";

/** Per-segment upload/link descriptor. */
export interface VoiceSegmentPlan {
  /** Storage filename. Part-suffixed for N>1 so segments sharing one capture
   *  timestamp don't collide; bare for the single-segment common case. */
  filename: string;
  /** Whether to ask the vault to transcribe this segment. */
  transcribe: boolean;
  /** A NUMBER, 0-based, for a transcribed N>1 capture so the vault fills
   *  that part's own marker; omitted otherwise. TOP LEVEL on this plan
   *  object and every shape it flows through (`PendingLinkAttachment`, the
   *  `linkAttachment` wire body) — a `{ metadata: { segment_index } }`
   *  wrapper is what silently dropped it before (both doors read
   *  `body.segment_index` directly). */
  segment_index?: number;
}

export interface VoiceCapturePlan {
  /** The note body: optional typed text, then the pending markers (when
   *  transcribing), then the audio embeds — all in order. */
  body: string;
  /** One descriptor per segment, in order. */
  segments: VoiceSegmentPlan[];
}

/**
 * Build the note body + per-segment plan for a voice capture.
 *
 * Invariants:
 *  - SINGLE segment + transcribing = the sacred common case: bare
 *    `_Transcript pending._`, one embed, NO segment_index — byte-identical to
 *    the pre-segmentation note shape.
 *  - N>1 + transcribing: N per-part pending markers IN ORDER
 *    (`_Transcript pending (part k)._`), then N embeds; each link carries a
 *    numeric `segment_index` (0-based).
 *  - Not transcribing (out of minutes): NO pending markers (audio-only), and
 *    every link sends `transcribe: false` with NO segment_index.
 */
export function buildVoiceCapturePlan(input: {
  segments: AudioSegment[];
  mimeType: string;
  typedText: string;
  recordedAt: Date;
  willTranscribe: boolean;
}): VoiceCapturePlan {
  const { segments, mimeType, recordedAt, willTranscribe } = input;
  const multi = segments.length > 1;
  const typed = input.typedText.trim();

  const plan: VoiceSegmentPlan[] = segments.map((_seg, k) => ({
    filename: multi
      ? memoFilename(mimeType, recordedAt, k + 1)
      : memoFilename(mimeType, recordedAt),
    transcribe: willTranscribe,
    ...(willTranscribe && multi ? { segment_index: k } : {}),
  }));

  const markerBlock = !willTranscribe
    ? ""
    : multi
      ? segments.map((_seg, k) => `_Transcript pending (part ${k + 1})._`).join("\n\n")
      : "_Transcript pending._";
  const embeds = plan.map((s) => `![[${s.filename}]]`).join("\n\n");

  const parts: string[] = [];
  if (typed) parts.push(typed);
  if (markerBlock) parts.push(markerBlock);
  parts.push(embeds);
  return { body: `${parts.join("\n\n")}\n`, segments: plan };
}
