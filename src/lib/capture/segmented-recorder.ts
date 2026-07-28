// Unlimited-length voice capture via INVISIBLE segmentation.
//
// A single MediaRecorder run can grow unbounded in memory and (on some
// platforms) produce a container the transcription pipeline chokes on past a
// certain length. So instead of one ever-growing recorder, we roll to a FRESH
// MediaRecorder every `SEGMENT_MS` on the SAME microphone stream. Each segment
// is therefore a standalone, valid audio container the vault can transcribe on
// its own — which is exactly why we do NOT use MediaRecorder's `timeslice`
// chunking: those chunks are fragments of one container, not independently
// decodable files.
//
// The rollover is invisible to the user: one stream, one continuous elapsed
// timer (owned by the hook), one Stop button. This controller only manages the
// recorder handoff and hands back the ordered list of segments on stop.
//
// The common case is sacred: a recording that never reaches SEGMENT_MS yields
// exactly ONE segment, and the caller's single-segment path stays byte-for-byte
// identical to the pre-segmentation behavior.

import { type CreateRecorderOptions, type RecordingResult, createRecorder } from "./recorder";

/** Roll to a new segment every 30 minutes. Constant on purpose — the boundary
 *  is a memory/pipeline safety valve, not a user-facing dial.
 *
 *  What actually bounds this number (don't raise it past 45 without
 *  re-deriving both): at the recorder's 32 kbps speech bitrate, a 30-minute
 *  segment is ~6.9 MB — 3.6x under Cloud's 25 MB per-attachment ceiling, and
 *  2x under the ~60-minute Whisper inference wall. The inference wall is a
 *  DURATION limit no bitrate change moves, so it's the harder ceiling of the
 *  two past a point. 30 was picked because Aaron's actual walks run
 *  20-30 minutes, so this is the first boundary he doesn't routinely hit. */
export const SEGMENT_MS = 30 * 60_000;

/** Size ceiling that preempts the timer above, for when the recorder's
 *  bitrate hint is ignored (see recorder.ts's `audioBitsPerSecond` comment —
 *  it's a browser HINT, not a guarantee). At the un-honored default (128.8
 *  kbps, measured with ffprobe), a full 30-minute segment is ~27.6 MB — OVER
 *  Cloud's 25 MB per-attachment ceiling, reproducing this very PR's bug
 *  (segment uploads, door rejects it) from a brand-new cause.
 *
 *  Rolling early at 20 MB makes every segment safe UNCONDITIONALLY, the same
 *  property the old 10-minute boundary had: hint honored, you still get full
 *  30-minute segments (~6.9 MB — this cap never fires); hint ignored, you get
 *  ~10-minute segments — exactly today's pre-this-PR behavior, not a new
 *  failure mode. 20 MB rather than 25 leaves headroom for container overhead
 *  and the final chunk landing after the check fires. */
export const MAX_SEGMENT_BYTES = 20 * 1024 * 1024;

// How often we sample the current segment's emitted size against
// MAX_SEGMENT_BYTES. This requests a MediaRecorder timeslice (see
// recorder.ts's `dataIntervalMs`) — NOT as the segmentation mechanism
// (segments are still whole containers stitched by `concatBlobs()` on stop;
// the top-of-file comment's "we do NOT use timeslice chunking" is about that,
// unrelated concern) — purely so an un-honored bitrate is caught within
// seconds instead of only being discovered at the next 30-minute boundary.
const SIZE_CHECK_MS = 10_000;

/** One recorded segment — the same shape a single `RecorderController.stop()`
 *  returns, so a one-segment recording is indistinguishable from the old path. */
export type AudioSegment = RecordingResult;

export type SegmentedRecorderState = "idle" | "recording" | "stopped";

export interface SegmentedRecorderController {
  readonly state: SegmentedRecorderState;
  /** The segment currently recording, 1-based (0 before start). */
  readonly activePart: number;
  start(): void;
  /** Resolves with every segment IN ORDER once the final one flushes.
   *  Releases the microphone stream as a side effect. */
  stop(): Promise<AudioSegment[]>;
  /** Abandon the recording without resolving stop(); releases the stream. */
  cancel(): void;
}

export interface CreateSegmentedRecorderOptions {
  stream: MediaStream;
  mimeType: string;
  /** Defaults to SEGMENT_MS. Tests override to a small value to exercise rolls. */
  segmentMs?: number;
  /** Fired right after a boundary roll, with the new active part (2, 3, …) —
   *  the "part k" hint the UI shows while a long recording is in flight. */
  onRoll?: (activePart: number) => void;
  // Injection points (tests). `now` + `MediaRecorderCtor` flow through to the
  // per-segment recorders; `setTimer`/`clearTimer` default to the globals so
  // fake timers can drive rollover deterministically.
  now?: () => number;
  MediaRecorderCtor?: typeof MediaRecorder;
  makeRecorder?: (opts: CreateRecorderOptions) => ReturnType<typeof createRecorder>;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export function createSegmentedRecorder(
  opts: CreateSegmentedRecorderOptions,
): SegmentedRecorderController {
  const segmentMs = opts.segmentMs ?? SEGMENT_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));
  const makeRecorder =
    opts.makeRecorder ??
    ((o: CreateRecorderOptions) => createRecorder({ ...o, releaseStreamOnStop: false }));

  // Stop-promises captured IN ORDER: each roll pushes the finishing segment's
  // promise before starting the next, and stop() pushes the final one. Awaiting
  // them with Promise.all preserves order regardless of flush timing.
  const segmentPromises: Promise<AudioSegment>[] = [];
  let current: ReturnType<typeof createRecorder> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let state: SegmentedRecorderState = "idle";
  let activePart = 0;
  // Bumped on every startSegment() so a segment's onData closure can tell it's
  // been superseded — guards against a stale/late size-check event (a real
  // MediaRecorder can flush its last chunk asynchronously after stop()) from
  // rolling the NEW segment early off the OLD segment's bytes.
  let segmentGen = 0;
  // True for the duration of a roll() call. Rolling calls current.stop(),
  // whose own trailing ondataavailable can re-report a size at-or-past
  // MAX_SEGMENT_BYTES synchronously, in the SAME callstack, before segmentGen
  // has even been bumped — this guards that reentrant call, distinct from
  // (and in addition to) the segmentGen guard above.
  let rolling = false;

  const releaseStream = () => {
    for (const track of opts.stream.getTracks()) track.stop();
  };

  const clearRollTimer = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const armRollTimer = () => {
    timer = setTimer(() => {
      timer = null;
      roll();
    }, segmentMs);
  };

  const startSegment = () => {
    segmentGen += 1;
    const myGen = segmentGen;
    current = makeRecorder({
      stream: opts.stream,
      mimeType: opts.mimeType,
      releaseStreamOnStop: false,
      now: opts.now,
      MediaRecorderCtor: opts.MediaRecorderCtor,
      dataIntervalMs: SIZE_CHECK_MS,
      onData: (bytes) => {
        if (myGen === segmentGen && bytes >= MAX_SEGMENT_BYTES) roll();
      },
    });
    current.start();
    activePart += 1;
    armRollTimer();
  };

  const roll = () => {
    if (state !== "recording" || !current || rolling) return;
    rolling = true;
    // A roll can now fire either from the elapsed-time timer OR from the size
    // check above — whichever trips first cancels the other so it doesn't
    // ALSO fire against the segment that already replaced it.
    clearRollTimer();
    // Fire the current recorder's stop (captures its bytes in order) and start
    // the next one immediately on the same live stream — the handoff gap is a
    // synchronous reassignment, so effectively no audio is lost at the seam.
    segmentPromises.push(current.stop());
    startSegment();
    opts.onRoll?.(activePart);
    rolling = false;
  };

  return {
    get state() {
      return state;
    },
    get activePart() {
      return activePart;
    },
    start(): void {
      if (state !== "idle") throw new Error(`Cannot start from ${state}`);
      state = "recording";
      startSegment();
    },
    async stop(): Promise<AudioSegment[]> {
      if (state !== "recording" || !current) {
        throw new Error(`Cannot stop from ${state}`);
      }
      state = "stopped";
      clearRollTimer();
      segmentPromises.push(current.stop());
      current = null;
      const results = await Promise.all(segmentPromises);
      releaseStream();
      return results;
    },
    cancel(): void {
      clearRollTimer();
      if (current) current.cancel();
      current = null;
      state = "stopped";
      releaseStream();
    },
  };
}
