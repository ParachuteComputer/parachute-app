import { Wordmark } from "@/components/ParachuteMark";
import { useHistoryAwareBack } from "@/lib/nav/history";
import type { ReactNode } from "react";

/**
 * The ONE ceremony chrome (DESIGN-SPEC §4.1, F6) — every full-screen ceremony
 * step (Welcome beats + picker, AddVaultChooser, AddVaultCreate/Ready,
 * AddVault, CheckEmail, OAuthCallback) renders inside this shell instead of
 * its own local copy. The rules, verbatim from the spec:
 *
 * 1. The Wordmark is a LINK (active vault → `/` Today; signed out → `/` front
 *    door) — with no active vault these screens have no Rail/Header chrome,
 *    so the wordmark must never be a dead `<span>`.
 * 2. A quiet escape on every step — "← Back" when a prior step exists,
 *    "Maybe later" when declining is the exit. `escape: none` is legal ONLY
 *    for beats that auto-advance in <3s (SigningIn, WelcomeBack,
 *    OAuthCallback's working beat, the creating tick).
 * 3. Segmented progress renders ONLY on the creation ceremony
 *    (`Name · Making it · Ready`) — the sign-in arc's step count isn't
 *    knowable at check-email time, and an honest bar beats a lying one.
 * 4. Calm, no-spinner transition copy (the CreatingTick pattern) — the shell
 *    never adds a spinner.
 * 5. No app chrome noise — the AGPL footer is gated off ceremony routes in
 *    App.tsx (F21).
 */
export type WizardEscape =
  | { kind: "back"; to: string; label?: string }
  | { kind: "maybe-later"; to: string; label?: string }
  | { kind: "none" };

export interface WizardShellProps {
  children: ReactNode;
  wide?: boolean;
  /** Every step MUST have an escape unless it auto-advances in <3s. */
  escape?: WizardEscape;
  /** Segmented progress — ONLY the creation ceremony qualifies (§4.1 rule 3). */
  progress?: { labels: string[]; current: number };
}

export function WizardShell({
  children,
  wide = false,
  // Destructure-renamed only to avoid shadowing the (deprecated) global
  // `escape` — the PROP keeps the spec's name.
  escape: escapeProp,
  progress,
}: WizardShellProps) {
  const hasEscape = escapeProp !== undefined && escapeProp.kind !== "none";
  // Both escape kinds are HISTORY-AWARE (NAVIGATION.md § "The history-aware
  // escape rule"): prefer the entry the person actually came from, fall back
  // to `to` when there's nothing behind (deep link, magic-link tab). A hard
  // `<Link to>` here would PUSH the guessed target on top of the ceremony —
  // Back would then loop into the step just escaped.
  const escapeBack = useHistoryAwareBack(hasEscape ? escapeProp.to : "/");
  const escapeControl = hasEscape ? (
    <button
      type="button"
      onClick={escapeBack}
      className="focus-ring font-round text-sm text-fg-dim hover:text-accent"
    >
      {escapeProp.label ?? (escapeProp.kind === "back" ? "← Back" : "Maybe later")}
    </button>
  ) : null;

  return (
    <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col">
      <div className="flex items-center justify-between px-6 pt-6 sm:px-10">
        <Wordmark />
        {/* "← Back" lives in the top strip (a prior step exists — the corner
            is where back belongs); "Maybe later" renders under the content
            (declining is a decision made NEXT TO the primary action, the
            prototype's "Skip for now" placement). */}
        {escapeProp?.kind === "back" ? escapeControl : null}
      </div>
      {progress ? <WizardProgress labels={progress.labels} current={progress.current} /> : null}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <div className={`mx-auto w-full ${wide ? "max-w-2xl" : "max-w-md"}`}>
          {children}
          {escapeProp?.kind === "maybe-later" ? <p className="mt-6">{escapeControl}</p> : null}
        </div>
      </div>
    </div>
  );
}

// The prototype's pill-and-dots step bar (prototype-shots/01–09), 3-segment
// version: completed = sage dot, current = an elongated accent pill, upcoming
// = hairline dot. Labels ride along for AT only — the visual stays quiet.
function WizardProgress({ labels, current }: { labels: string[]; current: number }) {
  return (
    <ol
      aria-label={`Step ${current + 1} of ${labels.length}: ${labels[current] ?? ""}`}
      className="mt-5 flex items-center justify-center gap-2"
    >
      {labels.map((label, i) => (
        <li
          key={label}
          aria-current={i === current ? "step" : undefined}
          className={
            i === current
              ? "h-1.5 w-7 rounded-full bg-accent"
              : i < current
                ? "h-1.5 w-1.5 rounded-full bg-sage"
                : "h-1.5 w-1.5 rounded-full bg-border"
          }
        >
          <span className="sr-only">{label}</span>
        </li>
      ))}
    </ol>
  );
}
