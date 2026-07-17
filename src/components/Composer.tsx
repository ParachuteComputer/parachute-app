import { VoiceUnavailableNote } from "@/components/VoiceUnavailableNote";
import { quickPath } from "@/lib/capture/recorder";
import { buildTextNotePayload } from "@/lib/capture/text-note";
import {
  type DraftBody,
  NEW_NOTE_SCOPE,
  clearDraft,
  loadDraft,
  saveDraft,
} from "@/lib/drafts/store";
import { useDraftAutosave } from "@/lib/drafts/use-draft-autosave";
import { useToastStore } from "@/lib/toast/store";
import { useCreateNote, useTagRoles } from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import { useActiveVaultClient, useTranscriptionGate } from "@/lib/vault/queries";
import { ensureNotesSchema } from "@/lib/vault/schema-ensure";
import type { VaultRecord } from "@/lib/vault/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

// Composer — the write-in-place hero, HONEST since W2-10 (F10: the affordance
// used to be a <Link to="/new"> dressed as an input — the first tap yanked you
// to a different screen). Now it's a real expanding textarea:
//
//   - typing autosaves into the SAME per-vault draft store /new reads
//     (`NEW_NOTE_SCOPE`), so the thought you start here is exactly the draft
//     the full editor opens with — and a draft started on /new greets you
//     here on your way back;
//   - "Save to {vault}" commits through the same assembly NoteNew's text save
//     uses (buildTextNotePayload + useCreateNote) and STAYS on the current
//     surface — the note settles into the recent list below;
//   - the mic is the same W2-9 voice arrival the speed dial uses
//     (`/new?voice=1`), behind the same transcription-capability gate;
//   - "Open full editor →" is the quiet ESCAPE (path/tags/attachments/
//     preview), not the default.
//
// LZ-1: extracted verbatim from Home.tsx (the W2-10 room) so the upcoming
// one-surface merge can drop it onto both the Recent and All lenses
// (LENS-SPEC.md §3.1 anatomy item 2). Pure move — no behavior change.

// The textarea's DOM id — lets an empty-state "Write the first one" button
// elsewhere on the page focus the composer in place instead of hopping to
// /new. Exported so callers outside this component (Home's RecentNotes) can
// wire their own affordance to it.
export const COMPOSER_INPUT_ID = "home-composer-input";

export function Composer({ vault, focused = false }: { vault: VaultRecord; focused?: boolean }) {
  const pushToast = useToastStore((s) => s.push);
  const mutation = useCreateNote();
  const client = useActiveVaultClient();
  const { roles } = useTagRoles(vault.id);

  // Mic gate — the same seam as NoteNew: hide the voice door ONLY when the
  // vault EXPLICITLY declares transcription disabled; absent/undeclared stays
  // fail-open. Navigating during the gate's pending window is safe because
  // the /new?voice=1 arrival re-checks with `settled` before auto-firing.
  const gate = useTranscriptionGate();
  const voiceGated = gate.capability?.enabled === false;

  // Same default-path behaviour as NoteNew: a real quickPath up front, never
  // silent vault-auto-assign. Regenerated after each save so the next thought
  // gets its own timestamped home.
  const defaultPathRef = useRef(quickPath());

  // Restore the shared draft at mount — a compose started on /new (or a
  // previous visit here) shows through. The `path || default` guard covers a
  // malformed stored path; tags set on /new ride along untouched so a save
  // from here commits them too.
  const [body, setBody] = useState<DraftBody>(() => {
    const stored = loadDraft(vault.id, NEW_NOTE_SCOPE);
    if (stored) return { ...stored.body, path: stored.body.path || defaultPathRef.current };
    return { content: "", path: defaultPathRef.current, tags: [] };
  });
  const [focusWithin, setFocusWithin] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Mirror NoteNew's persistable-dirty test exactly, so the two surfaces keep
  // the one draft in lockstep (and an untouched composer never clobbers or
  // litters the store).
  const persistableDirty =
    body.content.trim().length > 0 ||
    body.tags.length > 0 ||
    (body.path.trim().length > 0 && body.path !== defaultPathRef.current);
  useDraftAutosave(vault.id, NEW_NOTE_SCOPE, body, persistableDirty);

  // The autosave above is debounced (600ms); a same-tick route hop — tapping
  // the mic or the full-editor escape, or any unmount mid-debounce — must not
  // drop the tail of what was typed. Flush synchronously through the same
  // store on those edges.
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const dirtyRef = useRef(persistableDirty);
  dirtyRef.current = persistableDirty;
  const flushDraft = useCallback(() => {
    if (dirtyRef.current) saveDraft(vault.id, NEW_NOTE_SCOPE, bodyRef.current);
  }, [vault.id]);
  useEffect(() => {
    return () => flushDraft();
  }, [flushDraft]);

  // Auto-grow: the box hugs its content; the min-height floor (below) carries
  // the focus-expansion feel on --dur-move (the motion-token vocabulary,
  // PR1). An effect (not an onChange
  // side-channel) so every content path re-measures — typed, restored at
  // mount, AND the programmatic clear after save (which must shrink the box
  // back down, not leave the last keystroke's height behind).
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    // Release the previous pin first; when empty, LEAVE it released — the
    // min-height floor owns the box. (Measuring the empty state would read
    // scrollHeight mid-shrink-transition and pin the box tall.)
    ta.style.height = "";
    if (body.content) ta.style.height = `${ta.scrollHeight}px`;
  }, [body.content]);

  const expanded = focusWithin || body.content.length > 0;
  const canSave =
    body.content.trim().length > 0 && body.path.trim().length > 0 && !mutation.isPending;

  const save = () => {
    if (!canSave) return;
    // The same commit path as NoteNew's text save. Fire-and-forget schema
    // ensure — creates the `capture` tag row if the vault doesn't have it
    // yet; never blocks the save.
    if (client) void ensureNotesSchema(vault.id, client);
    setSaveError(null);
    mutation.mutate(
      buildTextNotePayload({
        content: body.content,
        path: body.path,
        tags: body.tags,
        captureTextRole: roles.captureText,
      }),
      {
        onSuccess: () => {
          clearDraft(vault.id, NEW_NOTE_SCOPE);
          defaultPathRef.current = quickPath();
          setBody({ content: "", path: defaultPathRef.current, tags: [] });
          // Fold the card back to resting. Explicit because the focused Save
          // button goes disabled here, and Chrome drops focus WITHOUT firing
          // blur in that case — the container's onBlur never runs, so the
          // emptied card would sit expanded on stale focus state.
          inputRef.current?.blur();
          setFocusWithin(false);
          // NO navigation — the W2-10 point. The note settles into the
          // recent list below (useCreateNote invalidates the timeline
          // query); the toast is the only ceremony.
          pushToast(`Saved to ${vault.name}`, "success");
        },
        onError: (err) => {
          // Content stays put (and stays draft-autosaved) — an error never
          // costs the words.
          setSaveError(
            err instanceof VaultAuthError
              ? "Session expired. Reconnect to save."
              : err instanceof Error
                ? err.message
                : "Couldn't save — try again.",
          );
        },
      },
    );
  };

  return (
    <form
      aria-label="Write a note"
      className={`composer mb-6 px-5 py-4 ${focused ? "composer-focus" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onFocus={() => setFocusWithin(true)}
      onBlur={(e) => {
        // Flush the debounced draft the instant focus leaves the composer —
        // blur fires on pointerdown, BEFORE any outside door (the mobile "+",
        // speed-dial, palette, setup-nudge) activates its click and navigates
        // to /new, whose render-phase draft read would otherwise beat Home's
        // unmount flush and drop the just-typed tail (worst case the whole
        // note, since the autosave debounce re-arms on every keystroke). The
        // per-link onClick flushes stay as belt-and-suspenders.
        flushDraft();
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
      }}
    >
      <textarea
        id={COMPOSER_INPUT_ID}
        ref={inputRef}
        rows={1}
        value={body.content}
        onChange={(e) => setBody((b) => ({ ...b, content: e.target.value }))}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
        aria-label="What's on your mind?"
        placeholder="What's on your mind?"
        className="block max-h-[45vh] w-full resize-none overflow-y-auto border-0 bg-transparent text-fg text-lg outline-none [transition:min-height_var(--dur-move)_ease] placeholder:text-fg-dim"
        style={{ minHeight: expanded ? "6.5rem" : "1.75rem" }}
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        {expanded ? (
          // The escape to the full editor — the shared draft means it opens
          // with exactly this text. NAVIGATION.md: user-initiated card link —
          // push. (onClick flush beats the debounce to the store.)
          <Link
            to="/new"
            onClick={flushDraft}
            className="focus-ring rounded text-fg-dim text-xs hover:text-accent"
          >
            Open full editor →
          </Link>
        ) : (
          <span className="font-round text-fg-dim text-xs">Autosaves to {vault.name}</span>
        )}
        <div className="flex items-center gap-2">
          {expanded ? (
            <button
              type="submit"
              disabled={!canSave}
              className="btn btn-primary btn-touch"
              title="Save (⌘⏎)"
            >
              {mutation.isPending ? "Saving…" : `Save to ${vault.name}`}
            </button>
          ) : null}
          {voiceGated ? null : (
            // The voice door — the same W2-9 arrival the speed dial uses;
            // /new auto-starts the recorder once the capability gate settles.
            // Kept LAST in the row so the Save pill blooms in on its left and
            // the mic never moves under an in-flight tap (the Record/Stop
            // double-fire lesson). NAVIGATION.md: user-initiated card link —
            // push.
            <Link
              to="/new?voice=1"
              onClick={flushDraft}
              aria-label="Record a voice note"
              className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-bg-soft text-base transition-colors duration-(--dur-quick) ease-out hover:border-accent/50 hover:bg-accent/10"
            >
              <span aria-hidden="true">🎙</span>
            </Link>
          )}
        </div>
      </div>
      {voiceGated && expanded ? (
        // The honest line — same two-door copy as /new's recorder slot.
        <VoiceUnavailableNote capability={gate.capability} className="mt-2 text-xs text-fg-dim" />
      ) : null}
      {saveError ? (
        <p role="alert" className="mt-2 text-danger text-xs">
          {saveError}
        </p>
      ) : null}
    </form>
  );
}
