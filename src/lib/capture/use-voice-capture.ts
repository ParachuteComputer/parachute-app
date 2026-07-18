import { type PermissionError, pickMimeType, requestMic } from "@/lib/capture/recorder";
import {
  type AudioSegment,
  type SegmentedRecorderController,
  createSegmentedRecorder,
} from "@/lib/capture/segmented-recorder";
import { useCallback, useEffect, useRef, useState } from "react";

// Voice-capture state machine extracted from the (now removed) Capture route
// so the unified Create screen can host an inline "Record" affordance without
// re-rolling MediaRecorder lifecycle. Caller decides UX (a tap-toggle Record/
// Stop button, where the preview lives, when to discard); this hook owns the
// audio bytes, the elapsed timer, and the URL-object lifetime.
//
// Voice Wave 2: recording is INVISIBLY segmented (see `segmented-recorder.ts`)
// so a recording of any length stays a set of standalone, transcribable audio
// containers. The UX is unchanged — one timer, one Stop — with at most a quiet
// "part k" hint (`parts`) once a long recording has rolled. `have-audio` now
// carries the ORDERED segment list; a recording that never rolls yields exactly
// one segment, and the caller's single-segment path stays byte-identical.

export type VoicePhase =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "denied"; message: string }
  | { kind: "recording"; startedAt: number }
  | {
      kind: "have-audio";
      // Every segment, in order. Length 1 in the common case.
      segments: AudioSegment[];
      mimeType: string;
      // Preview blob URL — the FIRST segment. Standalone containers can't be
      // concatenated into one valid file, so the preview plays part 1; the
      // saved note carries every segment.
      url: string;
      // Total recorded time across all segments.
      durationMs: number;
    };

export interface UseVoiceCaptureResult {
  phase: VoicePhase;
  elapsedMs: number;
  // The segment currently recording, 1-based. > 1 means a long recording has
  // rolled at least once — the caller shows a subtle "part k" hint. 0 when not
  // recording.
  parts: number;
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  discardAudio(): void;
  reset(): void;
}

export function useVoiceCapture(): UseVoiceCaptureResult {
  const [phase, setPhase] = useState<VoicePhase>({ kind: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [parts, setParts] = useState(0);
  const recorderRef = useRef<SegmentedRecorderController | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Tick the elapsed display while recording. One continuous timer across all
  // segments — the rollover is invisible here too.
  useEffect(() => {
    if (phase.kind !== "recording") return;
    const id = setInterval(() => setElapsedMs(Date.now() - phase.startedAt), 250);
    return () => clearInterval(id);
  }, [phase]);

  // Revoke any preview URL on unmount so we don't leak blob: handles, and
  // cancel a still-live recording so its rollover timer + mic stream don't leak.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (recorderRef.current && recorderRef.current.state === "recording") {
        recorderRef.current.cancel();
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    if (phase.kind === "recording" || phase.kind === "requesting") return;
    setPhase({ kind: "requesting" });
    try {
      const mimeType = pickMimeType();
      if (!mimeType) {
        setPhase({
          kind: "denied",
          message: "This browser can't record audio in a format we can save.",
        });
        return;
      }
      const stream = await requestMic();
      const rec = createSegmentedRecorder({
        stream,
        mimeType,
        onRoll: (activePart) => setParts(activePart),
      });
      recorderRef.current = rec;
      rec.start();
      setElapsedMs(0);
      setParts(rec.activePart);
      setPhase({ kind: "recording", startedAt: Date.now() });
    } catch (e) {
      const perm = e as PermissionError;
      const message =
        perm.kind === "permission-denied"
          ? "Microphone access was denied. Update your browser's site settings to record."
          : perm.kind === "no-device"
            ? "No microphone was found on this device."
            : perm instanceof Error
              ? perm.message
              : "Microphone is not available in this browser.";
      setPhase({ kind: "denied", message });
    }
  }, [phase]);

  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || phase.kind !== "recording") return;
    try {
      const segments = await rec.stop();
      recorderRef.current = null;
      setParts(0);
      const mimeType = segments[0]?.mimeType ?? "";
      const durationMs = segments.reduce((sum, s) => sum + s.durationMs, 0);
      const first = segments[0];
      const url = first
        ? URL.createObjectURL(new Blob([first.data], { type: first.mimeType }))
        : "";
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = url || null;
      setPhase({ kind: "have-audio", segments, mimeType, url, durationMs });
    } catch (e) {
      // Caller surfaces the toast — this hook is presentation-agnostic.
      console.warn(e instanceof Error ? `Recording failed: ${e.message}` : "Recording failed.");
      setParts(0);
      setPhase({ kind: "idle" });
    }
  }, [phase]);

  const discardAudio = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPhase({ kind: "idle" });
    setElapsedMs(0);
    setParts(0);
  }, []);

  // Same as discardAudio but exported under a distinct name to match the
  // capture-component reset semantics — after a successful save, the
  // caller clears its own state AND tells the hook to clear audio.
  const reset = useCallback(() => {
    discardAudio();
  }, [discardAudio]);

  // NOTE: recording is a TAP-TOGGLE (tap Record to start, tap Stop to end) —
  // NOT press-and-hold. The old global `pointerup`→stop listener was removed
  // 2026-07-07: it stopped on the tap's own release, giving 0-second clips
  // (a quick tap is pointerdown+pointerup). Recording now persists until the
  // user explicitly taps Stop. (A proper press-and-hold mode, gated on a hold
  // threshold, can be re-added later if wanted.)

  return { phase, elapsedMs, parts, startRecording, stopRecording, discardAudio, reset };
}
