import { AttachmentDropZone } from "@/components/AttachmentDropZone";
import { AttachmentPicker, type AttachmentPickerHandle } from "@/components/AttachmentPicker";
import { AttachmentUploadList } from "@/components/AttachmentUploadList";
import type { CodeMirrorEditorHandle } from "@/components/CodeMirrorEditor";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { DeleteNoteButton } from "@/components/DeleteNoteButton";
import { buildWikilinkResolver } from "@/components/MarkdownView";
import { IconExpand } from "@/components/NavIcons";
import { NoteRenderer } from "@/components/NoteRenderer";
import { PinArchiveButtons } from "@/components/PinArchiveButtons";
import { RemoveAttachmentButton } from "@/components/RemoveAttachmentButton";
import { TagEditor, normalizeTag } from "@/components/TagEditor";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useAttachmentUploader } from "@/components/useAttachmentUploader";
import { type StoredDraft, bodyEquals, clearDraft, loadDraft } from "@/lib/drafts/store";
import { useDraftAutosave } from "@/lib/drafts/use-draft-autosave";
import { readStoredLivePreview } from "@/lib/editor-mode";
import { useFocusMode } from "@/lib/focus-mode";
import { relativeTime } from "@/lib/time";
import { useToastStore } from "@/lib/toast/store";
import { useNote, useUpdateNote, useVaultStore } from "@/lib/vault";
import { type UpdateNotePayload, VaultAuthError, VaultConflictError } from "@/lib/vault/client";
import type { Note, NoteAttachment } from "@/lib/vault/types";
import { isDefaultViewPath } from "@/lib/views/defaults";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";

export function NoteEditor() {
  // `:id` arrives ALREADY decoded (the router decodes params); a second
  // decodeURIComponent threw on ids with a literal `%` — see TagPage.tsx
  // for the full framing. Decode once, at the boundary. (app#113)
  const { id: decodedId } = useParams<{ id: string }>();
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const note = useNote(decodedId);

  // NAVIGATION.md: route guard, no active vault — replace.
  if (!activeVault) return <Navigate to="/" replace />;

  return (
    <div className="page">
      <nav className="mb-6 text-sm text-fg-dim">
        <Link
          to={decodedId ? `/n/${encodeURIComponent(decodedId)}` : "/"}
          className="focus-ring hover:text-accent"
        >
          ← Back to note
        </Link>
      </nav>
      {note.isPending ? (
        <EditorSkeleton />
      ) : note.isError ? (
        <ErrorBlock error={note.error} />
      ) : !note.data ? (
        <NotFoundBlock id={decodedId ?? ""} />
      ) : (
        <EditorSurface note={note.data} />
      )}
    </div>
  );
}

interface EditorState {
  content: string;
  path: string;
  tags: string[];
}

function toEditorState(note: Note): EditorState {
  return {
    content: note.content ?? "",
    path: note.path ?? "",
    tags: [...(note.tags ?? [])],
  };
}

type EditorPane = "edit" | "preview";

function EditorSurface({ note }: { note: Note }) {
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const focusOn = useFocusMode((s) => s.on);
  const setFocusOn = useFocusMode((s) => s.setOn);
  // Pin the note's vault at MOUNT. The header vault switcher can change the
  // active vault mid-edit; keying the draft to the live active vault would move
  // this note's draft under a different vault's key. The draft belongs to the
  // vault the note lives in (notes#175 F1).
  const vaultId = useRef(useVaultStore.getState().activeVaultId).current;
  // A4-SPEC §7: read once — the editor builds its extension set once per
  // mount, and Settings changing this pref takes effect on the NEXT note
  // opened (a runtime kill-switch, not a live Compartment swap).
  const livePreviewOn = useRef(readStoredLivePreview()).current;
  const resolver = useMemo(() => buildWikilinkResolver(note), [note]);
  const [baseline, setBaseline] = useState<EditorState>(() => toEditorState(note));
  const [draft, setDraft] = useState<EditorState>(() => toEditorState(note));
  // A locally-persisted draft (notes#175) may hold edits from a prior session
  // that never reached the server. For an EXISTING note the server copy is
  // authoritative, so we don't silently overwrite it — we OFFER to restore only
  // when the draft actually differs from the server note.
  const [offeredDraft, setOfferedDraft] = useState<StoredDraft | null>(() => {
    if (!vaultId) return null;
    const stored = loadDraft(vaultId, note.id);
    if (!stored || bodyEquals(stored.body, toEditorState(note))) return null;
    return stored;
  });
  const [tagInput, setTagInput] = useState("");
  const [conflict, setConflict] = useState<VaultConflictError | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The checkpoint-save whisper (⌘S): "Saved ✓" for a beat, then it settles
  // back to the relative-time label. No spinner, no toast — a quiet
  // acknowledgment that doesn't interrupt typing.
  const [justSaved, setJustSaved] = useState(false);
  const savedWhisperTimeout = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (savedWhisperTimeout.current !== null) window.clearTimeout(savedWhisperTimeout.current);
    };
  }, []);
  // Mobile-only pane toggle. Desktop renders both side-by-side and ignores it.
  const [mobilePane, setMobilePane] = useState<EditorPane>("edit");
  const mutation = useUpdateNote(note.id);
  const lastServerNote = useRef<Note>(note);
  const editorRef = useRef<CodeMirrorEditorHandle>(null);
  const attachmentPickerRef = useRef<AttachmentPickerHandle>(null);

  const uploader = useAttachmentUploader({
    noteId: note.id,
    onInsert: (md) => {
      if (editorRef.current) {
        editorRef.current.insertAtCursor(md);
      } else {
        setDraft((d) => ({ ...d, content: `${d.content}${md}` }));
      }
    },
    onLinked: () => {
      pushToast("Attachment added", "success");
    },
    onError: (msg) => pushToast(msg, "error"),
  });

  // If the server-side note is refetched (e.g., after a background refresh),
  // only update baseline if the user has no in-flight changes.
  useEffect(() => {
    lastServerNote.current = note;
  }, [note]);

  const isDirty =
    draft.content !== baseline.content ||
    draft.path !== baseline.path ||
    !setEquals(draft.tags, baseline.tags);

  // Persist the draft locally while there are unsaved edits (crash / navigation
  // protection). Clears itself when clean; explicitly cleared on save/discard.
  useDraftAutosave(vaultId, note.id, draft, isDirty);

  // Block saving while an attachment is still uploading (or linking). The
  // embed markdown only lands in `draft.content` once the upload resolves
  // (uploader.onInsert); saving before that — especially the Save button,
  // which then unmounts this editor — would drop the embed on the floor.
  const uploadsActive = uploader.uploads.some(
    (u) => u.status === "uploading" || u.status === "linking",
  );

  // Two save shapes on purpose:
  //   - the Save BUTTON commits and returns to the read view (finish editing);
  //   - ⌘S / CodeMirror's onSave is a checkpoint save that STAYS in the editor
  //     (writer muscle memory — save often, keep typing).
  const saveNote = useCallback(
    ({ navigateToView }: { navigateToView: boolean }) => {
      if (!isDirty || mutation.isPending || uploadsActive) return;
      const payload: UpdateNotePayload = {};
      if (draft.content !== baseline.content) payload.content = draft.content;
      if (draft.path !== baseline.path) payload.path = draft.path;
      const tagDiff = diffTags(baseline.tags, draft.tags);
      if (tagDiff.add.length || tagDiff.remove.length) payload.tags = tagDiff;

      // Optimistic concurrency: always send the last-known updatedAt (fall back
      // to createdAt for never-edited notes). A stale value surfaces 409 so we
      // can prompt the user to reload rather than silently clobbering a
      // concurrent write from another client.
      const ifUpdatedAt = lastServerNote.current.updatedAt ?? lastServerNote.current.createdAt;
      if (ifUpdatedAt) payload.if_updated_at = ifUpdatedAt;

      setSaveError(null);
      setConflict(null);
      mutation.mutate(payload, {
        onSuccess: (updated) => {
          setBaseline(toEditorState(updated));
          setDraft(toEditorState(updated));
          lastServerNote.current = updated;
          // The edits are now on the server — drop the local draft so it can't
          // later masquerade as unsaved work.
          if (vaultId) clearDraft(vaultId, note.id);
          if (navigateToView) {
            // Finish editing: return to the note's read view. `replace` keeps
            // "back" from dropping the user into the editor they just left.
            // The id may have changed if a path edit moved the note.
            // NAVIGATION.md: same "consumes the compose form" shape as
            // NoteNew's save — replace.
            navigate(`/n/${encodeURIComponent(updated.id)}`, { replace: true });
          } else if (updated.id !== note.id) {
            // Checkpoint save that stays put — but if a path edit renamed the
            // note (new id), follow it so the editor URL stays valid.
            navigate(`/n/${encodeURIComponent(updated.id)}/edit`, { replace: true });
          }
          if (!navigateToView) {
            setJustSaved(true);
            if (savedWhisperTimeout.current !== null) {
              window.clearTimeout(savedWhisperTimeout.current);
            }
            savedWhisperTimeout.current = window.setTimeout(() => setJustSaved(false), 1500);
          }
        },
        onError: (err) => {
          if (err instanceof VaultConflictError) setConflict(err);
          else if (err instanceof VaultAuthError)
            setSaveError("Session expired. Reconnect to save.");
          else setSaveError(err instanceof Error ? err.message : "Save failed");
        },
      });
    },
    [baseline, draft, isDirty, mutation, navigate, note.id, uploadsActive, vaultId],
  );

  // Restore the offered draft into the editor, or discard it.
  const restoreDraft = useCallback(() => {
    if (offeredDraft) setDraft(offeredDraft.body);
    setOfferedDraft(null);
  }, [offeredDraft]);
  const discardOfferedDraft = useCallback(() => {
    if (vaultId) clearDraft(vaultId, note.id);
    setOfferedDraft(null);
  }, [vaultId, note.id]);

  // Save button → commit and leave for the read view.
  const handleSaveAndView = useCallback(() => saveNote({ navigateToView: true }), [saveNote]);
  // ⌘S → checkpoint save, stay in the editor.
  const handleCheckpointSave = useCallback(() => saveNote({ navigateToView: false }), [saveNote]);

  const handleRevert = useCallback(() => {
    if (!isDirty) return;
    if (!confirm("Discard all edits and revert to last saved version?")) return;
    setDraft(baseline);
    setConflict(null);
    setSaveError(null);
  }, [baseline, isDirty]);

  const handleCancel = useCallback(() => {
    if (isDirty && !confirm("Discard unsaved changes?")) return;
    // The user answered "discard" — drop the local draft too, or it would
    // resurface as a false "restore?" offer on the next edit.
    if (vaultId) clearDraft(vaultId, note.id);
    navigate(`/n/${encodeURIComponent(note.id)}`);
  }, [isDirty, navigate, note.id, vaultId]);

  // Prevent tab close with unsaved edits.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const pathChanged = draft.path !== baseline.path;

  const addTag = (raw: string) => {
    const t = normalizeTag(raw);
    if (!t) return;
    if (draft.tags.includes(t)) return;
    setDraft((d) => ({ ...d, tags: [...d.tags, t] }));
    setTagInput("");
  };
  const removeTag = (name: string) => {
    setDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== name) }));
  };

  // Preview re-renders on every keystroke; the content is already in memory so
  // this is cheap. If highlighting shows up as a bottleneck later, debounce.
  const previewContent = draft.content;

  // Focus mode collapses the whole header card to a floating whisper (below),
  // so the editor pane can reclaim that room for long-form writing — a 60dvh
  // box under a collapsed header leaves dead space beneath it. Give the pane a
  // TALL height in focus mode, but STILL a DEFINITE one (not min-h-only, which
  // revives the #84 scrollPastEnd padding runaway): `.cm-scroller` must stay
  // the content-independent scroll container in BOTH postures. `dvh` (not `vh`)
  // so a mobile keyboard shrinks the pane with the visual viewport.
  const paneHeight = focusOn ? "h-[85dvh]" : "h-[60dvh]";

  return (
    <article>
      {focusOn ? (
        // EDITOR-STUDY §3.3's addition on top of POLISH-WAVE PR 4: in the
        // edit route, focus collapses the WHOLE header card (path, tags,
        // buttons) down to this one floating save-state whisper — "just me
        // and the words" literally. It's the SAME indicator as the header's
        // (SaveStateWhisper), relocated, not reinvented. Positioned
        // top-LEFT so it never collides with FocusModeMount's app-wide exit
        // chip at top-right (App.tsx). ⌘S / Escape keep working from the
        // keyboard either way — CodeMirror binds them directly, independent
        // of whether this chrome is on screen.
        <div
          className="glass-panel enter-fade fixed top-4 left-4 z-30 rounded-full border border-border px-3 py-1.5 text-xs shadow-lift"
          style={{ marginTop: "env(safe-area-inset-top)" }}
        >
          <SaveStateWhisper isDirty={isDirty} justSaved={justSaved} updatedAt={note.updatedAt} />
        </div>
      ) : (
        <header className="card mb-6 p-5 shadow-soft md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="eyebrow">Editing</span>
              <SaveStateWhisper
                isDirty={isDirty}
                justSaved={justSaved}
                updatedAt={note.updatedAt}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <PinArchiveButtons note={note} />
              <DeleteNoteButton note={note} />
              <button
                type="button"
                onClick={() => {
                  // The button unmounts as focus mode collapses this header.
                  // Hand focus to CodeMirror first so Escape still reaches
                  // its cancel-edit binding instead of falling onto <body>.
                  editorRef.current?.focus();
                  setFocusOn(true);
                }}
                className="btn btn-ghost btn-touch"
                title="Focus (⌘.)"
              >
                <IconExpand width={16} height={16} />
                Focus
              </button>
              <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
              <button
                type="button"
                onClick={handleRevert}
                disabled={!isDirty || mutation.isPending}
                className="btn btn-secondary btn-touch"
              >
                Revert
              </button>
              <button type="button" onClick={handleCancel} className="btn btn-secondary btn-touch">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAndView}
                disabled={!isDirty || mutation.isPending || uploadsActive}
                className="btn btn-primary btn-touch"
                title={uploadsActive ? "Waiting for upload…" : "Save (⌘S)"}
                aria-label={uploadsActive ? "Save — waiting for upload…" : "Save"}
              >
                {mutation.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          <div className="mt-4">
            <TagEditor
              tags={draft.tags}
              input={tagInput}
              onInputChange={setTagInput}
              onAdd={addTag}
              onRemove={removeTag}
            />
          </div>

          {/* The path recedes to a quiet single-line meta affordance at the
              header's foot — the editor's echo of NoteView's HeaderPath
              (0.20.14 / #59 quieted the READ header's path; this input kept
              its title-scale serif treatment from PR #1, which predates
              first-line-as-title, so it read as a big duplicate headline —
              Aaron's 7/24 "the path is really big again"). Still directly
              editable (renaming moves the note); it just no longer competes
              with the note's own first-line title in the pane below. */}
          <div className="mt-4 flex items-center gap-2 text-fg-dim">
            <span aria-hidden="true" className="shrink-0 text-xs">
              Path
            </span>
            <input
              type="text"
              value={draft.path}
              onChange={(e) => setDraft((d) => ({ ...d, path: e.target.value }))}
              className="focus-ring w-full min-w-0 truncate rounded border-0 bg-transparent font-mono text-xs text-fg-dim outline-none transition-colors hover:text-fg-muted focus:text-fg placeholder:text-fg-dim"
              aria-label="Note path"
              placeholder="(no path)"
              title={draft.path || undefined}
            />
          </div>
          {pathChanged ? (
            <p className="mt-1 text-xs text-accent">Renaming moves the note — its id may change.</p>
          ) : null}
          {isDefaultViewPath(draft.path) ? (
            <p className="mt-1 text-xs text-danger">
              This path is reserved for a built-in view. A #view note saved here will not appear in
              the Views rail.
            </p>
          ) : null}
        </header>
      )}

      {offeredDraft ? (
        // biome-ignore lint/a11y/useSemanticElements: role=status on a div — the banner holds a flex row of buttons (flow content) that <output>'s phrasing-only model disallows.
        <div
          role="status"
          data-testid="draft-offer"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-sm"
        >
          <span className="text-fg-muted">
            You have an unsaved draft from {relativeTime(offeredDraft.savedAt)}.
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={restoreDraft}
              className="focus-ring font-medium text-accent hover:underline"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={discardOfferedDraft}
              className="focus-ring text-fg-dim hover:text-danger"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      {conflict ? (
        <ConflictBanner
          conflict={conflict}
          onReload={() => {
            // "Reload latest (discard my edits)" — clear the draft first, or the
            // reloaded editor would immediately offer to restore the edits the
            // user just chose to discard.
            if (vaultId) clearDraft(vaultId, note.id);
            window.location.reload();
          }}
          onDismiss={() => setConflict(null)}
        />
      ) : null}
      {saveError ? (
        <div className="mb-4 rounded-xl border border-danger-border bg-danger-soft p-3 text-sm text-danger">
          {saveError}
        </div>
      ) : null}

      {livePreviewOn ? null : (
        <div
          role="tablist"
          aria-label="Editor view"
          className="mb-3 inline-flex rounded-lg border border-border bg-card p-0.5 text-sm lg:hidden"
        >
          {(["edit", "preview"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={mobilePane === p}
              onClick={() => setMobilePane(p)}
              className={`rounded-sm px-3 py-1.5 capitalize ${
                mobilePane === p ? "bg-accent text-on-accent" : "text-fg-muted hover:text-accent"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* DEFINITE editor-pane height (fix: down-arrow freeze on long notes).
          `scrollPastEnd()` sets `.cm-content` padding-bottom = the scroller's
          clientHeight − a line; in a CONTENT-sized editor that clientHeight
          includes the padding it just wrote, so each bottom-edge cursor move
          re-reads inflated geometry and grows the padding without bound (→ a
          multi-second layout stall on a long note). Bounding the pane with a
          definite height (`paneHeight`, plus `min-h-0` so the grid item can
          shrink below its content) makes `.cm-scroller` the real scroll
          container: its clientHeight is now content-INDEPENDENT, so the padding
          converges to one viewport instead of running away. The height is
          definite in BOTH postures — compact 60dvh normally, tall 85dvh in
          focus mode — so the invariant holds either way (see `paneHeight`).
          `dvh` (not `vh`) so a mobile keyboard shrinks the pane with the visual
          viewport. Applies to BOTH panes so the desktop split stays a matched,
          symmetric pair. */}
      <div
        className={`grid ${focusOn ? "min-h-[85dvh]" : "min-h-[60dvh]"} gap-4 ${livePreviewOn ? "" : "lg:grid-cols-2"}`}
      >
        <AttachmentDropZone
          onDropFiles={uploader.start}
          className={`card min-h-0 ${paneHeight} min-w-0 ${livePreviewOn || mobilePane === "edit" ? "" : "hidden lg:block"}`}
          hint={ALLOWLIST_HINT}
        >
          <CodeMirrorEditor
            ref={editorRef}
            value={draft.content}
            onChange={(content) => setDraft((d) => ({ ...d, content }))}
            onSave={handleCheckpointSave}
            onCancel={handleCancel}
            onPasteFile={(files) => {
              uploader.start(files);
              return true;
            }}
            // The "/"-menu's Image/attachment command reuses the
            // Attachments section's own picker below, rather than a second
            // upload path.
            onRequestAttachment={() => attachmentPickerRef.current?.open()}
            livePreview={livePreviewOn}
          />
        </AttachmentDropZone>
        {livePreviewOn ? null : (
          <div
            className={`card min-h-0 ${paneHeight} min-w-0 overflow-auto p-4 ${
              mobilePane === "preview" ? "" : "hidden lg:block"
            }`}
          >
            <NoteRenderer note={{ path: draft.path, content: previewContent }} resolve={resolver} />
          </div>
        )}
      </div>

      <AttachmentsSection
        noteId={note.id}
        pickerRef={attachmentPickerRef}
        attachments={note.attachments ?? []}
        uploads={uploader.uploads}
        onPickFiles={uploader.start}
        onCancel={uploader.cancel}
        onDismiss={uploader.dismiss}
      />
    </article>
  );
}

const ALLOWLIST_HINT = (
  <>
    Images, audio, webm video.{" "}
    <a
      href="https://github.com/ParachuteComputer/parachute-vault/issues/127"
      target="_blank"
      rel="noreferrer"
      className="text-accent hover:underline"
    >
      PDF + mp4 coming
    </a>
  </>
);

function AttachmentsSection({
  noteId,
  pickerRef,
  attachments,
  uploads,
  onPickFiles,
  onCancel,
  onDismiss,
}: {
  noteId: string;
  pickerRef: RefObject<AttachmentPickerHandle | null>;
  attachments: NoteAttachment[];
  uploads: ReturnType<typeof useAttachmentUploader>["uploads"];
  onPickFiles: (files: File[]) => void;
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <section className="mt-6 border-t border-border pt-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-serif text-xl">Attachments</h2>
        <AttachmentPicker ref={pickerRef} onPickFiles={onPickFiles} />
      </div>
      <p className="mb-3 text-xs text-fg-dim">
        Drop or paste files into the editor. Max 100 MB each. {ALLOWLIST_HINT}.
      </p>
      <AttachmentUploadList uploads={uploads} onCancel={onCancel} onDismiss={onDismiss} />
      {attachments.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card/50 px-3 py-1.5 font-mono text-xs"
            >
              <span className="truncate" title={a.path ?? a.id}>
                {a.filename ?? a.path ?? a.id}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {a.mimeType ? <span className="text-fg-dim">{a.mimeType}</span> : null}
                <RemoveAttachmentButton noteId={noteId} attachment={a} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ConflictBanner({
  conflict,
  onReload,
  onDismiss,
}: {
  conflict: VaultConflictError;
  onReload(): void;
  onDismiss(): void;
}) {
  return (
    <div className="mb-4 rounded-xl border border-warning bg-warning-soft p-4">
      <p className="mb-1 font-medium text-warning">This note was edited elsewhere.</p>
      <p className="mb-3 text-sm text-fg-muted">
        Your save was rejected to avoid overwriting the other edit.
        {conflict.currentUpdatedAt
          ? ` Latest update ${relativeTime(conflict.currentUpdatedAt)}.`
          : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onReload} className="btn btn-primary btn-touch">
          Reload latest (discard my edits)
        </button>
        <button type="button" onClick={onDismiss} className="btn btn-secondary btn-touch">
          Keep editing
        </button>
      </div>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="grid min-h-[60dvh] gap-4 lg:grid-cols-2" aria-busy="true">
      <div className="card animate-pulse" />
      <div className="card animate-pulse" />
    </div>
  );
}

function NotFoundBlock({ id }: { id: string }) {
  return (
    <EmptyState
      title={<span className="font-serif text-xl text-fg">Note not found</span>}
      description={
        <>
          No note with id <span className="font-mono">{id}</span> in this vault.
        </>
      }
      action={
        <Link to="/notes" className="text-sm text-accent hover:underline">
          Back to all notes
        </Link>
      }
    />
  );
}

// The checkpoint-save whisper (PR #40): "unsaved" (accent dot) while dirty →
// "Saved ✓" for a beat after ⌘S → settles to "saved 2h ago". Extracted so
// focus mode (EDITOR-STUDY §3.3) can float the SAME indicator outside the
// header card instead of building a second one.
function SaveStateWhisper({
  isDirty,
  justSaved,
  updatedAt,
}: {
  isDirty: boolean;
  justSaved: boolean;
  updatedAt?: string;
}) {
  if (isDirty) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-accent"
        aria-label="unsaved changes"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        unsaved
      </span>
    );
  }
  if (justSaved) {
    return (
      <span className="text-xs text-accent" aria-label="saved">
        Saved ✓
      </span>
    );
  }
  return <span className="text-xs text-fg-dim">saved {relativeTime(updatedAt)}</span>;
}

function ErrorBlock({ error }: { error: Error }) {
  const isAuth = error instanceof VaultAuthError;
  return (
    <ErrorState
      title={isAuth ? "Session expired" : "Could not load note"}
      message={error.message}
      action={
        isAuth ? (
          <Link to="/add" className="btn btn-primary">
            Reconnect vault
          </Link>
        ) : undefined
      }
    />
  );
}

function setEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const x of b) if (!set.has(x)) return false;
  return true;
}

function diffTags(before: string[], after: string[]): { add: string[]; remove: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const add = after.filter((t) => !beforeSet.has(t));
  const remove = before.filter((t) => !afterSet.has(t));
  return { add, remove };
}
