import { ParachuteMark } from "@/components/ParachuteMark";
import { WizardShell } from "@/components/WizardShell";
import { getDoorDescriptor } from "@/lib/account/descriptor";
import { describeAccountError } from "@/lib/account/error-copy";
import { createHostedVault, openHostedVault } from "@/lib/account/hosted-vault";
import { loadLastSigninEmail } from "@/lib/account/store";
import { useVaultStore } from "@/lib/vault/store";
import { announceVaultSwitch } from "@/lib/vault/switch";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";

// The creation ceremony's stepped URLs (DESIGN-SPEC §4.2, W2-6). The three
// beats used to be one React state machine under /welcome?new=1 — browser
// Back teleported past all of them onto stale context (WALK-manager's
// desktop-33 repro). Now:
//
//   /add-vault/create            naming form  [reached by PUSH from the
//                                chooser / picker / switcher / Account]
//     submit → in-shell "creating" beat, SAME URL — a process, not a place
//     success → /add-vault/ready?vault=<name>  [REPLACE — consumes the form]
//     failure → the naming form again, same URL, error inline (F12 copy)
//   /add-vault/create?first=1    same form, onboarding copy — reached from
//                                the /welcome dispatcher's first-vault branch
//
// Back from naming → the chooser (push chain). Back from ready → the chooser
// (the replace consumed the naming form — you can't Back into re-creating a
// vault that now exists). And because createHostedVault MINTS ONLY (the
// activation-honesty split, hosted-vault.ts), Back from ready is benign: the
// active vault never changed, so every page behind you is still true.

const PROGRESS_LABELS = ["Name", "Making it", "Ready"];

function sanitizeVaultName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

type Stage =
  | { kind: "naming"; attemptedName?: string; error?: string }
  | { kind: "creating"; name: string };

/** `/add-vault/create` — the naming beat + (same URL) the creating beat. */
export function AddVaultCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // ?first=1 — onboarding copy: the /welcome dispatcher's first-vault branch
  // lands here right after account creation (no other vault exists yet).
  const first = searchParams.get("first") === "1";
  const [stage, setStage] = useState<Stage>({ kind: "naming" });
  const creatingRan = useRef<string | null>(null);

  // The creation beat: fires once per attempted name. A failure returns to
  // the naming form with the typed name preserved so the person can fix a
  // typo rather than retype it.
  useEffect(() => {
    if (stage.kind !== "creating") return;
    if (creatingRan.current === stage.name) return;
    creatingRan.current = stage.name;
    const { name } = stage;
    (async () => {
      try {
        // MINTS ONLY (§4.2 activation honesty) — the account bearer is minted
        // + cached inside the client; nothing on this device changes here.
        const canonical = await createHostedVault(name);
        const params = new URLSearchParams({ vault: canonical });
        if (first) params.set("first", "1");
        // NAVIGATION.md: "Creation success → /add-vault/ready" — (b) consumes
        // the naming form, replace. Back from ready lands on the chooser, not
        // on a form that would re-create a vault that now exists.
        navigate(`/add-vault/ready?${params.toString()}`, { replace: true });
      } catch (err) {
        creatingRan.current = null;
        setStage({
          kind: "naming",
          attemptedName: name,
          // F12 — never the raw wire code (`vault_limit_reached`, …): map
          // known account-error codes to calm copy, generic fallback for the
          // rest.
          error: describeAccountError(err, "Couldn't create your vault. Try a different name."),
        });
      }
    })();
  }, [stage, navigate, first]);

  if (stage.kind === "creating") {
    return (
      <WizardShell
        // §4.1 rule 2: escape "none" is legal ONLY for auto-advancing beats —
        // this is the creating tick (success replaces to /ready, failure
        // falls back to the naming form on its own).
        escape={{ kind: "none" }}
        progress={{ labels: PROGRESS_LABELS, current: 1 }}
      >
        <CreatingBeat name={stage.name} />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      // F6 — a quiet way out, history-aware (NAVIGATION.md escape rule): back
      // to wherever the person actually came from (chooser, switcher, picker,
      // Account); the fallback names the canonical prior step — the chooser —
      // except in first-run onboarding, where no chooser exists yet and the
      // front door is the only sane exit.
      escape={{ kind: "back", to: first ? "/" : "/add-vault" }}
      progress={{ labels: PROGRESS_LABELS, current: 0 }}
    >
      <VaultNamingForm
        first={first}
        initialName={stage.attemptedName}
        error={stage.error}
        onCreate={(name) => setStage({ kind: "creating", name })}
      />
    </WizardShell>
  );
}

// The "✓ Signed in as X" chip (SYNTHESIS #5 / #10) — the tell-don't-ask
// statement that opens every post-sign-in screen once we know who they are.
function SignedInChip({ email }: { email: string | null }) {
  if (!email) return null;
  return (
    <p className="chip mb-4 inline-flex border-grass/40 bg-grass-soft text-grass-ink">
      <span aria-hidden="true">✓</span>&nbsp;Signed in as {email}
    </p>
  );
}

// The naming form (SYNTHESIS #5 first-vault / #10 add-vault). ONE form, two
// copy contexts — no "skip", no "you can change it later": the name is the
// immutable slug, so that copy would be a lie. (Migrated from Welcome.tsx —
// the dispatcher no longer owns any naming state.)
function VaultNamingForm({
  first,
  initialName,
  error,
  onCreate,
}: {
  first: boolean;
  initialName?: string;
  error?: string;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState(() => sanitizeVaultName(initialName ?? ""));
  const [vaultUrlTemplate, setVaultUrlTemplate] = useState<string | null>(null);
  // The chip + the "separate from X" referent come from what this device
  // already knows (same sources as the chooser's Create card) — no blocking
  // session round-trip in front of a form that can render instantly.
  const email = loadLastSigninEmail();
  const existingName = useVaultStore((s) => s.getActiveVault()?.name ?? null);
  const trimmed = name.trim();

  // HUB-PARITY P4 (SYNTHESIS screen 5's live address echo): the door
  // descriptor's `vault_url_template` lets the naming form preview the real
  // address instead of just the slug, once a door advertises one.
  useEffect(() => {
    let live = true;
    getDoorDescriptor().then((d) => {
      if (live) setVaultUrlTemplate(d?.vault_url_template ?? null);
    });
    return () => {
      live = false;
    };
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    onCreate(trimmed);
  }

  return (
    <>
      <ParachuteMark size={60} className="mx-auto mb-6 drop-in" />
      <SignedInChip email={email} />
      <p className="eyebrow mb-3">{first ? "Account created ✓" : "Adding a vault"}</p>
      <h1 className="hero-title mb-4">
        {first ? "Let's make your first" : "Let's make your new"}{" "}
        <span className="accent-word">vault.</span>
      </h1>
      <p className="mx-auto mb-8 max-w-md text-lg leading-relaxed text-fg-muted">
        {first ? (
          <>
            A vault is the private home for your notes — any AI you invite can read it, always yours
            to export. <b className="font-semibold text-fg">This creates a brand-new, empty one.</b>
          </>
        ) : (
          <>
            This one's separate from{" "}
            <b className="font-semibold text-fg">{existingName ?? "your other vault"}</b> — its own
            private space, nothing shared.
          </>
        )}
      </p>

      <form onSubmit={handleSubmit}>
        <input
          // biome-ignore lint/a11y/noAutofocus: this screen's single purpose is this field.
          autoFocus
          value={name}
          onChange={(e) => setName(sanitizeVaultName(e.target.value))}
          placeholder="moss"
          autoComplete="off"
          spellCheck={false}
          aria-label="Vault name"
          className="mx-auto mb-2 block w-full max-w-sm border-0 border-b-2 border-border bg-transparent pb-2 text-center font-serif text-3xl text-fg outline-none transition-colors focus:border-accent-light"
        />
        <p className="mb-6 min-h-6 font-round text-sm text-fg-muted">
          {trimmed ? (
            <span>
              Your vault:{" "}
              <b className="rounded-md bg-grass-soft px-2 py-0.5 text-grass-ink">{trimmed}</b>
              {vaultUrlTemplate ? (
                <>
                  {" — it will live at "}
                  <span className="font-mono text-xs">
                    {vaultUrlTemplate.replace("{name}", trimmed)}
                  </span>
                </>
              ) : null}
            </span>
          ) : (
            "Letters, numbers, hyphens — pick a word you like."
          )}
        </p>
        <p className="mx-auto mb-8 max-w-sm font-round text-xs text-fg-dim">
          <span className="font-semibold text-fg-muted">The address is permanent</span>, so pick a
          word you like. Letters, numbers, hyphens.
        </p>

        {error ? (
          <p className="mx-auto mb-6 max-w-sm rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!trimmed}
          className="btn btn-primary btn-lg justify-center rounded-full px-6 shadow-soft"
        >
          {trimmed ? `Create ${trimmed} →` : "Create →"}
        </button>
      </form>
    </>
  );
}

const CREATING_TICKS = ["Setting up your vault…", "Preparing your keys…", "Almost there…"];

// Cosmetic-only ticking status text (§4.1 rule 4 — calm, NO spinner) —
// cycles on its own timer while the real createHostedVault() call (owned by
// the parent) is in flight; doesn't gate anything, so a fast network just
// shows the first tick briefly.
function CreatingTick() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (index >= CREATING_TICKS.length - 1) return;
    const t = setTimeout(() => setIndex((i) => Math.min(i + 1, CREATING_TICKS.length - 1)), 650);
    return () => clearTimeout(t);
  }, [index]);
  return (
    <output aria-live="polite" className="font-round text-sm text-fg-muted">
      {CREATING_TICKS[index]}
    </output>
  );
}

// SYNTHESIS #6 — the creating beat: "Making a place for X…" + ticks. A
// process, not a place: it renders under /add-vault/create's own URL.
function CreatingBeat({ name }: { name: string }) {
  return (
    <>
      <ParachuteMark size={96} className="mx-auto mb-6 animate-pulse" />
      <h1 className="hero-title mb-3" style={{ fontSize: "clamp(1.6rem, 3.5vw, 1.9rem)" }}>
        Making a place for <span className="accent-word">{name}…</span>
      </h1>
      <CreatingTick />
    </>
  );
}

/**
 * `/add-vault/ready?vault=<name>` — the ready beat, a real (replace-landed)
 * URL. The activation-honesty half of §4.2: the vault EXISTS but this device
 * hasn't switched to it — "Open {name} →" is the moment activation actually
 * happens (openHostedVault + the §4.4 "Now in {name}" toast), and "Maybe
 * later" quietly declines with nothing to undo.
 */
export function AddVaultReady() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const name = searchParams.get("vault") ?? "";
  // ?first=1 rides along from the onboarding create: with no prior vault
  // there's nothing worth staying in, so "Maybe later" is absent (§4.2).
  const first = searchParams.get("first") === "1";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A ready URL without a vault name is malformed (hand-typed / mangled
  // link) — nothing honest to offer. NAVIGATION.md: (a) redirect shim —
  // replace to the chooser.
  if (!name) return <Navigate to="/add-vault" replace />;

  async function handleOpen() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // NOW the switch happens — a fresh C3 mint stores + activates the
      // vault (same path as every other hosted open).
      await openHostedVault(name);
      // §4.4 switch-confirmation: every active-vault change announces.
      announceVaultSwitch(name);
      // NAVIGATION.md: "Ready 'Open {name} →' → /" — user-initiated, push.
      // Back from Home returns here; harmless, and Open again is a no-op
      // switch (openHostedVault re-mints the same vault).
      navigate("/");
    } catch (err) {
      setBusy(false);
      // F12 — friendly copy, never a raw wire code.
      setError(describeAccountError(err, "Couldn't open your vault. Try again."));
    }
  }

  return (
    <WizardShell
      // "Maybe later" — declining IS the exit (§4.1): history-aware, lands
      // back where the ceremony was entered from; NO switch, NO toast — the
      // active vault is untouched, so every page behind is still true.
      // Absent in first-run onboarding (no prior vault worth staying in) —
      // there the linked wordmark remains the quiet way out.
      escape={first ? { kind: "none" } : { kind: "maybe-later", to: "/" }}
      progress={{ labels: PROGRESS_LABELS, current: 2 }}
    >
      <ParachuteMark size={90} className="mx-auto mb-6 fade-up" />
      <p className="eyebrow mb-3">Ready</p>
      <h1 className="hero-title mb-3" style={{ fontSize: "clamp(1.8rem, 4vw, 2.3rem)" }}>
        {name} is <span className="accent-word">ready.</span>
      </h1>
      <p className="mx-auto mb-8 max-w-sm text-fg-muted">
        Everything inside is yours. Open format. Export anytime.
      </p>
      {error ? (
        <p className="mx-auto mb-6 max-w-sm rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={handleOpen}
        disabled={busy}
        className="btn btn-primary btn-lg justify-center rounded-full px-6 shadow-soft"
      >
        {busy ? "Opening…" : `Open ${name} →`}
      </button>
    </WizardShell>
  );
}
