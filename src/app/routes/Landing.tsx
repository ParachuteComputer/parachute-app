import { ParachuteMark, Wordmark } from "@/components/ParachuteMark";
import { getSession, logout, requestMagicLink } from "@/lib/account/client";
import { type DoorDescriptor, getDoorDescriptor } from "@/lib/account/descriptor";
import { openHostedVault } from "@/lib/account/hosted-vault";
import { clearAccountToken, loadLastSigninEmail, saveLastSigninEmail } from "@/lib/account/store";
import type { AccountVault } from "@/lib/account/types";
import { withMount } from "@/lib/base-url";
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
function SelfHostSideDoor() {
  return (
    <div className="mt-8 border-t border-border pt-6">
      <p className="font-round text-sm text-fg-muted">
        Self-hosting?{" "}
        <Link
          to="/add"
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

// HUB-PARITY P4 — the ONE door-conditional piece of UI the portability
// principle permits (SYNTHESIS "PORTABILITY"). Loads the door descriptor
// (`/.well-known/parachute-account`, same-origin, public) and branches:
//   - `auth` absent, OR `auth.methods` includes `"magic_link"` → the existing
//     email form (`MagicLinkFrontDoor`), rendered UNCHANGED — this is also
//     what renders while the descriptor is still in flight, so a slow/offline
//     fetch never blocks first paint, it just risks a brief flash before a
//     password-only door's card swaps in (the boot dispatcher prefetches the
//     descriptor in parallel with the session check to shrink that window —
//     see `App.tsx`'s `BootGate`).
//   - password-only (`auth` present, `methods` excludes `"magic_link"`) → the
//     ceremony-hop card (ONE deliberate, labeled origin change, mirroring the
//     self-host `/add` hop).
function FrontDoor() {
  const [descriptor, setDescriptor] = useState<DoorDescriptor | null>(null);

  useEffect(() => {
    let live = true;
    getDoorDescriptor().then((d) => {
      if (live) setDescriptor(d);
    });
    return () => {
      live = false;
    };
  }, []);

  const methods = descriptor?.auth?.methods;
  const passwordOnly = descriptor?.auth != null && !(methods ?? []).includes("magic_link");

  if (passwordOnly && descriptor?.auth) {
    return <PasswordFrontDoor auth={descriptor.auth} signupPath={descriptor.signup_path} />;
  }
  return <MagicLinkFrontDoor />;
}

// The magic-link front door (`/`, signed-out, cloud today) — SYNTHESIS #1.
// Byte-unchanged from the pre-P4 shape: one email field that does BOTH (sign
// in OR create), because magic-link resolves new-vs-returning without asking.
function MagicLinkFrontDoor() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const expired = params.get("link") === "expired";
  const [email, setEmail] = useState(loadLastSigninEmail() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const looksLikeEmail = /.+@.+\..+/.test(email.trim());

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
        Free for 30 days, no card. Plans from $10 a year.
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

// The password-door front door (a hub, once P1/P2 ship) — the ceremony-hop
// card: SYNTHESIS "PORTABILITY" + Q2 (the signup affordance). No email/
// password field lives here — the hub's OWN `/login` page owns that ceremony;
// this card just names the door and hands off, mirroring the self-host `/add`
// hop (SYNTHESIS #11)'s "announced, labeled context switch" pattern.
function PasswordFrontDoor({
  auth,
  signupPath,
}: {
  auth: NonNullable<DoorDescriptor["auth"]>;
  signupPath?: string;
}) {
  function continueToSignIn() {
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

      <p className="mx-auto mb-6 max-w-sm text-fg-muted">Sign in to your parachute.</p>

      <button
        type="button"
        onClick={continueToSignIn}
        className="btn btn-primary btn-lg justify-center rounded-full px-6 shadow-soft"
      >
        Continue to sign in →
      </button>

      {signupPath ? (
        <p className="mx-auto mt-6 max-w-sm font-round text-sm text-fg-muted">
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
        <p className="mx-auto mt-6 max-w-sm font-round text-xs text-fg-dim">
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
  const [busy, setBusy] = useState(false);
  const one = vaults.length === 1 ? vaults[0] : null;

  async function open() {
    if (!one || busy) return;
    setBusy(true);
    try {
      // The account bearer is minted + cached inside the client; no csrf needed.
      await openHostedVault(one.name);
      // NAVIGATION.md: "Landing 'already signed in' card: Open {vault} → /"
      // — user-initiated, push.
      navigate("/");
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
