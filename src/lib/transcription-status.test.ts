import type { NoteAttachment } from "@/lib/vault/types";
import { describe, expect, it } from "vitest";
import {
  type TranscribableNote,
  deriveTranscriptionState,
  isTranscriptionPending,
} from "./transcription-status";

const audio = (status?: string): NoteAttachment =>
  ({
    id: "a",
    mimeType: "audio/webm",
    metadata: status ? { transcribe_status: status } : {},
  }) as unknown as NoteAttachment;

const PENDING = "_Transcript pending._";
const UNAVAILABLE = "_Transcription unavailable._";
const LIMIT = "_Monthly voice limit reached — transcription resumes next month._";

describe("deriveTranscriptionState", () => {
  it("is 'none' for a plain note with no markers or attachments", () => {
    expect(deriveTranscriptionState({ content: "just a note" })).toBe("none");
  });

  describe("attachment status is primary", () => {
    const cases: Array<[string, TranscribableNote, string]> = [
      ["pending attachment → pending", { attachments: [audio("pending")] }, "pending"],
      ["done attachment → none (transcript landed)", { attachments: [audio("done")] }, "none"],
      [
        "failed attachment (no limit marker) → failed",
        { attachments: [audio("failed")] },
        "failed",
      ],
      [
        "failed attachment + limit body marker → voice-limit",
        { content: LIMIT, attachments: [audio("failed")] },
        "voice-limit",
      ],
      [
        "done attachment beats a stale pending body marker",
        { content: PENDING, attachments: [audio("done")] },
        "none",
      ],
    ];
    for (const [name, note, expected] of cases) {
      it(name, () => expect(deriveTranscriptionState(note)).toBe(expected));
    }
  });

  describe("body-marker fallback when no attachment status", () => {
    it("pending marker → pending", () => {
      expect(deriveTranscriptionState({ content: `x\n${PENDING}\n` })).toBe("pending");
    });
    it("unavailable marker → failed", () => {
      expect(deriveTranscriptionState({ content: `x\n${UNAVAILABLE}` })).toBe("failed");
    });
    it("limit marker → voice-limit", () => {
      expect(deriveTranscriptionState({ content: LIMIT })).toBe("voice-limit");
    });
    it("pending wins over a coexisting terminal marker", () => {
      expect(deriveTranscriptionState({ content: `${PENDING}\n${UNAVAILABLE}` })).toBe("pending");
    });
    it("an attachment with no transcribe_status does not shadow the body markers", () => {
      // getAttachments can return a non-audio / statusless attachment; the
      // marker fallback must still fire.
      expect(deriveTranscriptionState({ content: PENDING, attachments: [audio(undefined)] })).toBe(
        "pending",
      );
    });
  });
});

describe("isTranscriptionPending", () => {
  it("true only for the pending state", () => {
    expect(isTranscriptionPending({ attachments: [audio("pending")] })).toBe(true);
    expect(isTranscriptionPending({ content: PENDING })).toBe(true);
    expect(isTranscriptionPending({ attachments: [audio("done")] })).toBe(false);
    expect(isTranscriptionPending({ attachments: [audio("failed")] })).toBe(false);
    expect(isTranscriptionPending({ content: LIMIT })).toBe(false);
    expect(isTranscriptionPending({ content: "plain" })).toBe(false);
  });
});
