import { AttachmentDropZone } from "@/components/AttachmentDropZone";
import { AttachmentPicker, type AttachmentPickerHandle } from "@/components/AttachmentPicker";
import { AttachmentUploadList } from "@/components/AttachmentUploadList";
import type { CodeMirrorEditorHandle } from "@/components/CodeMirrorEditor";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { buildWikilinkResolver } from "@/components/MarkdownView";
import { NoteRenderer } from "@/components/NoteRenderer";
import { TagEditor, normalizeTag } from "@/components/TagEditor";
import { VoiceUnavailableNote } from "@/components/VoiceUnavailableNote";
import { useAttachmentUploader } from "@/components/useAttachmentUploader";
import { extractHashtags } from "@/lib/capture/hashtags";
import { quickPath } from "@/lib/capture/recorder";
import { buildTextNotePayload } from "@/lib/capture/text-note";
import { loadTranscribeDefault } from "@/lib/capture/transcribe-default";
import { useVoiceCapture } from "@/lib/capture/use-voice-capture";
import { buildVoiceCapturePlan } from "@/lib/capture/voice-capture-plan";
import { NEW_NOTE_SCOPE, clearDraft, loadDraft } from "@/lib/drafts/store";
import { useDraftAutosave } from "@/lib/drafts/use-draft-autosave";
import { readStoredLivePreview } from "@/lib/editor-mode";
import { blobRef, enqueue, newBlobId, newLocalId } from "@/lib/sync";
import { relativeTime } from "@/lib/time";
import { useToastStore } from "@/lib/toast/store";
import { useCreateNote, useLinkAttachment, useTagRoles, useVaultStore } from "@/lib/vault";
import { validateFile } from "@/lib/vault/attachment-upload";
import {
  useAudioRetention,
  useRetentionChoiceMade,
  useSetAudioRetention,
} from "@/lib/vault/audio-retention";
import { type CreateNotePayload, VaultAuthError } from "@/lib/vault/client";
import {
  optimisticCreatedNote,
  useActiveVaultClient,
  useTranscriptionGate,
} from "@/lib/vault/queries";
import { ensureNotesSchema } from "@/lib/vault/schema-ensure";
import type { Note } from "@/lib/vault/types";
import { useSync } from "@/providers/SyncProvider";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";

// Unified note-creation screen — replaces the prior split between `/new`
// (form-shaped text-only) and `/capture` (voice + transcript landing).
// Aaron's 2026-05-27 framing: "having New Note and Capture as two
// different surfaces is confusing — unify into one simplified interface
// that allows for folks to be specific but still keeps it simple."
//
// One screen:
//   - Title input at the top (visible — not behind a "More fields" toggle)
//   - Content area (CodeMirror)
//   - Tags row (chips + add)
//   - "Record" mic affordance — opens an inline recorder; on stop, audio
//     stages alongside any text the operator wrote. Saving with audio
//     present goes through the same sync-queue path as the old Capture
//     route (create-note + upload-attachment + link-attachment{transcribe})
//     so the scribe pipeline appends the transcript to the note body.
//
// Notably dropped:
//   - The standalone "Summary" field. Operators were ignoring it; the
//     metadata.summary key still exists at the vault level and can be set
//     via MCP / direct API — just not here. Saves one field of friction.
//   - Capture's background draft-save loop. `useCreateNote()` already
//     queues offline; manual save is the only commit path now.
//   - The "More fields" disclosure — Title is up front, Summary is gone,
//     no need to hide anything.

interface StagedUpload {
  path: string;
  mimeType: string;
  filename: string;
}

interface DraftState {
  content: string;
  path: string;
  tags: string[];
}

const EMPTY_DRAFT: DraftState = { content: "", path: "", tags: [] };

export function NoteNew() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const mutation = useCreateNote();
  const linkAttachment = useLinkAttachment();
  const qc = useQueryClient();
  const { db, blobStore, engine } = useSync();
  const { roles } = useTagRoles(activeVault?.id ?? null);
  const client = useActiveVaultClient();

  // Default the path to a `quickPath()` so the operator sees a real value
  // up front but can override (or clear) before save. Matches Capture's
  // path-gen behaviour (see notes#126) — we never silently fall back to
  // vault-auto-assign.
  const defaultPathRef = useRef(quickPath());
  // A4-SPEC §7: read once — see the identical comment in NoteEditor.tsx.
  const livePreviewOn = useRef(readStoredLivePreview()).current;
  // Pin the compose session's vault at MOUNT. The vault switcher lives in the
  // app header, so the active vault can change while this screen stays mounted;
  // keying the draft to the LIVE active vault would persist this session's text
  // under the newly-selected vault's `new` key (clobbering it) and later
  // resurrect it in that vault's compose. The draft belongs to the vault we
  // started composing in — full stop (notes#175 F1).
  const composeVaultId = useRef(activeVault?.id ?? null).current;
  // Restore a locally-persisted draft (crash / navigation protection, notes#175)
  // for THIS vault's compose session, if one exists. New notes have nothing to
  // conflict with, so we restore the text straight into the editor and surface a
  // dismissible "draft restored" banner rather than making the user opt in.
  const restoredAtRef = useRef<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(() => {
    if (composeVaultId) {
      const stored = loadDraft(composeVaultId, NEW_NOTE_SCOPE);
      if (stored) {
        restoredAtRef.current = stored.savedAt;
        return stored.body;
      }
    }
    return { ...EMPTY_DRAFT, path: defaultPathRef.current };
  });
  const [restoredAt, setRestoredAt] = useState<string | null>(() => restoredAtRef.current);
  const [tagInput, setTagInput] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedUpload[]>([]);
  const [isSavingAudio, setIsSavingAudio] = useState(false);
  const editorRef = useRef<CodeMirrorEditorHandle>(null);
  const attachmentPickerRef = useRef<AttachmentPickerHandle>(null);
  const voice = useVoiceCapture();
  // Voice-transcription capability gate (launch-audit P0-3). Hide the mic
  // ONLY when the vault EXPLICITLY declares transcription disabled —
  // recording would land "_Transcription unavailable._", which reads as
  // the product failing. Absent/undeclared (older self-host vaults) keeps
  // the mic exactly as today. Never yank the panel out from under an
  // in-flight capture (requesting/recording/have-audio) — the sub-second
  // race where the capability resolves after Record was pressed finishes
  // honestly instead of stranding armed audio behind a hidden panel.
  const transcriptionGate = useTranscriptionGate();
  const transcription = transcriptionGate.capability;
  const captureInFlight =
    voice.phase.kind === "requesting" ||
    voice.phase.kind === "recording" ||
    voice.phase.kind === "have-audio";
  const voiceGated = transcription?.enabled === false && !captureInFlight;

  // Minutes honesty (hosted door only — the capability carries
  // `minutes_remaining`; self-host has no such field and shows nothing new).
  // Near/at zero we tell the truth BEFORE recording: the mic stays available,
  // but the recording saves as audio-only and the save sends `transcribe:
  // false` so the server doesn't churn on a capture it can't transcribe.
  const minutesRemaining =
    typeof transcription?.minutes_remaining === "number"
      ? transcription.minutes_remaining
      : undefined;
  const outOfMinutes = minutesRemaining !== undefined && minutesRemaining <= 0;

  // Per-capture "Transcribe" toggle (voice W3). ONE policy, spoken once: a
  // capture either asks the vault to transcribe (the default, seeded from this
  // vault's Settings preference) or saves audio-only. The state is PER-CAPTURE
  // — it starts at the vault default and resets to it at the top of every fresh
  // capture (see the phase effect below), so a one-off "just the audio" never
  // leaks into the next recording. Persisted default lives client-local in
  // Settings (`transcribe-default.ts`) — the client owns capture-behavior policy
  // at attach time. Capability honesty: the control only renders when the vault
  // hasn't declared transcription disabled (`showTranscribeToggle`); when it IS
  // disabled the recorder is gated away entirely (voiceGated), so there's
  // nothing to toggle. When out of monthly minutes the toggle shows OFF+disabled
  // (Wave 2's audio-only truth already speaks — no double-messaging).
  const [transcribeThisCapture, setTranscribeThisCapture] = useState<boolean>(() =>
    composeVaultId ? loadTranscribeDefault(composeVaultId) : true,
  );
  const showTranscribeToggle = transcription?.enabled !== false;
  // Reset the per-capture toggle to the vault default whenever the recorder
  // returns to idle from an active/staged state (Discard, Cancel, restored-draft
  // discard). A successful save navigates away and remounts fresh, which resets
  // it the same way. A user's flip sticks for the current capture only.
  const prevVoicePhaseRef = useRef(voice.phase.kind);
  useEffect(() => {
    const prev = prevVoicePhaseRef.current;
    const now = voice.phase.kind;
    prevVoicePhaseRef.current = now;
    if (now === "idle" && prev !== "idle" && composeVaultId) {
      setTranscribeThisCapture(loadTranscribeDefault(composeVaultId));
    }
  }, [voice.phase.kind, composeVaultId]);

  // W2-9: the speed-dial's "Voice note" verb arrives as `/new?voice=1` —
  // land IN voice capture, no extra tap: auto-start the recorder once the
  // capability gate has an ANSWER. Waiting on `settled` (not just "not yet
  // false") matters: firing the mic during the pending window would record
  // toward "_Transcription unavailable._" on a disabled vault — the manual
  // race above is user-initiated and sub-second; an auto-start must not be.
  // In practice the vault-info answer rides a warm cache, so the wait is
  // invisible. The once-ref keeps StrictMode's dev double-invoke (and later
  // re-renders) from requesting the mic twice.
  const [searchParams] = useSearchParams();
  const voiceRequested = searchParams.has("voice");
  const autoVoiceFiredRef = useRef(false);
  useEffect(() => {
    if (!voiceRequested || autoVoiceFiredRef.current) return;
    if (!transcriptionGate.settled) return;
    if (transcriptionGate.capability?.enabled === false) return;
    autoVoiceFiredRef.current = true;
    void voice.startRecording();
  }, [
    voiceRequested,
    transcriptionGate.settled,
    transcriptionGate.capability,
    voice.startRecording,
  ]);

  const uploader = useAttachmentUploader({
    noteId: null,
    onInsert: (md) => {
      if (editorRef.current) {
        editorRef.current.insertAtCursor(md);
      } else {
        setDraft((d) => ({ ...d, content: `${d.content}${md}` }));
      }
    },
    onStaged: (s) => setStaged((prev) => [...prev, s]),
    onError: (msg) => pushToast(msg, "error"),
  });

  // Capture-chip loosening (2026-07-17, ratified): the capture role tag now
  // pre-populates as a VISIBLE, REMOVABLE chip in the tag row instead of an
  // invisible save-time injection — buildTextNotePayload takes `tags` as
  // given. Sync the role tag into `draft.tags` until the operator explicitly
  // adds or removes a chip THIS compose session (`tagsTouchedRef`); once
  // touched, their chip set is authoritative — we never re-inject, even if
  // tag-role settings resolve to a different name underneath (the default
  // resolves synchronously, but a custom mapping can arrive a beat later once
  // the settings note loads). `autoTagRef` remembers which value we last
  // auto-added so a role-name change swaps it instead of leaving both names
  // in the chip row.
  //
  // Review fold (#49): the freeze must survive a REMOUNT, not just live out
  // one mount's lifetime — VaultSurface remounts this screen during ordinary
  // browsing, and a stored draft already reflects whatever the operator left
  // in the chip row (including a deliberate removal). Seed the guard from
  // `restoredAtRef` (set above, in the SAME initial render, whenever a stored
  // draft was found) so a restored draft's tags are authoritative from the
  // very first effect pass — never auto-repopulated on return.
  const tagsTouchedRef = useRef(restoredAtRef.current !== null);
  const autoTagRef = useRef<string | null>(null);
  useEffect(() => {
    if (tagsTouchedRef.current) return;
    setDraft((d) => {
      const withoutPriorAuto = autoTagRef.current
        ? d.tags.filter((t) => t !== autoTagRef.current)
        : d.tags;
      const next = withoutPriorAuto.includes(roles.captureText)
        ? withoutPriorAuto
        : [...withoutPriorAuto, roles.captureText];
      return next === d.tags ? d : { ...d, tags: next };
    });
    autoTagRef.current = roles.captureText;
  }, [roles.captureText]);

  // Persist the text draft (content/path/tags — not audio blobs) whenever
  // there's something worth keeping. Cleared on save or explicit discard. The
  // sole auto-populated capture chip doesn't count as "something worth
  // keeping" on its own — an untouched compose (nothing typed, tags exactly
  // the auto-default) must stay byte-identical to pre-chip behavior and not
  // litter the draft store.
  const tagsArePristineDefault =
    !tagsTouchedRef.current &&
    (draft.tags.length === 0 || (draft.tags.length === 1 && draft.tags[0] === roles.captureText));
  const persistableDirty =
    draft.content.trim().length > 0 ||
    !tagsArePristineDefault ||
    (draft.path.trim().length > 0 && draft.path !== defaultPathRef.current);
  useDraftAutosave(composeVaultId, NEW_NOTE_SCOPE, draft, persistableDirty);

  if (!activeVault) return <Navigate to="/" replace />;

  const hasAudio = voice.phase.kind === "have-audio";
  const hasText = draft.content.trim().length > 0;

  // Same pristine-tags carve-out as `persistableDirty` above: the sole
  // auto-populated capture chip must not itself trip the leave-guard or the
  // Cancel confirm on a compose the operator never touched.
  const isDirty =
    draft.content.length > 0 ||
    draft.path !== defaultPathRef.current ||
    !tagsArePristineDefault ||
    hasAudio;

  // Text-only mode requires path + content. Audio satisfies the "body" half
  // because the transcript will land there; path still required so the
  // operator always sees what they're writing.
  const isValid = draft.path.trim().length > 0 && (hasText || hasAudio);
  const pending = mutation.isPending || isSavingAudio;

  // ---- text-only save ------------------------------------------------------
  // A typed note through this surface carries whatever's in the tag row
  // (chips are the source of truth — the capture role tag pre-populates
  // there, above, but a chip the operator removed does NOT come back here)
  // + `metadata.source: "text"` so the how-it-arrived axis lives in metadata,
  // not tag identity (2026-07 one-tag simplification). The payload assembly
  // is shared with Home's composer (W2-10) — `buildTextNotePayload` is the
  // one place it happens.
  const saveTextOnly = useCallback(() => {
    if (!isValid || pending) return;
    const payload = buildTextNotePayload({
      content: draft.content,
      path: draft.path,
      tags: draft.tags,
    });

    // Fire-and-forget schema ensure — creates the `capture` tag row if the
    // vault doesn't have it yet. Never blocks the save; vault accepts notes
    // with unwritten tag-identity rows.
    if (client) {
      void ensureNotesSchema(activeVault.id, client);
    }

    setSaveError(null);
    mutation.mutate(payload, {
      onSuccess: async (created: Note) => {
        for (const s of staged) {
          try {
            await linkAttachment.mutateAsync({
              noteId: created.id,
              path: s.path,
              mimeType: s.mimeType,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Link failed";
            pushToast(`Failed to attach ${s.filename}: ${msg}`, "error");
          }
        }
        if (composeVaultId) clearDraft(composeVaultId, NEW_NOTE_SCOPE);
        pushToast(`Created ${created.path ?? created.id}`, "success");
        // NAVIGATION.md: "NoteNew save → /n/<id>" — (b) consumes the compose
        // form; replace (Back to a cleared, ghost draft would lie).
        navigate(`/n/${encodeURIComponent(created.id)}`, { replace: true });
      },
      onError: (err) => {
        if (err instanceof VaultAuthError) {
          setSaveError("Session expired. Reconnect to save.");
        } else {
          // Vault returns 500 with "Internal server error" on duplicate paths;
          // surface whatever message we got so the user can adjust the path.
          setSaveError(
            err instanceof Error
              ? `${err.message} — if the path is taken, try a different one.`
              : "Create failed",
          );
        }
      },
    });
  }, [
    activeVault,
    composeVaultId,
    client,
    draft,
    isValid,
    linkAttachment,
    mutation,
    navigate,
    pending,
    pushToast,
    staged,
  ]);

  // ---- audio save ----------------------------------------------------------
  // Mirrors Capture's audio path: enqueue create-note + upload-attachment +
  // link-attachment{transcribe:true} so the scribe pipeline appends the
  // transcript to the body once it's processed. Goes through the sync queue
  // (not useCreateNote) because audio blobs are big enough that the
  // blob-store is the right place for them, and the queue handles retry on
  // its own.
  const saveWithAudio = useCallback(async () => {
    if (!isValid || pending) return;
    if (voice.phase.kind !== "have-audio") return;
    if (!db || !blobStore) {
      pushToast("Sync queue not ready — try again in a moment.", "error");
      return;
    }
    setSaveError(null);
    const audio = voice.phase;
    const segments = audio.segments;
    const mimeType = audio.mimeType;
    const path = draft.path.trim();
    const explicit = draft.tags;
    const extracted = extractHashtags(draft.content);
    // Audio present → this is a voice capture (`metadata.source: "voice"`,
    // below). The voice role tag (default `capture`) rides along; when the
    // operator also typed text, the text role tag joins it — a no-op under
    // the defaults (both roles point at `capture`, de-duped), but it keeps
    // custom role mappings honest.
    const finalTags = Array.from(
      new Set([roles.captureVoice, ...explicit, ...extracted].filter((t) => t.length > 0)),
    );
    if (hasText) finalTags.push(roles.captureText);
    // de-dupe again after the conditional push so the role tag isn't duplicated.
    const tags = Array.from(new Set(finalTags));

    // Segmentation: a long recording rolled into several standalone audio
    // segments (see `segmented-recorder`). `buildVoiceCapturePlan` owns the
    // body + per-segment upload/link shape — the COMMON single-segment case
    // stays byte-identical, N>1 pre-seeds per-part markers + carries
    // `segment_index`, and out-of-minutes drops both (audio-only). Out of
    // monthly transcription minutes → `transcribe: false` so the server
    // doesn't churn on a capture it can't transcribe.
    const recordedAt = new Date();
    const localId = newLocalId();
    // The per-capture toggle is the policy: transcribe unless the user turned it
    // off for this capture, or there are no minutes to transcribe with. Either
    // OFF path drops the pending markers + segment_index and sends
    // `transcribe:false` (audio-only) via `buildVoiceCapturePlan`.
    const willTranscribe = !outOfMinutes && transcribeThisCapture;
    const plan = buildVoiceCapturePlan({
      segments,
      mimeType,
      typedText: draft.content,
      recordedAt,
      willTranscribe,
    });

    // Size validation — the SAME guard every other upload uses, run per
    // segment. Segments are small (~30 min of 32kbps opus each, ~6.9MB), so
    // this is a safety net, not a limit; a failure aborts the whole save
    // rather than enqueuing a partial capture.
    for (let k = 0; k < segments.length; k++) {
      const reason = validateFile(
        new File([segments[k]!.data], plan.segments[k]!.filename, { type: mimeType }),
      );
      if (reason) {
        pushToast(reason, "error");
        setSaveError(reason);
        return;
      }
    }

    setIsSavingAudio(true);

    // Fire-and-forget schema ensure — creates the `capture` tag row if the
    // vault doesn't have it yet. Vault accepts notes with unwritten
    // tag-identity rows, so we don't await.
    if (client) {
      void ensureNotesSchema(activeVault.id, client);
    }

    // Built once so the enqueued create-note row and the optimistic cache
    // seed below stay in lockstep.
    const createPayload: CreateNotePayload = {
      content: plan.body,
      path,
      metadata: { source: "voice" },
      ...(tags.length ? { tags } : {}),
    };

    try {
      await enqueue(
        db,
        { kind: "create-note", localId, payload: createPayload },
        { vaultId: activeVault.id },
      );
      // One upload + link pair per segment, in order. Each link references its
      // own blob and (for N>1) carries the numeric `segment_index` the door
      // contract keys per-part markers on.
      for (let k = 0; k < plan.segments.length; k++) {
        const seg = plan.segments[k]!;
        const blobId = newBlobId();
        await blobStore.put(blobId, segments[k]!.data, mimeType, activeVault.id);
        await enqueue(
          db,
          { kind: "upload-attachment", blobId, filename: seg.filename, mimeType },
          { vaultId: activeVault.id },
        );
        await enqueue(
          db,
          {
            kind: "link-attachment",
            noteId: localId,
            pathRef: blobRef(blobId),
            mimeType,
            transcribe: seg.transcribe,
            ...(seg.segment_index !== undefined ? { segment_index: seg.segment_index } : {}),
          },
          { vaultId: activeVault.id },
        );
      }
      void engine?.runOnce();
      // Seed the optimistic note so navigating to /n/<localId> lands on a
      // readable page instead of a 404 (getNote(localId) has no server row
      // yet). Mirrors the text path's useCreateNote onSuccess cache-seed;
      // useNote resolves the local id via the id-map once the row drains.
      qc.setQueryData(
        ["note", activeVault.id, localId],
        optimisticCreatedNote(createPayload, localId),
      );
      if (composeVaultId) clearDraft(composeVaultId, NEW_NOTE_SCOPE);
      pushToast("Captured — syncing audio.", "success");
      voice.discardAudio();
      // NAVIGATION.md: "NoteNew save → /n/<id>" — (b) consumes the compose
      // form; replace (Back to a cleared, ghost draft would lie).
      navigate(`/n/${encodeURIComponent(localId)}`, { replace: true });
    } catch (e) {
      pushToast(e instanceof Error ? `Capture failed: ${e.message}` : "Capture failed.", "error");
      setSaveError(e instanceof Error ? e.message : "Capture failed");
    } finally {
      setIsSavingAudio(false);
    }
  }, [
    activeVault,
    composeVaultId,
    blobStore,
    client,
    db,
    draft,
    engine,
    hasText,
    isValid,
    navigate,
    outOfMinutes,
    pending,
    pushToast,
    qc,
    roles.captureText,
    roles.captureVoice,
    transcribeThisCapture,
    voice,
  ]);

  const handleSave = useCallback(() => {
    if (hasAudio) void saveWithAudio();
    else saveTextOnly();
  }, [hasAudio, saveTextOnly, saveWithAudio]);

  const handleCancel = useCallback(() => {
    if (isDirty && !confirm("Discard this draft?")) return;
    if (composeVaultId) clearDraft(composeVaultId, NEW_NOTE_SCOPE);
    voice.discardAudio();
    navigate("/");
  }, [composeVaultId, isDirty, navigate, voice]);

  // The "draft restored" banner's discard: wipe the saved draft AND reset the
  // compose surface to a fresh, empty note — including a fresh capture chip
  // (this instance stays mounted, so the auto-populate effect above won't
  // re-fire on its own; reseed it explicitly and un-freeze the touched guard).
  const discardRestoredDraft = useCallback(() => {
    if (composeVaultId) clearDraft(composeVaultId, NEW_NOTE_SCOPE);
    tagsTouchedRef.current = false;
    autoTagRef.current = roles.captureText;
    setDraft({ ...EMPTY_DRAFT, path: defaultPathRef.current, tags: [roles.captureText] });
    voice.discardAudio();
    setRestoredAt(null);
  }, [composeVaultId, voice, roles.captureText]);

  // Page-leave guard. Don't pop on save-success (when we navigate
  // programmatically, isDirty drops because state was just cleared).
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const addTag = (raw: string) => {
    const t = normalizeTag(raw);
    if (!t || draft.tags.includes(t)) return;
    tagsTouchedRef.current = true;
    setDraft((d) => ({ ...d, tags: [...d.tags, t] }));
    setTagInput("");
  };
  const removeTag = (name: string) => {
    // Freezes the auto-populate effect above — a deliberate removal (of the
    // capture chip or any other) is never re-added underneath the operator.
    tagsTouchedRef.current = true;
    setDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== name) }));
  };

  const resolver = buildWikilinkResolver({
    id: "__new__",
    createdAt: new Date().toISOString(),
  } as Note);

  return (
    <div className="page">
      <nav className="mb-6 text-sm text-fg-dim">
        <Link to="/notes" className="hover:text-accent">
          ← All notes
        </Link>
      </nav>

      <article>
        {/* The composer, opened. Same warm card + coral focus-bloom as Home's
            "What's on your mind?" — this screen IS that composer, expanded. */}
        <header className="composer mb-6 p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="eyebrow">New note</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleCancel} className="btn btn-secondary btn-touch">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!isValid || pending}
                className="btn btn-primary btn-touch"
                title="Create (⌘S)"
              >
                {pending ? "Creating…" : "Create"}
              </button>
            </div>
          </div>

          <input
            type="text"
            value={draft.path}
            onChange={(e) => setDraft((d) => ({ ...d, path: e.target.value }))}
            // UI-audit finding #4a: this field's VALUE is the auto-generated
            // date path ("Notes/2026/07-16/22-10-48"), not a placeholder —
            // so it was rendering at full display-heading scale, reading as
            // a headline rather than a suggestion. While it's still the
            // untouched default, style it small/muted (a hint the operator
            // can accept or overwrite); once they've typed their own title
            // it earns the normal serif/display treatment. The generated
            // value itself, and where it's stored, are unchanged.
            className={
              draft.path === defaultPathRef.current
                ? "mt-4 w-full border-0 bg-transparent font-sans text-sm text-fg-dim outline-none placeholder:text-fg-dim"
                : "mt-4 w-full border-0 bg-transparent font-serif text-2xl text-fg outline-none placeholder:text-fg-dim md:text-3xl"
            }
            aria-label="Note path"
            placeholder="Name your note — or just start writing"
          />

          <div className="mt-4">
            <TagEditor
              tags={draft.tags}
              input={tagInput}
              onInputChange={setTagInput}
              onAdd={addTag}
              onRemove={removeTag}
            />
          </div>
        </header>

        {restoredAt ? (
          // biome-ignore lint/a11y/useSemanticElements: role=status on a div — the banner holds a flex row of buttons (flow content) that <output>'s phrasing-only model disallows.
          <div
            role="status"
            data-testid="draft-restored"
            className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-sm"
          >
            <span className="text-fg-muted">
              Unsaved draft restored from {relativeTime(restoredAt)}.
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={discardRestoredDraft}
                className="text-fg-dim hover:text-danger"
              >
                Discard draft
              </button>
              <button
                type="button"
                onClick={() => setRestoredAt(null)}
                aria-label="Dismiss draft-restored notice"
                className="text-fg-dim hover:text-accent"
              >
                ✕
              </button>
            </div>
          </div>
        ) : null}

        {saveError ? (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-danger-border bg-danger-soft p-3 text-sm text-danger"
          >
            {saveError}
          </div>
        ) : null}

        {voiceGated ? (
          <VoiceUnavailableNote capability={transcription} />
        ) : (
          <>
            <VoicePanel
              voice={voice}
              minutesRemaining={minutesRemaining}
              outOfMinutes={outOfMinutes}
              transcribe={transcribeThisCapture}
              onTranscribeChange={setTranscribeThisCapture}
              showTranscribeToggle={showTranscribeToggle}
            />
            <RetentionChoice vaultId={activeVault.id} captureEngaged={captureInFlight} />
          </>
        )}

        {/* DEFINITE editor-pane height — see NoteEditor.tsx for the full why.
            `scrollPastEnd()` runs away in a content-sized editor (padding-bottom
            feeds back on the scroller's own clientHeight → multi-second freeze
            on a long note); `h-[60dvh] min-h-0` bounds the pane so `.cm-scroller`
            is the real, content-independent scroll container. The EDITOR pane is
            bounded on every viewport (the freeze must be fixed on mobile too);
            the PREVIEW pane only binds at `lg` — unlike NoteEditor it has no
            mobile pane-toggle, so on a phone the two panes STACK, and a second
            fixed-height box there would just be dead space above Attachments. */}
        <div className={`grid min-h-[60dvh] gap-4 ${livePreviewOn ? "" : "lg:grid-cols-2"}`}>
          <AttachmentDropZone
            onDropFiles={uploader.start}
            className="card min-h-0 h-[60dvh] min-w-0"
            hint="Images, audio, webm video"
          >
            <CodeMirrorEditor
              ref={editorRef}
              value={draft.content}
              onChange={(content) => setDraft((d) => ({ ...d, content }))}
              onSave={handleSave}
              onCancel={handleCancel}
              // UI-audit finding #4b: a blank canvas with no cue read as
              // unstyled/broken rather than "empty, ready to type."
              placeholder="Start writing…"
              onPasteFile={(files) => {
                uploader.start(files);
                return true;
              }}
              // The "/"-menu's Image/attachment command reuses the
              // Attachments section's own picker below, rather than a
              // second upload path.
              onRequestAttachment={() => attachmentPickerRef.current?.open()}
              livePreview={livePreviewOn}
            />
          </AttachmentDropZone>
          {livePreviewOn ? null : (
            <div className="card min-w-0 overflow-auto p-4 lg:h-[60dvh] lg:min-h-0">
              {draft.content.trim() ? (
                <NoteRenderer
                  note={{ path: draft.path, content: draft.content }}
                  resolve={resolver}
                />
              ) : (
                <p className="text-sm text-fg-dim">Preview appears here as you type.</p>
              )}
            </div>
          )}
        </div>

        <section className="mt-6 border-t border-border pt-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-xl">Attachments</h2>
            <AttachmentPicker ref={attachmentPickerRef} onPickFiles={uploader.start} />
          </div>
          <p className="mb-3 text-xs text-fg-dim">
            Drop or paste files into the editor. Attachments link to the note when you save. Max 100
            MB each. Images, audio, webm video.{" "}
            <a
              href="https://github.com/ParachuteComputer/parachute-vault/issues/127"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              PDF + mp4 coming
            </a>
            .
          </p>
          <AttachmentUploadList
            uploads={uploader.uploads}
            onCancel={uploader.cancel}
            onDismiss={uploader.dismiss}
          />
          {staged.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {staged.map((s) => (
                <li
                  key={s.path}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card/50 px-3 py-1.5 font-mono text-xs text-fg-muted"
                >
                  <span className="truncate">{s.filename}</span>
                  <span className="shrink-0 text-fg-dim">staged</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </article>
    </div>
  );
}

// First-voice-capture retention choice (voice-retention transparency).
// The first time a user records in a vault whose `audio_retention` has
// never been explicitly chosen, offer a one-time inline choice near the
// recorder: keep the audio, or keep just the words. Selection PATCHes the
// vault config (`config.audio_retention`, same contract on both doors) and
// records the choice per-vault in localStorage so it never re-renders once
// answered. Never blocks a capture:
//   - it renders only alongside the recorder (the #167 capability gate
//     already decided the mic renders), and only once the mic is engaged;
//   - a failed PATCH shows one quiet line, the capture proceeds under the
//     server default (keep), and the choice re-offers next time;
//   - it's not offered at all when the vault predates the dial (`config`
//     absent on /api/vault — a PATCH there would silently no-op) or when
//     someone already dialed it away from the default via another door.
// Reads ride the SAME cached /api/vault response as `useVaultInfo` — no
// new network call per render.
function RetentionChoice({
  vaultId,
  captureEngaged,
}: {
  vaultId: string;
  captureEngaged: boolean;
}) {
  const retention = useAudioRetention();
  const setRetention = useSetAudioRetention();
  const { made, markMade } = useRetentionChoiceMade(vaultId);
  const [error, setError] = useState<string | null>(null);

  const show = captureEngaged && !made && retention.supported && retention.value === "keep";
  if (!show) return null;

  const choose = (value: "keep" | "until_transcribed") => {
    setError(null);
    setRetention.mutate(value, {
      onSuccess: () => markMade(),
      onError: () =>
        setError(
          "Couldn't save that choice — this recording is kept (the vault default). We'll ask again next time; you can also set it in Settings.",
        ),
    });
  };

  return (
    <div
      data-testid="retention-choice"
      className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-card/60 p-3"
    >
      <p className="text-xs text-fg-muted">
        First voice note here — should this vault keep your audio files after transcribing?
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => choose("keep")}
          disabled={setRetention.isPending}
          className="btn btn-secondary btn-touch"
        >
          Keep my recordings
        </button>
        <button
          type="button"
          onClick={() => choose("until_transcribed")}
          disabled={setRetention.isPending}
          className="btn btn-secondary btn-touch"
        >
          Just keep the words
        </button>
        <span className="text-xs text-fg-dim">(audio deleted after transcribing)</span>
      </div>
      <p className="text-xs text-fg-dim">
        Either way your capture saves now. Change this anytime in Settings.
      </p>
      {error ? (
        <p className="text-xs text-danger" data-testid="retention-choice-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// Inline voice affordance. Sits above the editor so the operator sees it
// at a glance — Aaron's "voice-capture affordance at the top of the content
// area." Idle: a single "Record" button. Recording: live elapsed + a "Stop"
// button (tap-toggle — tap Record to start, tap Stop to finish).
// Below this many transcription minutes, we surface the quiet remaining-minutes
// line near the mic (hosted door only). At/under zero the copy flips to the
// audio-only truth.
const LOW_MINUTES_THRESHOLD = 30;

// Per-capture "Transcribe" switch (voice W3). Sits with the record controls;
// ON asks the vault to transcribe (default), OFF saves audio-only. Forced
// OFF+disabled when out of minutes (Wave 2 already speaks the audio-only truth,
// so the switch stays quiet — no double-messaging). Mirrors Settings' "Live
// preview" switch chrome for a consistent affordance.
function TranscribeToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex basis-full items-center justify-between gap-3">
      <span className="text-xs text-fg-dim">Transcribe this recording</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label="Transcribe this recording"
        data-testid="transcribe-toggle"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
          checked ? "bg-accent" : "bg-border"
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-card shadow-sm transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

// Have-audio: preview + discard. Denied: error message inline.
function VoicePanel({
  voice,
  minutesRemaining,
  outOfMinutes,
  transcribe,
  onTranscribeChange,
  showTranscribeToggle,
}: {
  voice: ReturnType<typeof useVoiceCapture>;
  minutesRemaining?: number;
  outOfMinutes: boolean;
  transcribe: boolean;
  onTranscribeChange: (next: boolean) => void;
  showTranscribeToggle: boolean;
}) {
  const { phase, elapsedMs, parts, startRecording, stopRecording, discardAudio } = voice;
  const isRecording = phase.kind === "recording";
  const isRequesting = phase.kind === "requesting";
  // Effective policy for THIS capture: transcribe unless the user turned it off
  // or there are no minutes. The switch shows this (out-of-minutes reads OFF).
  const willTranscribe = !outOfMinutes && transcribe;
  // Only surface a minutes line on the hosted door (metered capability) and
  // only once it's actually low — self-host (no `minutesRemaining`) shows
  // nothing new.
  const showMinutesLine =
    typeof minutesRemaining === "number" && minutesRemaining <= LOW_MINUTES_THRESHOLD;

  if (phase.kind === "have-audio") {
    return (
      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent/5 p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-fg-muted">
            🎙 Recorded {formatElapsed(phase.durationMs)}
            {phase.segments.length > 1 ? ` · ${phase.segments.length} parts` : ""}
          </span>
          <button
            type="button"
            onClick={discardAudio}
            className="text-xs text-fg-dim hover:text-danger"
          >
            Discard
          </button>
        </div>
        <audio controls src={phase.url} className="w-full">
          <track kind="captions" />
        </audio>
        {showTranscribeToggle ? (
          <TranscribeToggle
            checked={willTranscribe}
            disabled={outOfMinutes}
            onChange={onTranscribeChange}
          />
        ) : null}
        <p className="text-xs text-fg-dim">
          {outOfMinutes
            ? "Saved as audio-only — you're out of transcription minutes this month."
            : willTranscribe
              ? "Transcript will be appended once your vault processes it. Save to commit."
              : "Saved as audio-only — transcription is off for this recording."}
        </p>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/60 p-3">
      <div className="text-xs text-fg-dim">
        {isRecording
          ? parts > 1
            ? `Recording — tap Stop to finish. (part ${parts})`
            : "Recording — tap Stop to finish."
          : isRequesting
            ? "Requesting microphone…"
            : outOfMinutes
              ? "You're out of transcription minutes this month — this saves as audio-only."
              : willTranscribe
                ? "Add a voice memo to this note. Audio gets transcribed and appended."
                : "Add a voice memo to this note. Saved as audio-only — transcription is off for this recording."}
      </div>
      {isRecording ? (
        <button
          type="button"
          // TAP-TOGGLE: onClick only — works for touch, mouse, AND keyboard.
          // A previous onPointerDown+onClick pair double-fired across the
          // Record↔Stop button swap (pointerdown started, the same tap's click
          // hit the swapped Stop button) → instant 0-second stop.
          onClick={() => void stopRecording()}
          aria-label={`Recording — ${formatElapsed(elapsedMs)} — stop`}
          aria-pressed="true"
          className="flex min-h-11 items-center gap-2 rounded-full border border-danger-border bg-danger-soft px-4 py-2 text-sm font-medium text-danger"
        >
          <span aria-hidden="true" className="animate-pulse">
            🎙
          </span>
          <span>Stop {formatElapsed(elapsedMs)}</span>
        </button>
      ) : (
        <button
          type="button"
          // TAP-TOGGLE: onClick only (see the Stop button + use-voice-capture.ts).
          onClick={() => void startRecording()}
          aria-label="Record voice memo"
          disabled={isRequesting}
          className="flex min-h-11 items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/15 disabled:opacity-40"
        >
          <span aria-hidden="true">🎙</span>
          <span>{isRequesting ? "Requesting…" : "Record"}</span>
        </button>
      )}
      {showTranscribeToggle ? (
        <TranscribeToggle
          checked={willTranscribe}
          disabled={outOfMinutes}
          onChange={onTranscribeChange}
        />
      ) : null}
      {showMinutesLine && !outOfMinutes ? (
        <p className="basis-full text-xs text-fg-dim" data-testid="voice-minutes-left">
          About {Math.round(minutesRemaining as number)} min of transcription left this month.
        </p>
      ) : null}
      {phase.kind === "denied" ? (
        <p className="basis-full rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-xs text-danger">
          {phase.message}
        </p>
      ) : null}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
