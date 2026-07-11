import { ParachuteMark } from "@/components/ParachuteMark";
import { WizardShell } from "@/components/WizardShell";
import { getSession, listVaults } from "@/lib/account/client";
import { classifyVaults } from "@/lib/account/dispatch";
import { openHostedVault } from "@/lib/account/hosted-vault";
import { formatUsageBytes } from "@/lib/account/provenance";
import type { AccountVault } from "@/lib/account/types";
import { announceVaultSwitch } from "@/lib/vault/switch";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";

type Stage =
  | { kind: "checking" }
  | { kind: "redirect" }
  | { kind: "net-error"; message: string }
  | { kind: "first-vault" }
  | { kind: "welcome-back"; email?: string; vault: AccountVault; error?: string }
  | { kind: "picker"; email?: string; vaults: AccountVault[] };

// The post-sign-in dispatcher (`/welcome`, SYNTHESIS #4) — where a fresh
// magic-link click lands (Landing sets `next=/welcome`). Confirms the
// session, shows the "Signing you in…" beat while it lists the account's
// vaults, then branches by count (`classifyVaults`): none → the creation
// ceremony's onboarding form (`/add-vault/create?first=1`, W2-6 §4.2); one →
// the welcome-back beat (#7) → Home; many → the picker (#8), which renders in
// place.
//
// SLIMMED IN W2-6: the naming/creating/ready beats moved out to their own
// stepped URLs (AddVaultCreate.tsx). `?new=1` — the old same-route naming
// variant — is now a plain shim to `/add-vault/create`. `?pick=1` (F13) still
// forces the picker (AddVaultChooser's "Open" card).
export function Welcome() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [stage, setStage] = useState<Stage>({ kind: "checking" });
  const [runId, setRunId] = useState(0);
  // Guard the dispatch against redundant re-runs — keyed on BOTH the retry
  // counter AND the URL params (not `runId` alone). The params matter because
  // the picker fork is URL-addressable (`/welcome` vs `?pick=1`): a browser
  // POP that only changes the params MUST re-dispatch so the fork re-syncs to
  // the URL instead of stranding a stale stage — the F7 same-route failure
  // W2-2 fixed (its review). Preserved through the W2-6 slimming.
  const processedKey = useRef<string | null>(null);
  const welcomeBackRan = useRef<string | null>(null);
  // `?new=1` — the pre-W2-6 add-vault naming entry. Handled as a pure shim in
  // render (below); the dispatch effect must not race it.
  const wantsAddVault = searchParams.get("new") === "1";

  // The dispatch: confirm the session, then branch on vault count. Re-runs on
  // a retry (`runId` bump — the net-error card's "Try again") OR a URL-param
  // change (a POP between param variants). A network failure confirming the
  // session degrades to the front door, mirroring `resolveBoot`'s own
  // degrade-on-failure (a signed-out-looking state is the safe default — the
  // person can still act from there).
  useEffect(() => {
    if (wantsAddVault) return; // the ?new=1 shim renders instead
    const dispatchKey = `${runId}|${searchParams.toString()}`;
    if (processedKey.current === dispatchKey) return;
    processedKey.current = dispatchKey;
    // A re-dispatch triggered by a param POP arrives with a STALE stage —
    // reset to the transient beat so the async below repaints the correct
    // fork instead of flashing the previous screen. No-op on first mount
    // (already "checking").
    setStage((prev) => (prev.kind === "checking" ? prev : { kind: "checking" }));
    // F13 — AddVaultChooser's "Open" card links here with `?pick=1` to force
    // the picker even when the account has exactly one vault. Without this,
    // classifyVaults' welcome-back auto-open silently reopens the vault the
    // person is likely already in — "open a vault not on this device" would
    // otherwise be a no-op bounce back to where they started.
    const wantsPicker = searchParams.get("pick") === "1";

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
        if (wantsPicker && vaults.length > 0) {
          setStage({ kind: "picker", email: session.email, vaults });
          return;
        }
        const branch = classifyVaults(vaults);
        if (branch.kind === "first-vault") {
          setStage({ kind: "first-vault" });
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
  }, [runId, searchParams, wantsAddVault]);

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
        // §4.4 switch-confirmation — the auto-open changes the active vault,
        // so it announces too (the toast renders after landing).
        announceVaultSwitch(vaultName);
        // NAVIGATION.md: (d) the single post-auth landing — replace.
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

  // NAVIGATION.md: (a) redirect shim — `/welcome?new=1` (the pre-W2-6 naming
  // entry: old bookmarks, stale UI) → the creation ceremony's own URL.
  if (wantsAddVault) return <Navigate to="/add-vault/create" replace />;

  switch (stage.kind) {
    case "checking":
      return <SigningInBeat />;
    case "redirect":
      // Preserve the expired-link cue: cloud 302s a dead/used link to
      // /welcome?link=expired, but the recovery UI lives on the front door
      // (Landing reads ?link=expired). Carry the param through the redirect.
      // NAVIGATION.md: (b) one-shot param carry-through — replace.
      return (
        <Navigate to={searchParams.get("link") === "expired" ? "/?link=expired" : "/"} replace />
      );
    case "first-vault":
      // NAVIGATION.md: (c) the dispatcher is transient — replace. The
      // onboarding naming form owns the rest of the ceremony (§4.2).
      return <Navigate to="/add-vault/create?first=1" replace />;
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
            // §4.4 switch-confirmation: "Now in {vault}".
            announceVaultSwitch(vault.name);
            // NAVIGATION.md: "Picker: user picks a vault → /" — user-
            // initiated, push. Back to the picker is harmless and useful.
            navigate("/");
          }}
          onCreateNew={() => {
            // NAVIGATION.md: "Picker: '＋ Create a new vault' →
            // /add-vault/create" — user-initiated, push. The naming form is
            // its own route now (W2-6), so this is a plain cross-route hop —
            // no same-route stage juggling.
            navigate("/add-vault/create");
          }}
        />
      );
    default:
      return null;
  }
}

function SigningInBeat() {
  return (
    // §4.1: an auto-advancing beat (<3s) — escape "none" is legal here; the
    // linked wordmark stays as the always-on way out.
    <WizardShell escape={{ kind: "none" }}>
      <ParachuteMark size={72} className="mx-auto mb-4 animate-pulse" />
      <p className="eyebrow mb-3">One moment</p>
      <h1 className="hero-title mb-2" style={{ fontSize: "clamp(1.8rem, 4vw, 2.3rem)" }}>
        Signing you <span className="accent-word">in…</span>
      </h1>
      <output aria-live="polite" className="font-round text-sm text-fg-muted">
        Checking your vaults…
      </output>
    </WizardShell>
  );
}

// SYNTHESIS #12 — signed in, but the vault list couldn't be fetched. This one
// can stall (it waits on the person), so it carries the §4.1 escape.
function NetErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <WizardShell escape={{ kind: "back", to: "/" }}>
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
    </WizardShell>
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
      // The failure state stalls — it gets the escape the auto-beat doesn't
      // need (§4.1 rule 2).
      <WizardShell escape={{ kind: "back", to: "/" }}>
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
      </WizardShell>
    );
  }
  return (
    // §4.1: auto-advancing beat — escape "none".
    <WizardShell escape={{ kind: "none" }}>
      <ParachuteMark size={76} className="mx-auto mb-4 animate-pulse" />
      <p className="eyebrow mb-3">Welcome back</p>
      <h1 className="hero-title mb-3" style={{ fontSize: "clamp(1.8rem, 4vw, 2.1rem)" }}>
        Opening <span className="accent-word">{vaultName}…</span>
      </h1>
      <output aria-live="polite" className="mx-auto max-w-sm text-fg-muted">
        Signed in as {email ?? "you"} — opening {vaultName}…
      </output>
    </WizardShell>
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

// SYNTHESIS #8 — the picker: many vaults, every card verb is Open. It stalls
// (a decision screen), so it carries the §4.1 escape: history-aware back with
// the front door as the deep-link fallback.
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
    <WizardShell wide escape={{ kind: "back", to: "/" }}>
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
          style={{ color: "var(--color-sky)" }}
        >
          Connect a self-hosted vault
        </Link>
      </p>
    </WizardShell>
  );
}
