import { ParachuteMark, Wordmark } from "@/components/ParachuteMark";
import { getSession, listVaults } from "@/lib/account/client";
import { getDoorDescriptor } from "@/lib/account/descriptor";
import { classifyVaults } from "@/lib/account/dispatch";
import { createHostedVault, openHostedVault } from "@/lib/account/hosted-vault";
import { formatUsageBytes } from "@/lib/account/provenance";
import type { AccountVault } from "@/lib/account/types";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";

// Door-agnostic: the app never hardcodes a cloud vault host. A vault's real
// address comes from the door (the `address` field on `GET /account/vaults`);
// the pre-creation naming screen can't know the host yet (the home door assigns
// it at mint time), so the echo shows the slug + the permanent-address promise
// without asserting a specific host UNLESS the door descriptor advertises a
// `vault_url_template` (HUB-PARITY P4) — then the echo substitutes the typed
// name into it. Preview-only: the real, post-creation address always comes
// from the create/list responses, never from this template.
function sanitizeVaultName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

// The vault-naming context: onboarding (first vault, right after account
// creation) vs. addvault (an ADDITIONAL vault, reached from the picker's
// "＋ Create a new vault" today, and — later — a dedicated add-vault chooser,
// SYNTHESIS #10). Both share the exact same form; only the eyebrow/H1/sub
// copy differ.
type NamingCtx = "onboarding" | "addvault";

/** What the naming form needs to render again if creation fails. */
interface NamingBack {
  ctx: NamingCtx;
  email?: string;
  existingName?: string;
}

type Stage =
  | { kind: "checking" }
  | { kind: "redirect" }
  | { kind: "net-error"; message: string }
  | (NamingBack & { kind: "naming"; attemptedName?: string; error?: string })
  | { kind: "creating"; name: string; ready: boolean; error?: string; back: NamingBack }
  | { kind: "welcome-back"; email?: string; vault: AccountVault; error?: string }
  | { kind: "picker"; email?: string; vaults: AccountVault[] };

// The post-sign-in dispatcher (`/welcome`, SYNTHESIS #4) — where a fresh
// magic-link click lands (Landing sets `next=/welcome`). Confirms the
// session, shows the "Signing you in…" beat while it lists the account's
// vaults, then branches by count (`classifyVaults`): none → first-vault
// naming (#5) → the creation beat (#6) → Home; one → the welcome-back beat
// (#7) → Home; many → the picker (#8).
//
// ADD-VAULT NAMING VARIANT (SYNTHESIS #10): the SAME naming form, reached to
// create an ADDITIONAL vault, is triggered by `?new=1` on this route. A fresh
// navigation to `/welcome?new=1` (bookmark, reload, or a future dedicated
// add-vault chooser screen linking in) mounts this component fresh, so the
// dispatch effect below reads the param and routes straight to the naming
// form in "addvault" context (skipping the classify branch) once the vaults
// are in. The picker's own "＋ Create a new vault" row is the one caller that
// does NOT remount (it's already on this route) — it keeps the URL in sync
// via `navigate(..., { replace: true })` for back-button/bookmark honesty,
// but transitions `stage` directly (no refetch needed; it already has the
// vault list in hand).
export function Welcome() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [stage, setStage] = useState<Stage>({ kind: "checking" });
  const [runId, setRunId] = useState(0);
  const processedRunId = useRef(-1);
  const creatingRan = useRef<string | null>(null);
  const welcomeBackRan = useRef<string | null>(null);

  // The dispatch: confirm the session, then branch on vault count. Re-run by
  // bumping `runId` (the net-error card's "Try again"); a network failure
  // confirming the session degrades to the front door, mirroring
  // `resolveBoot`'s own degrade-on-failure (a signed-out-looking state is the
  // safe default — the person can still act from there).
  useEffect(() => {
    if (processedRunId.current === runId) return;
    processedRunId.current = runId;
    const wantsAddVault = searchParams.get("new") === "1";

    (async () => {
      let session: Awaited<ReturnType<typeof getSession>>;
      try {
        session = await getSession();
      } catch {
        setStage({ kind: "redirect" });
        return;
      }
      if (!session.signed_in) {
        setStage({ kind: "redirect" });
        return;
      }

      try {
        const { vaults } = await listVaults();
        if (wantsAddVault && vaults.length > 0) {
          setStage({
            kind: "naming",
            ctx: "addvault",
            email: session.email,
            existingName: vaults[0]?.name,
          });
          return;
        }
        const branch = classifyVaults(vaults);
        if (branch.kind === "first-vault") {
          setStage({ kind: "naming", ctx: "onboarding", email: session.email });
        } else if (branch.kind === "welcome-back") {
          setStage({ kind: "welcome-back", email: session.email, vault: branch.vault });
        } else {
          setStage({ kind: "picker", email: session.email, vaults: branch.vaults });
        }
      } catch (err) {
        setStage({
          kind: "net-error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    })();
  }, [runId, searchParams]);

  // The creation beat (SYNTHESIS #6): fires once per attempted name. Mints
  // the vault (which also opens it — createHostedVault composes
  // openHostedVault — so it's already the active local vault by the time
  // "ready" shows). A failure returns to the naming form with the typed name
  // preserved so the person can fix a typo rather than retype it.
  useEffect(() => {
    if (stage.kind !== "creating" || stage.ready || stage.error) return;
    if (creatingRan.current === stage.name) return;
    creatingRan.current = stage.name;
    const { name, back } = stage;
    (async () => {
      try {
        // The account bearer is minted + cached inside the client (the dispatch
        // above already confirmed the session), so no csrf is threaded here.
        await createHostedVault(name);
        setStage((prev) =>
          prev.kind === "creating" && prev.name === name ? { ...prev, ready: true } : prev,
        );
      } catch (err) {
        creatingRan.current = null;
        setStage({
          kind: "naming",
          ...back,
          attemptedName: name,
          error:
            err instanceof Error
              ? err.message
              : "Couldn't create your vault. Try a different name.",
        });
      }
    })();
  }, [stage]);

  // The welcome-back beat (SYNTHESIS #7): auto-opens the account's one vault,
  // then lands Home. The beat IS the "you signed in, not up" statement — no
  // button, just the moment passing.
  useEffect(() => {
    if (stage.kind !== "welcome-back" || stage.error) return;
    if (welcomeBackRan.current === stage.vault.name) return;
    welcomeBackRan.current = stage.vault.name;
    const vaultName = stage.vault.name;
    (async () => {
      try {
        await openHostedVault(vaultName);
        navigate("/", { replace: true });
      } catch (err) {
        welcomeBackRan.current = null;
        setStage((prev) =>
          prev.kind === "welcome-back" && prev.vault.name === vaultName
            ? { ...prev, error: err instanceof Error ? err.message : "Couldn't open your vault." }
            : prev,
        );
      }
    })();
  }, [stage, navigate]);

  switch (stage.kind) {
    case "checking":
      return <SigningInBeat />;
    case "redirect":
      // Preserve the expired-link cue: cloud 302s a dead/used link to
      // /welcome?link=expired, but the recovery UI lives on the front door
      // (Landing reads ?link=expired). Carry the param through the redirect.
      return (
        <Navigate to={searchParams.get("link") === "expired" ? "/?link=expired" : "/"} replace />
      );
    case "net-error":
      return (
        <NetErrorCard
          message={stage.message}
          onRetry={() => {
            setStage({ kind: "checking" });
            setRunId((n) => n + 1);
          }}
        />
      );
    case "naming":
      return (
        <VaultNamingForm
          ctx={stage.ctx}
          email={stage.email}
          existingName={stage.existingName}
          initialName={stage.attemptedName}
          error={stage.error}
          onCreate={(name) =>
            setStage({
              kind: "creating",
              name,
              ready: false,
              back: { ctx: stage.ctx, email: stage.email, existingName: stage.existingName },
            })
          }
        />
      );
    case "creating":
      return (
        <CreationBeatView
          name={stage.name}
          ready={stage.ready}
          error={stage.error}
          onOpen={() => navigate("/", { replace: true })}
          onRetry={() => setStage({ kind: "naming", ...stage.back })}
        />
      );
    case "welcome-back":
      return (
        <WelcomeBackBeat
          email={stage.email}
          vaultName={stage.vault.name}
          error={stage.error}
          onRetry={() =>
            setStage((prev) =>
              prev.kind === "welcome-back" ? { ...prev, error: undefined } : prev,
            )
          }
        />
      );
    case "picker":
      return (
        <PickerView
          email={stage.email}
          vaults={stage.vaults}
          onOpenVault={async (vault) => {
            await openHostedVault(vault.name);
            navigate("/", { replace: true });
          }}
          onCreateNew={() => {
            navigate("/welcome?new=1", { replace: true });
            setStage({
              kind: "naming",
              ctx: "addvault",
              email: stage.email,
              existingName: stage.vaults[0]?.name,
            });
          }}
        />
      );
    default:
      return null;
  }
}

// The shared no-vault-yet layout — a Wordmark strip + a centered column
// (matches Landing.tsx / CheckEmail.tsx exactly, since desktop's Rail spine
// doesn't show without a vault).
function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col">
      <div className="flex items-center px-6 pt-6 sm:px-10">
        <Wordmark />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <div className={`mx-auto w-full ${wide ? "max-w-xl" : "max-w-md"}`}>{children}</div>
      </div>
    </div>
  );
}

// The "✓ Signed in as X" chip (SYNTHESIS #5 / #10) — the tell-don't-ask
// statement that opens every post-sign-in screen once we know who they are.
function SignedInChip({ email }: { email?: string }) {
  if (!email) return null;
  return (
    <p className="chip mb-4 inline-flex border-grass/40 bg-grass-soft text-grass-ink">
      <span aria-hidden="true">✓</span>&nbsp;Signed in as {email}
    </p>
  );
}

function SigningInBeat() {
  return (
    <Shell>
      <ParachuteMark size={72} className="mx-auto mb-4 animate-pulse" />
      <p className="eyebrow mb-3">One moment</p>
      <h1 className="hero-title mb-2" style={{ fontSize: "clamp(1.8rem, 4vw, 2.3rem)" }}>
        Signing you <span className="accent-word">in…</span>
      </h1>
      <output aria-live="polite" className="font-round text-sm text-fg-muted">
        Checking your vaults…
      </output>
    </Shell>
  );
}

// SYNTHESIS #12 — signed in, but the vault list couldn't be fetched.
function NetErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Shell>
      <ParachuteMark size={56} className="mx-auto mb-6" />
      <p className="eyebrow mb-3">Almost there</p>
      <h1 className="hero-title mb-4" style={{ fontSize: "clamp(1.8rem, 4vw, 2.2rem)" }}>
        You're signed in — we just couldn't fetch your <span className="accent-word">vaults.</span>
      </h1>
      <p className="mx-auto mb-6 max-w-sm text-fg-muted">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="btn btn-primary btn-lg justify-center rounded-full px-6 shadow-soft"
      >
        Try again
      </button>
    </Shell>
  );
}

// The shared naming form (SYNTHESIS #5 first-vault / #10 add-vault). ONE
// form, two copy contexts — no "skip", no "you can change it later": the
// name is the immutable slug, so that copy would be a lie.
function VaultNamingForm({
  ctx,
  email,
  existingName,
  initialName,
  error,
  onCreate,
}: {
  ctx: NamingCtx;
  email?: string;
  existingName?: string;
  initialName?: string;
  error?: string;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState(() => sanitizeVaultName(initialName ?? ""));
  const [vaultUrlTemplate, setVaultUrlTemplate] = useState<string | null>(null);
  const trimmed = name.trim();
  const isAdd = ctx === "addvault";

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
    <Shell>
      <ParachuteMark size={60} className="mx-auto mb-6 drop-in" />
      <SignedInChip email={email} />
      <p className="eyebrow mb-3">{isAdd ? "Adding a vault" : "Account created ✓"}</p>
      <h1 className="hero-title mb-4">
        {isAdd ? "Let's make your new" : "Let's make your first"}{" "}
        <span className="accent-word">vault.</span>
      </h1>
      <p className="mx-auto mb-8 max-w-md text-lg leading-relaxed text-fg-muted">
        {isAdd ? (
          <>
            This one's separate from{" "}
            <b className="font-semibold text-fg">{existingName ?? "your other vault"}</b> — its own
            private space, nothing shared.
          </>
        ) : (
          <>
            A vault is the private home for your notes — any AI you invite can read it, always yours
            to export. <b className="font-semibold text-fg">This creates a brand-new, empty one.</b>
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
    </Shell>
  );
}

const CREATING_TICKS = ["Setting up your vault…", "Preparing your keys…", "Almost there…"];

// Cosmetic-only ticking status text — cycles on its own timer while the real
// createHostedVault() call (owned by the parent) is in flight; doesn't gate
// anything, so a fast network just shows the first tick briefly.
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

// SYNTHESIS #6 — the creation beat: "Making a place for X…" → ticks →
// "X is ready." → [Open my vault →] → Home.
function CreationBeatView({
  name,
  ready,
  error,
  onOpen,
  onRetry,
}: {
  name: string;
  ready: boolean;
  error?: string;
  onOpen: () => void;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <Shell>
        <ParachuteMark size={60} className="mx-auto mb-6" />
        <p className="eyebrow mb-3">Couldn't create it</p>
        <h1 className="hero-title mb-4" style={{ fontSize: "clamp(1.6rem, 3.5vw, 2.1rem)" }}>
          Something went <span className="accent-word">sideways.</span>
        </h1>
        <p className="mx-auto mb-6 max-w-sm text-fg-muted">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="btn btn-primary btn-lg justify-center rounded-full px-6 shadow-soft"
        >
          Try again
        </button>
      </Shell>
    );
  }
  if (ready) {
    return (
      <Shell>
        <ParachuteMark size={90} className="mx-auto mb-6 fade-up" />
        <p className="eyebrow mb-3">Ready</p>
        <h1 className="hero-title mb-3" style={{ fontSize: "clamp(1.8rem, 4vw, 2.3rem)" }}>
          {name} is <span className="accent-word">ready.</span>
        </h1>
        <p className="mx-auto mb-8 max-w-sm text-fg-muted">
          Everything inside is yours. Open format. Export anytime.
        </p>
        <button
          type="button"
          onClick={onOpen}
          className="btn btn-primary btn-lg justify-center rounded-full px-6 shadow-soft"
        >
          Open my vault →
        </button>
      </Shell>
    );
  }
  return (
    <Shell>
      <ParachuteMark size={96} className="mx-auto mb-6 animate-pulse" />
      <h1 className="hero-title mb-3" style={{ fontSize: "clamp(1.6rem, 3.5vw, 1.9rem)" }}>
        Making a place for <span className="accent-word">{name}…</span>
      </h1>
      <CreatingTick />
    </Shell>
  );
}

// SYNTHESIS #7 — welcome back, one vault: an auto beat, then Home.
function WelcomeBackBeat({
  email,
  vaultName,
  error,
  onRetry,
}: {
  email?: string;
  vaultName: string;
  error?: string;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <Shell>
        <ParachuteMark size={60} className="mx-auto mb-6" />
        <p className="eyebrow mb-3">One moment</p>
        <h1 className="hero-title mb-4" style={{ fontSize: "clamp(1.6rem, 3.5vw, 2.1rem)" }}>
          Couldn't open <span className="accent-word">{vaultName}.</span>
        </h1>
        <p className="mx-auto mb-6 max-w-sm text-fg-muted">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="btn btn-primary btn-lg justify-center rounded-full px-6 shadow-soft"
        >
          Try again
        </button>
      </Shell>
    );
  }
  return (
    <Shell>
      <ParachuteMark size={76} className="mx-auto mb-4 animate-pulse" />
      <p className="eyebrow mb-3">Welcome back</p>
      <h1 className="hero-title mb-3" style={{ fontSize: "clamp(1.8rem, 4vw, 2.1rem)" }}>
        Opening <span className="accent-word">{vaultName}…</span>
      </h1>
      <output aria-live="polite" className="mx-auto max-w-sm text-fg-muted">
        Signed in as {email ?? "you"} — opening {vaultName}…
      </output>
    </Shell>
  );
}

function VaultCard({
  vault,
  busy,
  onOpen,
}: {
  vault: AccountVault;
  busy: boolean;
  onOpen: () => void;
}) {
  const usage = formatUsageBytes(vault.usage);
  // The door provides the vault's real URL (cloud's field is `url`); never
  // fabricate a cloud host.
  const address = vault.url ? vault.url.replace(/^https?:\/\//, "") : "";
  return (
    <li className="card flex items-center gap-4 rounded-2xl p-4 shadow-soft">
      <span
        aria-hidden="true"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-grass-soft text-base"
      >
        🌱
      </span>
      <div className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-serif text-lg text-fg">{vault.name}</span>
          <span className="chip">☁ Cloud</span>
        </div>
        {address ? <p className="mt-0.5 truncate note-id">{address}</p> : null}
        {usage ? <p className="mt-0.5 font-round text-xs text-fg-muted">{usage}</p> : null}
      </div>
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        className="btn btn-primary btn-touch shrink-0 rounded-full"
      >
        {busy ? "Opening…" : "Open →"}
      </button>
    </li>
  );
}

// SYNTHESIS #8 — the picker: many vaults, every card verb is Open.
function PickerView({
  email,
  vaults,
  onOpenVault,
  onCreateNew,
}: {
  email?: string;
  vaults: AccountVault[];
  onOpenVault: (vault: AccountVault) => Promise<void>;
  onCreateNew: () => void;
}) {
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen(vault: AccountVault) {
    if (busyName) return;
    setBusyName(vault.name);
    setError(null);
    try {
      await onOpenVault(vault);
    } catch (err) {
      setBusyName(null);
      setError(err instanceof Error ? err.message : "Couldn't open that vault.");
    }
  }

  return (
    <Shell wide>
      <ParachuteMark size={56} className="mx-auto mb-6" />
      <p className="eyebrow mb-3">Which vault</p>
      <h1 className="hero-title mb-3" style={{ fontSize: "clamp(1.8rem, 4vw, 2.4rem)" }}>
        Which vault <span className="accent-word">today?</span>
      </h1>
      <p className="mx-auto mb-8 max-w-sm text-fg-muted">
        Signed in as {email ?? "you"} · {vaults.length} vault{vaults.length === 1 ? "" : "s"} on
        Cloud
      </p>

      <ul className="mx-auto flex max-w-md flex-col gap-3">
        {vaults.map((vault) => (
          <VaultCard
            key={vault.name}
            vault={vault}
            busy={busyName === vault.name}
            onOpen={() => handleOpen(vault)}
          />
        ))}
      </ul>

      {error ? (
        <p className="mx-auto mt-6 max-w-sm rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <p className="mt-8 font-round text-sm text-fg-muted">
        <button
          type="button"
          onClick={onCreateNew}
          className="font-semibold text-accent hover:underline"
        >
          ＋ Create a new vault
        </button>{" "}
        ·{" "}
        <Link
          to="/add"
          className="font-semibold hover:underline"
          style={{ color: "var(--color-sage)" }}
        >
          Connect a self-hosted vault
        </Link>
      </p>
    </Shell>
  );
}
