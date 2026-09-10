import { ParachuteMark, Wordmark } from "@/components/ParachuteMark";
import { getSession, logout, requestMagicLink } from "@/lib/account/client";
import {
  type DoorDescriptor,
  getDoorDescriptor,
  peekDoorDescriptor,
  retryDoorDescriptorIfCold,
} from "@/lib/account/descriptor";
import { openHostedVault } from "@/lib/account/hosted-vault";
import { clearAccountToken, loadLastSigninEmail, saveLastSigninEmail } from "@/lib/account/store";
import type { AccountVault, DoorPlan } from "@/lib/account/types";
import { withMount } from "@/lib/base-url";
import { beginOAuth } from "@/lib/vault/oauth";
import { probeForIssuer } from "@/lib/vault/probe";
import { announceVaultSwitch } from "@/lib/vault/switch";
import { safeInternalRedirect, withReturnTo } from "@/lib/vault/url";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

/** Where a completed sign-in returns (the post-sign-in dispatcher) — the app-
 *  relative route; the ceremony-hop `next` mount-prefixes this (see
 *  `FrontDoor`'s password branch), the magic-link path passes it bare (cloud
 *  is same-origin root-mounted today). */
const SIGNIN_NEXT = "/welcome";

export interface LandingProps {
  /** Rendered when the boot dispatcher finds a signed-in session but no vault
   *  connected on this device — the "already signed in" replacement card
   *  (SYNTHESIS #9). A signed-in person never sees a sign-in field. */
  signedIn?: { email?: string; username?: string; vaults: AccountVault[] };
  /** Net-error weather (SYNTHESIS #12): signed in, but the vault list couldn't
   *  be fetched. */
  netError?: string;
  /** Retry the boot resolution (passed by the BootGate for the net-error card). */
  onRetry?: () => void;
}

// The front door (`/`, signed-out) — SYNTHESIS #1. Not vault-naming, not a
// verb-soup chooser: one email field that does BOTH (sign in OR create), because
// magic-link resolves new-vs-returning without asking. The self-hosted side door
// is the ONE quiet alternative. Also renders the already-signed-in card (#9) and
// the net-error weather (#12) when the BootGate hands them down.
export function Landing({ signedIn, netError, onRetry }: LandingProps = {}) {
  if (signedIn) {
    return (
      <AlreadySignedIn
        email={signedIn.email}
        username={signedIn.username}
        vaults={signedIn.vaults}
      />
    );
  }
  if (netError) return <NetError message={netError} onRetry={onRetry} />;
  return <FrontDoor />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col">
      <div className="flex items-center px-6 pt-6 sm:px-10">
        <Wordmark />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <div className="mx-auto w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}

// The self-hosted side door — SYNTHESIS #1's one quiet alternative. Stays on
// BOTH front-door branches (magic-link and password), byte-identical either
// way, so it's factored out once rather than duplicated.
//
// It forwards a `?redirect=` return target when the front door was reached by a
// deep link that bounced (a logged-out `/n/<id>` — see NoteView's route guard),
// so connecting a vault lands the reader on the note they were sent. Sanitized
// by `withReturnTo`; without one the link is the plain `/add` it always was.
function SelfHostSideDoor() {
  const [params] = useSearchParams();
  return (
    <div className="mt-8 border-t border-border pt-6">
      <p className="font-round text-sm text-fg-muted">
        Self-hosting?{" "}
        <Link
          to={withReturnTo("/add", params.get("redirect"))}
          className="font-semibold hover:underline"
          style={{ color: "var(--color-sky)" }}
        >
          Connect your own vault →
        </Link>{" "}
        <span className="text-fg-dim">(your notes stay on your server)</span>
      </p>
    </div>
  );
}

type DoorKind = "hub" | "cloud" | "neutral";

// Classify the door into the front door's THREE states — the core of the
// "cloud onboarding on a hub" fix. A null / in-flight / unclassifiable
// descriptor is door-NEUTRAL, NOT cloud: cloud marketing copy is gated on a
// CONFIRMED cloud shape, never the absence of a signal.
//   - hub     — a confirmed password door (`auth` present, `magic_link` absent).
//   - cloud   — a confirmed cloud/magic-link door (`door === "cloud"` OR
//               `auth.methods` includes `magic_link`).
//   - neutral — null (initial / in-flight / fetch failed) or a descriptor we
//               can't classify (e.g. `{ door: "hub" }` with no usable auth).
export function doorKind(d: DoorDescriptor | null): DoorKind {
  if (!d) return "neutral";
  const methods = d.auth?.methods ?? [];
  if (d.auth != null && !methods.includes("magic_link")) return "hub";
  if (d.door === "cloud" || methods.includes("magic_link")) return "cloud";
  return "neutral";
}

// The upgrade-price hint travels WITH the door (Fix 3, descriptor-driven).
// Cloud's descriptor carries `plans`; a hub's is empty / omitted, so no price
// line shows. Prefer the cheapest advertised YEARLY price ("Plans from $10 a
// year"), falling back to the cheapest monthly.
export function pricingLine(plans?: DoorPlan[]): string | null {
  if (!plans || plans.length === 0) return null;
  let minYear: number | null = null;
  let minMonth: number | null = null;
  for (const p of plans) {
    const y = p.intervals?.yearly;
    if (y?.available && typeof y.price === "number" && y.price > 0) {
      minYear = minYear === null ? y.price : Math.min(minYear, y.price);
    }
    if (typeof p.price_month === "number" && p.price_month > 0) {
      minMonth = minMonth === null ? p.price_month : Math.min(minMonth, p.price_month);
    }
  }
  if (minYear !== null) return `Plans from $${minYear} a year.`;
  if (minMonth !== null) return `Plans from $${minMonth} a month.`;
  return null;
}

/** The claim we make when the door hasn't told us its trial length — the
 *  ratified campaign phrase (three months free, 2026-07-25). Kept honest by
 *  being the SAME number the door grants; when a door publishes
 *  `trial_length_label` that wins, and this is only the pre-fetch / offline /
 *  older-door path. */
const FALLBACK_TRIAL_LENGTH = "Three months";

/**
 * The trial claim — the sentence a real visitor reads at the front door, and
 * the one that has to match what the backend actually grants. `GET /signup`
 * 302s here, so THIS is the promise, not the worker's marketing page.
 *
 * Descriptor-driven for the same reason `pricingLine` is: the length is a
 * campaign number that moves, and hardcoding it in two repos is how the app
 * ended up promising 30 days over a backend granting 90. The door publishes
 * `trial_length_label` ("3 months"); we render it verbatim.
 *
 * UNTRUSTED INPUT — the guard is here rather than in `normalizeDescriptor`
 * because this is a single top-level scalar with exactly one consumer, and the
 * value goes straight into JSX: a door serving `trial_length_label: {}` would
 * throw "Objects are not valid as a React child" (white screen — the app has
 * no ErrorBoundary), and one serving a paragraph would blow out the layout.
 * Anything that isn't a short, non-empty string falls back to the literal,
 * which is honest on its own.
 */
export function trialLine(trialLengthLabel?: unknown): string {
  const label = typeof trialLengthLabel === "string" ? trialLengthLabel.trim() : "";
  const length = label && label.length <= 40 ? label : FALLBACK_TRIAL_LENGTH;
  return `${length} free, no card.`;
}

// HUB-PARITY P4 — the ONE door-conditional piece of UI the portability
// principle permits (SYNTHESIS "PORTABILITY"). Loads the door descriptor
// (`/.well-known/parachute-account`, same-origin, public) and forks into the
// three states above. The descriptor is stale-while-revalidated (durable
// per-origin cache in `descriptor.ts`): a door already KNOWN for this origin
// paints synchronously via `peekDoorDescriptor` (no neutral flash on a warm
// cache / a returning tab), the background refetch runs, and `onRevalidate`
// swaps in a changed door if it found one. Unresolved defaults to NEUTRAL —
// never cloud — so a hub whose descriptor is slow/stale/absent (and the
// surface-mount class) is never mis-onboarded into cloud.
function FrontDoor() {
  const [descriptor, setDescriptor] = useState<DoorDescriptor | null>(() => peekDoorDescriptor());

  useEffect(() => {
    let live = true;
    // A cold-boot descriptor failure pins NEUTRAL for the SPA's lifetime (the
    // revalidation runs once); a fresh front-door mount re-arms it so a transient
    // first-fetch failure self-heals here without a full reload. No-op once a
    // door is known for this origin.
    retryDoorDescriptorIfCold();
    getDoorDescriptor(undefined, (fresh) => {
      if (live) setDescriptor(fresh);
    }).then((d) => {
      if (live) setDescriptor(d);
    });
    return () => {
      live = false;
    };
  }, []);

  const kind = doorKind(descriptor);
  // `kind === "hub"` guarantees a valid password `auth` block; the extra guard
  // keeps TS honest and falls back to neutral if it's somehow absent.
  if (kind === "hub" && descriptor?.auth) {
    return <HubFrontDoor auth={descriptor.auth} signupPath={descriptor.signup_path} />;
  }
  if (kind === "cloud") {
    return (
      <MagicLinkFrontDoor
        plans={descriptor?.plans}
        trialLengthLabel={descriptor?.trial_length_label}
      />
    );
  }
  return <NeutralFrontDoor />;
}

// The door-NEUTRAL front door — rendered while the descriptor is unresolved
// (null / in-flight) or when it can't be classified. The fix's core: NO cloud
// email form, NO pricing, NO "create your account" — just the mark, the
// headline, and ONE door-agnostic "Sign in" that routes to the connect flow
// (`/add` auto-detects + prefills the serving origin). This is also what a
// surface-mount (app at `/surface/<slug>` on a descriptor-less host) gets,
// instead of being mis-onboarded into cloud.
function NeutralFrontDoor() {
  const [params] = useSearchParams();
  return (
    <Shell>
      <ParachuteMark size={60} className="mx-auto mb-6 drop-in" />
      <p className="eyebrow eyebrow-accent mb-3">Welcome</p>
      <h1 className="hero-title mb-4">
        A soft place for your thoughts to <span className="accent-word">land.</span>
      </h1>
      <p className="mx-auto mb-6 max-w-sm text-fg-muted">Sign in to your parachute.</p>
      <Link
        to={withReturnTo("/add", params.get("redirect"))}
        className="btn btn-primary btn-lg justify-center rounded-full px-6 shadow-soft"
      >
        Sign in →
      </Link>
    </Shell>
  );
}

// The magic-link front door (`/`, signed-out, cloud today) — SYNTHESIS #1.
// One email field that does BOTH (sign in OR create), because magic-link
// resolves new-vs-returning without asking. Only rendered for a CONFIRMED
// cloud/magic-link door now (never as the unresolved default), and both its
// price line AND its trial claim are descriptor-driven so the copy travels
// with the door instead of drifting from it.
function MagicLinkFrontDoor({
  plans,
  trialLengthLabel,
}: {
  plans?: DoorPlan[];
  trialLengthLabel?: string;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const expired = params.get("link") === "expired";
  const [email, setEmail] = useState(loadLastSigninEmail() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const looksLikeEmail = /.+@.+\..+/.test(email.trim());
  const plansLine = pricingLine(plans);
  const trialClaim = trialLine(trialLengthLabel);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!looksLikeEmail || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Same-origin: read the session for an (anonymous) CSRF, then request the
      // magic link as a JSON POST. The email moment stays in the app.
      const session = await getSession();
      await requestMagicLink(email.trim(), session.csrf, SIGNIN_NEXT);
      saveLastSigninEmail(email.trim());
      // NAVIGATION.md: "Landing: submit email → /check-email" — user-
      // initiated, push.
      navigate("/check-email");
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof Error
          ? `Couldn't send the link: ${err.message}`
          : "Couldn't send the link. Please try again.",
      );
    }
  }

  return (
    <Shell>
      <ParachuteMark size={60} className="mx-auto mb-6 drop-in" />
      <p className="eyebrow eyebrow-accent mb-3">Welcome</p>
      <h1 className="hero-title mb-4">
        A soft place for your thoughts to <span className="accent-word">land.</span>
      </h1>

      {expired ? (
        <p className="mx-auto mb-6 max-w-sm rounded-xl border border-sun bg-sun-soft px-4 py-3 text-sm text-sun-ink">
          That link has <span className="font-serif italic">expired.</span> No harm done — we'll
          send a fresh one.
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="mx-auto w-full max-w-sm">
        <div className="composer flex flex-col gap-3 p-4 text-left">
          <label htmlFor="email" className="eyebrow">
            Sign in or create your account
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            // biome-ignore lint/a11y/noAutofocus: the front door's single purpose is this field.
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email address"
            className="input input-on-bg"
          />
          <button
            type="submit"
            disabled={!looksLikeEmail || busy}
            className="btn btn-primary btn-lg justify-center rounded-full shadow-soft"
          >
            {busy ? "Sending your link…" : "Email me a sign-in link"}
          </button>
        </div>
      </form>

      <p className="mx-auto mt-3 max-w-sm font-round text-sm text-fg-muted">
        One link does both — if you're new, it creates your account, and the email will say so. No
        password.
      </p>
      <p className="mx-auto mt-3 max-w-sm font-round text-xs text-fg-dim">
        {trialClaim}
        {plansLine ? ` ${plansLine}` : ""}
      </p>

      {error ? (
        <p className="mx-auto mt-3 max-w-sm rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <SelfHostSideDoor />
    </Shell>
  );
}

// The hub front door (a confirmed password door) — Aaron's ratified HYBRID
// card. No email/password field lives here (the hub owns those ceremonies);
// the card names the box and offers two paths:
//   - PRIMARY, one action: "Open your parachute" — OAuth-connect at the SERVING
//     origin (its login rides inside the hub's authorize/consent), landing
//     straight in the vault. Fastest to notes. Reuses the same beginOAuth path
//     as `/add`, skipping the URL form (the serving hub IS the issuer).
//   - SECONDARY, quiet: "Manage this parachute" — the account-manager ceremony
//     hop (hub `/login?next=…` → account session → vault manager). ONE
//     deliberate, labeled origin change, mirroring the self-host `/add` hop.
function HubFrontDoor({
  auth,
  signupPath,
}: {
  auth: NonNullable<DoorDescriptor["auth"]>;
  signupPath?: string;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [connecting, setConnecting] = useState(false);
  const host = typeof window !== "undefined" ? window.location.host : "";
  // Where to land after the connect, when a bounced deep link put us here.
  const returnTo = safeInternalRedirect(params.get("redirect"));

  async function openYourParachute() {
    if (connecting) return;
    setConnecting(true);
    try {
      // The serving hub IS the issuer — resolve it (meta-tag / same-origin /
      // loopback) exactly as `/add` does, then begin OAuth directly. No
      // hostname assumptions: everything is relative to the serving origin.
      const issuer = (await probeForIssuer(window.location.origin)) ?? window.location.origin;
      // With a return target the flow carries it on the pending state, exactly
      // as `/add?redirect=` does; without one the call shape is unchanged.
      const { authorizeUrl } = returnTo
        ? await beginOAuth(issuer, undefined, undefined, { redirect: returnTo })
        : await beginOAuth(issuer);
      window.location.assign(authorizeUrl);
    } catch {
      // Discovery / PKCE / insecure-context failure — hand off to the full
      // `/add` form, which prefills the serving origin and surfaces the
      // insecure-context remediation (and keeps the return target).
      setConnecting(false);
      navigate(withReturnTo("/add", returnTo));
    }
  }

  function manageThisParachute() {
    // MOUNT-AWARE: `next` is an in-app route, so it needs the app's own mount
    // prefix (under a hub the app serves at `/app` → `/app/welcome`).
    // `signin_path` is the DOOR's own path (the hub's `/login`) — origin-
    // rooted, NEVER mount-prefixed; it isn't an app route.
    const next = encodeURIComponent(withMount(SIGNIN_NEXT));
    window.location.assign(`${auth.signin_path}?next=${next}`);
  }

  return (
    <Shell>
      <ParachuteMark size={60} className="mx-auto mb-6 drop-in" />
      <p className="eyebrow eyebrow-accent mb-3">Welcome</p>
      <h1 className="hero-title mb-4">
        A soft place for your thoughts to <span className="accent-word">land.</span>
      </h1>

      <p className="mx-auto mb-6 max-w-sm text-fg-muted">
        Sign in to <span className="font-semibold text-fg">{host || "your parachute"}</span>.
      </p>

      <button
        type="button"
        onClick={openYourParachute}
        disabled={connecting}
        className="btn btn-primary btn-lg justify-center rounded-full px-6 shadow-soft"
      >
        {connecting ? "Opening…" : "Open your parachute →"}
      </button>

      <p className="mx-auto mt-6 max-w-sm font-round text-sm text-fg-muted">
        <button
          type="button"
          onClick={manageThisParachute}
          className="font-semibold hover:underline"
          style={{ color: "var(--color-sky)" }}
        >
          Manage this parachute →
        </button>
      </p>

      {signupPath ? (
        <p className="mx-auto mt-3 max-w-sm font-round text-sm text-fg-muted">
          New here?{" "}
          <a
            href={signupPath}
            className="font-semibold hover:underline"
            style={{ color: "var(--color-sky)" }}
          >
            Create your account →
          </a>
        </p>
      ) : (
        <p className="mx-auto mt-3 max-w-sm font-round text-xs text-fg-dim">
          Accounts on this parachute are created by its operator.
        </p>
      )}

      <SelfHostSideDoor />
    </Shell>
  );
}

// SYNTHESIS #9 — a signed-in person who lands on `/` directly. The form is
// REPLACED by an explicit card; no auto-advance (they came here on purpose).
function AlreadySignedIn({
  email,
  username,
  vaults,
}: {
  email?: string;
  username?: string;
  vaults: AccountVault[];
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const one = vaults.length === 1 ? vaults[0] : null;
  // A deep link that bounced here (signed in, but the vault wasn't on THIS
  // device yet) — opening the vault is the whole reason the link failed, so
  // land on the note rather than the default `/`.
  const returnTo = safeInternalRedirect(params.get("redirect"));

  async function open() {
    if (!one || busy) return;
    setBusy(true);
    try {
      // The account bearer is minted + cached inside the client; no csrf needed.
      await openHostedVault(one.name);
      // §4.4 switch-confirmation: "Now in {vault}".
      announceVaultSwitch(one.name);
      // NAVIGATION.md: "Landing 'already signed in' card: Open {vault} → /"
      // — user-initiated, push.
      navigate(returnTo ?? "/");
    } catch {
      // NAVIGATION.md: (c) fall back to the dispatcher, which surfaces
      // weather — re-entering a transient screen, not a new place, so
      // replace.
      navigate("/welcome", { replace: true });
    }
  }

  async function signOut() {
    try {
      const session = await getSession();
      await logout(session.csrf);
    } finally {
      clearAccountToken();
      // NAVIGATION.md: "Sign out → /" — replace; the session context is
      // gone, so Back into a signed-in page would lie.
      navigate("/", { replace: true });
      // A hard reload re-runs the boot dispatcher cleanly against the now
      // signed-out session.
      window.location.assign("/");
    }
  }

  return (
    <Shell>
      <ParachuteMark size={56} className="mx-auto mb-6" />
      <p className="eyebrow eyebrow-accent mb-3">Signed in</p>
      <h1 className="hero-title mb-6" style={{ fontSize: "clamp(1.8rem, 4vw, 2.4rem)" }}>
        You're already signed in as{" "}
        <span className="accent-word">{email ?? username ?? "your account"}</span>.
      </h1>
      <div className="flex flex-col items-center gap-4">
        {one ? (
          <button
            type="button"
            onClick={open}
            disabled={busy}
            className="btn btn-primary btn-lg justify-center rounded-full px-6 shadow-soft"
          >
            {busy ? `Opening ${one.name}…` : `Open ${one.name} →`}
          </button>
        ) : (
          <Link
            to="/welcome"
            className="btn btn-primary btn-lg justify-center rounded-full px-6 shadow-soft"
          >
            Choose a vault →
          </Link>
        )}
        <button
          type="button"
          onClick={signOut}
          className="font-round text-sm font-semibold text-fg-dim hover:text-accent"
        >
          Not you? Sign out
        </button>
      </div>
    </Shell>
  );
}

// SYNTHESIS #12 — net error: signed in, couldn't fetch vaults. Reading is never
// blocked elsewhere; here there's nothing local yet, so offer a retry.
function NetError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Shell>
      <ParachuteMark size={56} className="mx-auto mb-6" />
      <p className="eyebrow eyebrow-accent mb-3">Almost there</p>
      <h1 className="hero-title mb-4" style={{ fontSize: "clamp(1.8rem, 4vw, 2.4rem)" }}>
        You're signed in — we just couldn't fetch your <span className="accent-word">vaults.</span>
      </h1>
      <p className="mx-auto mb-6 max-w-sm text-fg-muted">{message}</p>
      <button
        type="button"
        onClick={() => (onRetry ? onRetry() : window.location.reload())}
        className="btn btn-primary btn-lg justify-center rounded-full px-6 shadow-soft"
      >
        Try again
      </button>
    </Shell>
  );
}
