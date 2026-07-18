import type { NoteAttachment } from "@/lib/vault/types";
import { describe, expect, it } from "vitest";
import {
  type TranscribableNote,
  deriveTranscriptionProgress,
  deriveTranscriptionState,
  isTranscriptionPending,
  retryOptimisticNote,
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

// Voice Wave 2: a segmented recording lands as SEVERAL audio attachments. The
// chip + poll scan them ALL — any pending wins, and only once none are pending
// does a failed one surface.
describe("multi-attachment precedence (segmented recordings)", () => {
  const matrix: Array<[string, NoteAttachment[], string]> = [
    ["one pending among done → pending", [audio("done"), audio("pending")], "pending"],
    ["last pending among failed → pending", [audio("failed"), audio("pending")], "pending"],
    ["all done → none", [audio("done"), audio("done")], "none"],
    ["none pending, one failed → failed", [audio("done"), audio("failed")], "failed"],
    ["none pending, all failed → failed", [audio("failed"), audio("failed")], "failed"],
  ];
  for (const [name, attachments, expected] of matrix) {
    it(name, () => expect(deriveTranscriptionState({ attachments })).toBe(expected));
  }

  it("failed segments + the limit marker → voice-limit, not failed", () => {
    expect(
      deriveTranscriptionState({ content: LIMIT, attachments: [audio("done"), audio("failed")] }),
    ).toBe("voice-limit");
  });
});

// The chip's "part k of n" hint reads the structured segment counts.
describe("deriveTranscriptionProgress", () => {
  it("returns null for a single-segment recording (plain 'Transcribing…')", () => {
    expect(deriveTranscriptionProgress({ attachments: [audio("pending")] })).toBeNull();
  });
  it("returns null when nothing is pending (no progress to show)", () => {
    expect(
      deriveTranscriptionProgress({ attachments: [audio("done"), audio("failed")] }),
    ).toBeNull();
  });
  it("counts terminal parts as done, out of the total, while one is in flight", () => {
    expect(
      deriveTranscriptionProgress({
        attachments: [audio("done"), audio("failed"), audio("pending")],
      }),
    ).toEqual({ done: 2, total: 3 });
  });
});

// Part-marker awareness in the body-marker fallback (no attachment statuses).
describe("per-part body markers (marker fallback)", () => {
  it("recognizes a per-part pending marker", () => {
    expect(deriveTranscriptionState({ content: "_Transcript pending (part 2)._" })).toBe("pending");
  });
  it("recognizes a per-part unavailable marker", () => {
    expect(deriveTranscriptionState({ content: "_Transcription unavailable (part 3)._" })).toBe(
      "failed",
    );
  });
  it("a per-part pending marker still wins over a per-part terminal marker", () => {
    expect(
      deriveTranscriptionState({
        content: "_Transcript pending (part 2)._\n\n_Transcription unavailable (part 1)._",
      }),
    ).toBe("pending");
  });
});

describe("retryOptimisticNote", () => {
  it("flips failed audio attachments back to pending", () => {
    const note = { content: "body", attachments: [audio("failed"), audio("done")] };
    const next = retryOptimisticNote(note);
    expect(next.attachments?.[0]?.metadata?.transcribe_status).toBe("pending");
    // A done segment is left alone.
    expect(next.attachments?.[1]?.metadata?.transcribe_status).toBe("done");
    // And the derived state is now pending — the chip immediately reads live.
    expect(deriveTranscriptionState(next)).toBe("pending");
  });

  it("rewrites bare AND per-part unavailable markers to their pending forms", () => {
    const note = {
      content: "_Transcription unavailable (part 1)._\n\n_Transcription unavailable._",
    };
    const next = retryOptimisticNote(note);
    expect(next.content).toContain("_Transcript pending (part 1)._");
    expect(next.content).toContain("_Transcript pending._");
    expect(next.content).not.toContain("unavailable");
  });
});
