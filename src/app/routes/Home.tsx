import { RecentTimeline, groupNotesByDay } from "@/components/RecentTimeline";
import { VoiceUnavailableNote } from "@/components/VoiceUnavailableNote";
import { OfflineRibbon } from "@/components/ui";
import { isHostedVaultRecord } from "@/lib/account/hosted-vault";
import { summaryOrNull, useAccountSummary } from "@/lib/account/use-summary";
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
import {
  type HomeStepId,
  deriveSteps,
  hasUserAuthoredNote,
  stepsComplete,
} from "@/lib/home/checklist";
import { useHomeChecklist } from "@/lib/home/use-home-checklist";
import { useInstallAffordance } from "@/lib/pwa-install";
import { useToastStore } from "@/lib/toast/store";
import { useCreateNote, useNotesForDateViews, useTagRoles, useVaultStore } from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import { useActiveVaultClient, useTranscriptionGate } from "@/lib/vault/queries";
import { ensureNotesSchema } from "@/lib/vault/schema-ensure";
import type { Note, VaultRecord } from "@/lib/vault/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router";

// The guided home — the surface a connected vault opens on (App.tsx's BootGate
// renders this at `/`; the no-vault case renders the arrival `Landing`).
//
// Rebuilt to the synthesized prototype (Scene 4/6): the vault NAME leads as the
// serif masthead (identity everywhere), a write-in-place composer is the hero
// affordance — since W2-10 a REAL one (type, save, stay) — warm quick doors +
// one quiet sun nudge carry setup, and the recent timeline gathers below. It
// leans warm for a fresh vault and recedes to a quiet version once the vault
// feels lived-in.
//
// F8/W2-3: this room absorbed `/today`'s no-param timeline, which used to
// render an almost-identical day-grouped list under a different name (the
// desktop rail called `/` "Today" while the mobile tab called it "Home" —
// two names for one room). `/today` with no `?date=` is now a redirect shim
// to here; `/today?date=` survives as the day drill-in (`DayView.tsx`).
export function Home() {
  const vault = useVaultStore((s) => s.getActiveVault());
  const notes = useNotesForDateViews();
  const install = useInstallAffordance();
  const { state: checklistState, dismiss } = useHomeChecklist(vault?.id ?? null);

  // Trial ambience (DESIGN-SPEC §3.1, sanctioned places 2 + 4) — the SHARED
  // account-summary query, enabled only for a home-door (account-minted)
  // vault: a self-host door has no summary, so the fetch never fires. Lazy,
  // never gates paint; failed/absent read the same here (no ambience — the
  // retry affordance lives on /account).
  const isHosted = vault !== null && isHostedVaultRecord(vault.clientId);
  const summaryQuery = useAccountSummary({ enabled: isHosted });
  const plan = (isHosted ? summaryOrNull(summaryQuery.data) : null)?.plan ?? null;
  const trialDaysLeft = typeof plan?.trial_days_left === "number" ? plan.trial_days_left : null;

  // NotesIndex only mounts Home when a vault is active, but guard anyway: a
  // vault removed mid-session falls back to the arrival (via the index).
  // NAVIGATION.md: route guard, no active vault — replace.
  if (!vault) return <Navigate to="/" replace />;

  // `settled` gates the "fresh" warmth on notes having loaded, so a returning
  // user never flashes the newcomer state before their notes come back.
  const settled = notes.data !== undefined;
  const hasUserNote = hasUserAuthoredNote(notes.data);

  const steps = deriveSteps(checklistState, {
    hasUserNote,
    installed: install.state === "installed",
    installable: install.state === "available",
  });
  const allDone = stepsComplete(steps);
  const showSetup = !checklistState.dismissed && !allDone;
  const incomplete = steps.filter((s) => !s.done);
  const doneCount = steps.length - incomplete.length;

  // Fresh = a brand-new vault the user hasn't made their own yet. Once a real
  // note exists (or they dismiss/finish setup) the home goes quiet.
  const mode: "fresh" | "returning" = settled && !hasUserNote && showSetup ? "fresh" : "returning";

  return (
    <div className="page-prose">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="page-title" style={{ fontSize: "clamp(2rem, 4vw, 2.6rem)" }}>
            {vault.name}
          </h1>
          <p className="mt-1.5 text-fg-muted">
            Everything here is yours. Open format. Export anytime.
          </p>
        </div>
        {/* W2-3's stopgap Calendar link lived here while the rail carried no
            Calendar row; W2-5 promoted Calendar into the notes band on both
            projections, so the duplicate affordance is gone. */}
      </header>

      {/* Keyed by vault id: a mid-session vault switch remounts a fresh
          composer bound to the new vault's draft (the notes#175 draft-clobber
          guard — same reasoning as NoteNew's pinned composeVaultId). */}
      <Composer key={vault.id} vault={vault} focused={mode === "fresh"} />

      <TrialCountdownNudge daysLeft={trialDaysLeft} />

      {mode === "fresh" ? <QuickDoors /> : null}

      {showSetup && incomplete.length > 0 ? (
        <SetupNudge
          to={SETUP_DEST[incomplete[0].id].to}
          label={SETUP_DEST[incomplete[0].id].label}
          done={doneCount}
          total={steps.length}
          onDismiss={dismiss}
        />
      ) : null}

      <RecentNotes
        isPending={notes.isPending}
        isError={notes.isError}
        notes={notes.data}
        fresh={mode === "fresh"}
      />

      <PlanBacklink clientId={vault.clientId} trialDaysLeft={trialDaysLeft} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trial countdown nudge — sanctioned ambience place 4 of exactly four
// (DESIGN-SPEC §3.1): a single sun row under the composer, ONLY when
// `trial_days_left <= 7`, ONLY on Today. Not dismissible (it exists for ≤7
// days by definition), never a modal, never on any other page.
// ---------------------------------------------------------------------------

function TrialCountdownNudge({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft === null || daysLeft > 7) return null;
  return (
    <div className="nudge-sun mb-6">
      <span aria-hidden="true">✦</span>
      <Link to="/account" className="min-w-0 flex-1 truncate hover:underline">
        {daysLeft === 0
          ? "Your trial ends today — see plans →"
          : `Your trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"} — see plans →`}
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer — the write-in-place hero, HONEST since W2-10 (F10: the affordance
// used to be a <Link to="/new"> dressed as an input — the first tap yanked you
// to a different screen). Now it's a real expanding textarea:
//
//   - typing autosaves into the SAME per-vault draft store /new reads
//     (`NEW_NOTE_SCOPE`), so the thought you start here is exactly the draft
//     the full editor opens with — and a draft started on /new greets you
//     here on your way back;
//   - "Save to {vault}" commits through the same assembly NoteNew's text save
//     uses (buildTextNotePayload + useCreateNote) and STAYS on Today — the
//     note settles into the recent list below;
//   - the mic is the same W2-9 voice arrival the speed dial uses
//     (`/new?voice=1`), behind the same transcription-capability gate;
//   - "Open full editor →" is the quiet ESCAPE (path/tags/attachments/
//     preview), not the default.
// ---------------------------------------------------------------------------

// The textarea's DOM id — lets the empty-state "Write the first one" button
// below focus the composer in place instead of hopping to /new.
const COMPOSER_INPUT_ID = "home-composer-input";

function Composer({ vault, focused }: { vault: VaultRecord; focused: boolean }) {
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
  // the focus-expansion feel with a 200ms ease. An effect (not an onChange
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
        className="block max-h-[45vh] w-full resize-none overflow-y-auto border-0 bg-transparent text-fg text-lg outline-none [transition:min-height_200ms_ease] placeholder:text-fg-dim motion-reduce:transition-none"
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
              className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-bg-soft text-base transition-colors hover:border-accent/50 hover:bg-accent/10 motion-reduce:transition-none"
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

// ---------------------------------------------------------------------------
// Quick doors — warm tiles for the two always-relevant next steps beyond
// writing (which the composer covers). Shown while the vault is fresh; they
// recede once it's lived-in so a returning user isn't nagged.
// ---------------------------------------------------------------------------

function QuickDoors() {
  return (
    <nav aria-label="Quick actions" className="mb-6 grid gap-3 sm:grid-cols-2">
      <DoorTile
        to="/connect"
        emoji="⚡"
        title="Connect your AI"
        description="Let Claude or ChatGPT read and write your vault."
      />
      <DoorTile
        to="/import"
        emoji="↯"
        title="Bring your notes over"
        description="Import from Obsidian or plain markdown."
      />
    </nav>
  );
}

function DoorTile({
  to,
  emoji,
  title,
  description,
}: {
  to: string;
  emoji: string;
  title: string;
  description: string;
}) {
  return (
    <Link to={to} className="focus-ring tile flex items-start gap-3 p-4">
      <span aria-hidden="true" className="text-lg leading-none">
        {emoji}
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-fg">{title}</span>
        <span className="mt-0.5 block text-sm text-fg-muted">{description}</span>
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Setup nudge — ONE quiet sun row (prototype's "✦ Finish setting up 1/3"), not
// a wall of checkboxes. It points at the next incomplete step; dismissible.
// ---------------------------------------------------------------------------

const SETUP_DEST: Record<HomeStepId, { label: string; to: string }> = {
  write: { label: "Write your first note", to: "/new" },
  connect: { label: "Connect your AI", to: "/connect" },
  import: { label: "Bring your notes over", to: "/import" },
  install: { label: "Install the app", to: "/settings" },
};

function SetupNudge({
  to,
  label,
  done,
  total,
  onDismiss,
}: {
  to: string;
  label: string;
  done: number;
  total: number;
  onDismiss: () => void;
}) {
  return (
    <div className="nudge-sun mb-8">
      <span aria-hidden="true">✦</span>
      <Link to={to} className="min-w-0 flex-1 truncate hover:underline">
        Finish setting up — {label}
      </Link>
      <span className="font-round text-sm opacity-80">
        {done} / {total}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss setup"
        className="ml-1 text-sun-ink/70 hover:text-sun-ink"
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent notes — the day-grouped timeline (shared with /today).
// ---------------------------------------------------------------------------

function RecentNotes({
  isPending,
  isError,
  notes,
  fresh,
}: {
  isPending: boolean;
  isError: boolean;
  notes: Note[] | undefined;
  fresh: boolean;
}) {
  const groups = useMemo(() => groupNotesByDay(notes ?? []), [notes]);

  return (
    <section aria-label="Recent notes">
      <h2 className="eyebrow mb-3 flex items-center justify-between">
        <span>{fresh ? "Today" : "Recent"}</span>
        <Link to="/notes" className="text-fg-dim hover:text-accent">
          All notes
        </Link>
      </h2>
      {isPending ? (
        <RecentSkeleton />
      ) : isError && !notes ? (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-fg-muted">
          Couldn't load recent notes. They'll appear once you're back online.
        </p>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center shadow-soft">
          <p className="mb-1 font-serif text-fg text-lg">A quiet, empty page.</p>
          <p className="mb-5 text-fg-muted text-sm">
            Anything at all can land here — a thought, a list, a memory.
          </p>
          {/* W2-10: the composer above is real now — the first-capture CTA
              focuses it in place instead of hopping to /new (the affordance
              and the action finally agree). */}
          <button
            type="button"
            onClick={() => document.getElementById(COMPOSER_INPUT_ID)?.focus()}
            className="inline-flex rounded-full bg-accent px-5 py-2.5 font-round font-semibold text-on-accent text-sm shadow-soft hover:bg-accent-hover"
          >
            Write the first one
          </button>
        </div>
      ) : (
        <>
          {isError ? <OfflineRibbon /> : null}
          <RecentTimeline notes={notes ?? []} />
        </>
      )}
    </section>
  );
}

function RecentSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl bg-border/30" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account backlink — a quiet in-app door to the account manager, shown only for
// HOME-DOOR (account-minted) vaults. Navigates to `/account` (same origin, via
// react-router) rather than hopping to a cross-origin console — the /account
// surface owns plan + billing (Stripe-direct) + hosted vaults, so there's no
// re-login. A foreign self-hosted vault (connected via `/add` OAuth) has no
// account on THIS door, so no backlink is shown — never a dead affordance.
// ---------------------------------------------------------------------------

function PlanBacklink({
  clientId,
  trialDaysLeft,
}: {
  clientId: string;
  trialDaysLeft: number | null;
}) {
  if (!isHostedVaultRecord(clientId)) return null;
  return (
    <div className="mt-10 border-t border-border pt-4 text-sm">
      {/* Sanctioned ambience place 2 (§3.1): the backlink carries the trial
          line while trialing — plain otherwise. One link, one destination. */}
      <Link to="/account" className="text-fg-dim hover:text-accent">
        {trialDaysLeft !== null ? (
          <>
            <span className="font-medium text-sun-ink">
              Free trial ·{" "}
              {trialDaysLeft === 0
                ? "ends today"
                : `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left`}
            </span>{" "}
            · Manage your account →
          </>
        ) : (
          "Manage your account →"
        )}
      </Link>
    </div>
  );
}
