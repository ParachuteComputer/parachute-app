import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SEGMENT_BYTES, SEGMENT_MS, createSegmentedRecorder } from "./segmented-recorder";

// Same minimal MediaRecorder stand-in the recorder tests use: stop() emits one
// data chunk then fires onstop synchronously. Each fresh segment builds a new
// instance, exactly as a real browser would on the same live stream.
class FakeMediaRecorder {
  static supported = new Set<string>(["audio/webm;codecs=opus"]);
  // Every constructed instance, in order — lets a test drive a specific
  // segment's data events directly (see emit()) without exposing the raw
  // recorder through SegmentedRecorderController's public surface.
  static instances: FakeMediaRecorder[] = [];
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  stream: MediaStream;
  mimeType: string;
  state: "inactive" | "recording" | "paused" = "inactive";

  constructor(stream: MediaStream, opts: { mimeType: string }) {
    this.stream = stream;
    this.mimeType = opts.mimeType;
    FakeMediaRecorder.instances.push(this);
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
  // Simulates a periodic `ondataavailable` tick (what a real MediaRecorder
  // fires when given a timeslice) WITHOUT stopping — lets a test emit bytes
  // at a chosen rate to exercise the size-based rollover independently of the
  // elapsed-time timer.
  emit(bytes: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
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
    FakeMediaRecorder.instances = [];
  });

  it("SEGMENT_MS is the 30-minute boundary", () => {
    expect(SEGMENT_MS).toBe(30 * 60_000);
  });

  it("MAX_SEGMENT_BYTES is the 20 MB size cap", () => {
    expect(MAX_SEGMENT_BYTES).toBe(20 * 1024 * 1024);
  });

  it("rolls early on emitted SIZE when the bitrate hint is ignored (un-honored ~128.8 kbps default)", async () => {
    const { stream, stop } = trackedStream();
    const timer = manualTimer();
    const onRoll = vi.fn();
    const rec = createSegmentedRecorder({
      stream,
      mimeType: "audio/webm;codecs=opus",
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      onRoll,
    });
    rec.start();
    const seg1 = FakeMediaRecorder.instances[0]!;

    // Un-honored browser default, measured with ffprobe: 128.8 kbps =
    // 16_100 bytes/sec. Feed it in 10s ticks (the size check's sampling
    // grain) — crossing MAX_SEGMENT_BYTES (20 MB) takes ~131 ticks, i.e.
    // ~1310s (~21.8 min) of simulated audio: well inside the 30-minute
    // SEGMENT_MS window, whose timer we never fire in this test. Any roll
    // that happens here can ONLY be the size cap.
    const BYTES_PER_TICK = 16_100 * 10;
    for (let i = 0; i < 200 && rec.activePart === 1; i++) {
      seg1.emit(BYTES_PER_TICK);
    }

    expect(rec.activePart).toBe(2);
    expect(onRoll).toHaveBeenCalledTimes(1);
    expect(onRoll).toHaveBeenCalledWith(2);
    // The elapsed-time timer for segment 1 was live and never fired — the
    // stream stays open, exactly one roll happened, no reentrant double-roll
    // from the old segment's own trailing stop()-triggered data event.
    expect(stop).not.toHaveBeenCalled();

    await rec.stop();
    expect(rec.activePart).toBe(2); // stopping doesn't spuriously add a 3rd
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("at the intended 32 kbps hint, still rolls on TIME at 30 minutes — the size cap does not preempt it", async () => {
    const { stream, stop } = trackedStream();
    const timer = manualTimer();
    const onRoll = vi.fn();
    let t = 0;
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
    const seg1 = FakeMediaRecorder.instances[0]!;

    // 32 kbps (the recorder's target bitrate, honored) = 4_000 bytes/sec.
    // A full 30-minute segment at that rate is ~7.2 MB — well under the
    // 20 MB cap — fed as one tick since the point is the TOTAL, not the
    // sampling cadence.
    seg1.emit(4_000 * 30 * 60);
    expect(rec.activePart).toBe(1);
    expect(onRoll).not.toHaveBeenCalled();

    t = 30 * 60_000;
    timer.fireRoll();
    expect(rec.activePart).toBe(2);
    expect(onRoll).toHaveBeenCalledWith(2);

    await rec.stop();
    expect(stop).toHaveBeenCalledTimes(1);
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
