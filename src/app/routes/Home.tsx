import { RecentTimeline, groupNotesByDay } from "@/components/RecentTimeline";
import { OfflineRibbon } from "@/components/ui";
import { isHostedVaultRecord } from "@/lib/account/hosted-vault";
import {
  type HomeStepId,
  deriveSteps,
  hasUserAuthoredNote,
  stepsComplete,
} from "@/lib/home/checklist";
import { useHomeChecklist } from "@/lib/home/use-home-checklist";
import { useInstallAffordance } from "@/lib/pwa-install";
import { useNotesForDateViews, useVaultStore } from "@/lib/vault";
import type { Note } from "@/lib/vault/types";
import { useMemo } from "react";
import { Link, Navigate } from "react-router";

// The guided home — the surface a connected vault opens on (App.tsx's BootGate
// renders this at `/`; the no-vault case renders the arrival `Landing`).
//
// Rebuilt to the synthesized prototype (Scene 4/6): the vault NAME leads as the
// serif masthead (identity everywhere), a focused write-in-place composer is the
// hero affordance, warm quick doors + one quiet sun nudge carry setup, and the
// recent timeline gathers below. It leans warm for a fresh vault and recedes to
// a quiet version once the vault feels lived-in.
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

      <Composer vaultName={vault.name} focused={mode === "fresh"} />

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

      <PlanBacklink clientId={vault.clientId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer — the write-in-place hero. The whole card is a door into /new (the
// real creation flow); the mic + autosave line are the prototype's warmth.
// ---------------------------------------------------------------------------

function Composer({ vaultName, focused }: { vaultName: string; focused: boolean }) {
  return (
    <Link
      to="/new"
      aria-label="Write a note"
      className={`focus-ring composer mb-6 block px-5 py-4 ${focused ? "composer-focus" : ""}`}
    >
      <p className="text-lg text-fg-dim">What's on your mind?</p>
      <div className="mt-3 flex items-center justify-between">
        <span className="font-round text-xs text-fg-dim">Autosaves to {vaultName}</span>
        <span
          aria-hidden="true"
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-bg-soft text-base"
        >
          🎙
        </span>
      </div>
    </Link>
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
          <p className="mb-1 font-serif text-lg text-fg">A quiet, empty page.</p>
          <p className="mb-5 text-sm text-fg-muted">
            Anything at all can land here — a thought, a list, a memory.
          </p>
          <Link
            to="/new"
            className="inline-flex rounded-full bg-accent px-5 py-2.5 font-round text-sm font-semibold text-on-accent shadow-soft hover:bg-accent-hover"
          >
            Write the first one
          </Link>
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

function PlanBacklink({ clientId }: { clientId: string }) {
  if (!isHostedVaultRecord(clientId)) return null;
  return (
    <div className="mt-10 border-t border-border pt-4 text-sm">
      <Link to="/account" className="text-fg-dim hover:text-accent">
        Manage your account →
      </Link>
    </div>
  );
}
