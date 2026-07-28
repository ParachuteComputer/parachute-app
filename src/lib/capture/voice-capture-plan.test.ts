import { describe, expect, it } from "vitest";
import type { AudioSegment } from "./segmented-recorder";
import { buildVoiceCapturePlan } from "./voice-capture-plan";

const AT = new Date("2026-04-19T14:30:05.123Z");
const ISO = "2026-04-19T14-30-05-123";
const MIME = "audio/webm;codecs=opus";

const seg = (): AudioSegment => ({
  data: new Uint8Array([1, 2, 3]).buffer,
  mimeType: MIME,
  durationMs: 1000,
});

describe("buildVoiceCapturePlan — single segment (the sacred common case)", () => {
  it("no text → byte-identical to the pre-segmentation note shape", () => {
    const plan = buildVoiceCapturePlan({
      segments: [seg()],
      mimeType: MIME,
      typedText: "",
      recordedAt: AT,
      willTranscribe: true,
    });
    // Exactly the legacy body: bare marker, one embed, trailing newline.
    expect(plan.body).toBe(`_Transcript pending._\n\n![[memo-${ISO}.webm]]\n`);
    expect(plan.segments).toEqual([{ filename: `memo-${ISO}.webm`, transcribe: true }]);
    // No segment_index on the sole segment — the sacred invariant.
    expect(plan.segments[0]).not.toHaveProperty("segment_index");
  });

  it("with typed text → text, then bare marker, then embed", () => {
    const plan = buildVoiceCapturePlan({
      segments: [seg()],
      mimeType: MIME,
      typedText: "  a thought  ",
      recordedAt: AT,
      willTranscribe: true,
    });
    expect(plan.body).toBe(`a thought\n\n_Transcript pending._\n\n![[memo-${ISO}.webm]]\n`);
  });
});

describe("buildVoiceCapturePlan — segmented (N>1)", () => {
  it("pre-seeds N per-part pending markers IN ORDER, then N embeds", () => {
    const plan = buildVoiceCapturePlan({
      segments: [seg(), seg(), seg()],
      mimeType: MIME,
      typedText: "",
      recordedAt: AT,
      willTranscribe: true,
    });
    const expected = `${[
      "_Transcript pending (part 1)._",
      "_Transcript pending (part 2)._",
      "_Transcript pending (part 3)._",
      `![[memo-${ISO}-part1.webm]]`,
      `![[memo-${ISO}-part2.webm]]`,
      `![[memo-${ISO}-part3.webm]]`,
    ].join("\n\n")}\n`;
    expect(plan.body).toBe(expected);
  });

  it("each segment link carries a numeric, 0-based segment_index at the TOP level", () => {
    const plan = buildVoiceCapturePlan({
      segments: [seg(), seg()],
      mimeType: MIME,
      typedText: "",
      recordedAt: AT,
      willTranscribe: true,
    });
    expect(plan.segments).toEqual([
      { filename: `memo-${ISO}-part1.webm`, transcribe: true, segment_index: 0 },
      { filename: `memo-${ISO}-part2.webm`, transcribe: true, segment_index: 1 },
    ]);
    // The contract is a NUMBER — the servers reject non-numbers to bare.
    expect(typeof plan.segments[0]!.segment_index).toBe("number");
  });
});

describe("buildVoiceCapturePlan — audio-only (out of minutes)", () => {
  it("single segment: NO pending marker, transcribe:false, no segment_index", () => {
    const plan = buildVoiceCapturePlan({
      segments: [seg()],
      mimeType: MIME,
      typedText: "",
      recordedAt: AT,
      willTranscribe: false,
    });
    expect(plan.body).toBe(`![[memo-${ISO}.webm]]\n`);
    expect(plan.segments).toEqual([{ filename: `memo-${ISO}.webm`, transcribe: false }]);
  });

  it("segmented: NO markers, every link transcribe:false with no segment_index", () => {
    const plan = buildVoiceCapturePlan({
      segments: [seg(), seg()],
      mimeType: MIME,
      typedText: "keep this",
      recordedAt: AT,
      willTranscribe: false,
    });
    expect(plan.body).toBe(
      `keep this\n\n![[memo-${ISO}-part1.webm]]\n\n![[memo-${ISO}-part2.webm]]\n`,
    );
    expect(plan.segments.every((s) => s.transcribe === false)).toBe(true);
    expect(plan.segments.some((s) => "segment_index" in s)).toBe(false);
  });
});
