import { beforeEach, describe, expect, it, vi } from "vitest";
import { SEGMENT_MS, createSegmentedRecorder } from "./segmented-recorder";

// Same minimal MediaRecorder stand-in the recorder tests use: stop() emits one
// data chunk then fires onstop synchronously. Each fresh segment builds a new
// instance, exactly as a real browser would on the same live stream.
class FakeMediaRecorder {
  static supported = new Set<string>(["audio/webm;codecs=opus"]);
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  stream: MediaStream;
  mimeType: string;
  state: "inactive" | "recording" | "paused" = "inactive";

  constructor(stream: MediaStream, opts: { mimeType: string }) {
    this.stream = stream;
    this.mimeType = opts.mimeType;
  }
  static isTypeSupported(t: string): boolean {
    return FakeMediaRecorder.supported.has(t);
  }
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3, 4])]) });
    this.onstop?.();
  }
}

function trackedStream() {
  const stop = vi.fn();
  const stream = {
    getTracks: () => [{ stop } as unknown as MediaStreamTrack],
  } as unknown as MediaStream;
  return { stream, stop };
}

/** A hand-driven timer: `createSegmentedRecorder` arms one roll timer at a
 *  time; `fireRoll()` invokes the pending callback to simulate a boundary. */
function manualTimer() {
  let pending: (() => void) | null = null;
  return {
    setTimer: (fn: () => void) => {
      pending = fn;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      pending = null;
    },
    fireRoll: () => {
      const f = pending;
      pending = null;
      f?.();
    },
    hasPending: () => pending !== null,
  };
}

describe("createSegmentedRecorder", () => {
  beforeEach(() => {
    FakeMediaRecorder.supported = new Set(["audio/webm;codecs=opus"]);
  });

  it("SEGMENT_MS is the 30-minute boundary", () => {
    expect(SEGMENT_MS).toBe(30 * 60_000);
  });

  it("a recording that never rolls yields exactly ONE segment (common case)", async () => {
    let t = 1_000;
    const { stream, stop } = trackedStream();
    const timer = manualTimer();
    const onRoll = vi.fn();
    const rec = createSegmentedRecorder({
      stream,
      mimeType: "audio/webm;codecs=opus",
      now: () => t,
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      onRoll,
    });
    rec.start();
    expect(rec.activePart).toBe(1);
    t = 3_500;
    const segments = await rec.stop();

    expect(segments).toHaveLength(1);
    expect(segments[0]!.durationMs).toBe(2_500);
    expect(segments[0]!.mimeType).toBe("audio/webm;codecs=opus");
    expect(onRoll).not.toHaveBeenCalled();
    // The stream is released exactly once, on the final stop — NOT between
    // segments (there were none) and NOT twice.
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("rolls to a fresh segment at each boundary and returns them all IN ORDER", async () => {
    let t = 0;
    const { stream, stop } = trackedStream();
    const timer = manualTimer();
    const onRoll = vi.fn();
    const rec = createSegmentedRecorder({
      stream,
      mimeType: "audio/webm;codecs=opus",
      now: () => t,
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      onRoll,
    });

    rec.start(); // segment 1 starts at t=0
    expect(rec.activePart).toBe(1);

    t = 1_000;
    timer.fireRoll(); // segment 1 ends (1000ms), segment 2 starts at t=1000
    expect(rec.activePart).toBe(2);

    t = 2_500;
    timer.fireRoll(); // segment 2 ends (1500ms), segment 3 starts at t=2500
    expect(rec.activePart).toBe(3);

    t = 3_000;
    const segments = await rec.stop(); // segment 3 ends (500ms)

    expect(segments).toHaveLength(3);
    expect(segments.map((s) => s.durationMs)).toEqual([1_000, 1_500, 500]);
    // onRoll fired once per boundary, reporting the NEW active part.
    expect(onRoll.mock.calls.map((c) => c[0])).toEqual([2, 3]);
    // Stream released once, at the end — the mic stayed live across every roll.
    expect(stop).toHaveBeenCalledTimes(1);
    // No dangling roll timer after stop.
    expect(timer.hasPending()).toBe(false);
  });

  it("cancel() releases the stream and stops without resolving segments", () => {
    const { stream, stop } = trackedStream();
    const timer = manualTimer();
    const rec = createSegmentedRecorder({
      stream,
      mimeType: "audio/webm;codecs=opus",
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });
    rec.start();
    rec.cancel();
    expect(rec.state).toBe("stopped");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(timer.hasPending()).toBe(false);
  });

  it("rejects start() when not idle and stop() when not recording", async () => {
    const { stream } = trackedStream();
    const timer = manualTimer();
    const rec = createSegmentedRecorder({
      stream,
      mimeType: "audio/webm;codecs=opus",
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });
    rec.start();
    expect(() => rec.start()).toThrow();
    await rec.stop();
    await expect(rec.stop()).rejects.toThrow();
  });
});
