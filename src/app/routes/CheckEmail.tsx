import { ParachuteMark } from "@/components/ParachuteMark";
import { WizardShell } from "@/components/WizardShell";
import { getSession, requestMagicLink, verifySignInCode } from "@/lib/account/client";
import { loadLastSigninEmail, saveLastSigninEmail } from "@/lib/account/store";
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router";

const SIGNIN_NEXT = "/welcome";
const POLL_MS = 3000;

/** The endpoint's own failure is neutral-by-design (wrong/expired/unknown/
 *  attempt-capped all fold into one message, no oracle — auth-handlers.ts
 *  `handleCodeVerifyPost`); this mirrors that posture rather than trying to
 *  distinguish causes we can't see (see `verifySignInCode`'s doc comment). */
const CODE_ERROR = "That code didn't work — check it and try again.";

// SYNTHESIS #2 — "Check your email". Neutral copy (no account-existence oracle;
// the email itself is the earliest honest new-vs-returning moment). Polls
// `/account/session` so THIS tab auto-advances the instant the link is clicked
// in the same browser. Resend / use-a-different-email are the calm micro-states.
export function CheckEmail() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => loadLastSigninEmail() ?? "");
  const [sub, setSub] = useState<"idle" | "resent" | "changeemail" | "code">("idle");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const ranResend = useRef(false);
  const verifyingCode = useRef(false);

  // Auto-advance when the link is clicked in this browser.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const session = await getSession();
        // NAVIGATION.md: "CheckEmail poll success → /welcome" — (c) auto-
        // advance; returning to a consumed check-email would be wrong.
        if (!cancelled && session.signed_in) navigate(SIGNIN_NEXT, { replace: true });
      } catch {
        // keep polling — a transient failure shouldn't strand the tab
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [navigate]);

  // No email on record (deep-linked here directly) — send them to the front door.
  if (!email) return <Navigate to="/" replace />;

  async function resend(to = email) {
    if (ranResend.current) return;
    ranResend.current = true;
    try {
      const session = await getSession();
      await requestMagicLink(to, session.csrf, SIGNIN_NEXT);
      if (to !== email) {
        saveLastSigninEmail(to);
        setEmail(to);
      }
      setSub("resent");
    } catch {
      setSub("idle");
    } finally {
      ranResend.current = false;
    }
  }

  // Auto-advances at 6 digits — the "auto-advance feel" without a 6-box grid
  // (a single field stays paste-robust: pasting the whole email line, e.g.
  // "Your Parachute code: 123 456", just needs the digits filtered out, which
  // a fixed-width box grid can't do as simply).
  async function submitCode(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    setCodeError(null);
    if (digits.length < 6 || verifyingCode.current) return;
    verifyingCode.current = true;
    setVerifying(true);
    try {
      const session = await getSession();
      const ok = await verifySignInCode(email, digits, session.csrf);
      if (ok) {
        navigate(SIGNIN_NEXT, { replace: true });
        return;
      }
      setCodeError(CODE_ERROR);
      setCode("");
    } catch {
      setCodeError(CODE_ERROR);
      setCode("");
    } finally {
      verifyingCode.current = false;
      setVerifying(false);
    }
  }

  return (
    // F6 / §4.1 — the quiet way out, named for what it does (route-map row
    // 27: "← Back to sign in"); history-aware, with the front door as the
    // deep-link fallback (this tab isn't signed in yet, so the boot
    // dispatcher shows the sign-in form).
    <WizardShell escape={{ kind: "back", to: "/", label: "← Back to sign in" }}>
      <ParachuteMark size={56} className="mx-auto mb-6" />
      <p className="eyebrow mb-3">Check your email</p>
      <h1 className="hero-title mb-3" style={{ fontSize: "clamp(1.6rem, 3.5vw, 2.1rem)" }}>
        We sent a sign-in link to <span className="accent-word">{email}</span>
      </h1>
      <p className="text-fg-muted">Works once, expires in 10 min.</p>
      <p className="mx-auto mt-3 mb-6 max-w-sm font-round text-sm text-fg-muted">
        New here? That same link creates your account — the email says which.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => resend()}
          className="btn btn-secondary btn-touch rounded-full"
        >
          Resend the link
        </button>
        <button
          type="button"
          onClick={() => setSub(sub === "code" ? "idle" : "code")}
          className="font-round text-sm font-semibold text-link hover:underline"
          style={{ color: "var(--color-sky)" }}
        >
          {sub === "code" ? "Hide the code field" : "Or type the code from the email"}
        </button>
        <button
          type="button"
          onClick={() => setSub("changeemail")}
          className="font-round text-sm font-semibold text-link hover:underline"
          style={{ color: "var(--color-sky)" }}
        >
          Use a different email
        </button>
      </div>

      {sub === "resent" ? (
        <p className="mx-auto mt-4 max-w-sm rounded-xl border border-grass bg-grass-soft px-4 py-3 text-sm text-grass-ink">
          ✓ Sent again — check your inbox.
        </p>
      ) : null}

      {sub === "code" ? (
        <div className="mx-auto mt-4 max-w-xs">
          <label htmlFor="signin-code" className="mb-2 block font-round text-sm text-fg-muted">
            6-digit code
          </label>
          <input
            id="signin-code"
            value={code}
            onChange={(e) => {
              void submitCode(e.target.value);
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            placeholder="123456"
            disabled={verifying}
            aria-invalid={codeError ? true : undefined}
            aria-describedby={codeError ? "signin-code-error" : undefined}
            // biome-ignore lint/a11y/noAutofocus: revealed by an explicit "Or type the code from the email" click, not on page load.
            autoFocus
            className="input w-full text-center text-2xl tracking-[0.4em]"
          />
          <output aria-live="polite" className="mt-2 block text-center text-xs text-fg-dim">
            {verifying ? "Checking…" : " "}
          </output>
          {codeError ? (
            <p
              id="signin-code-error"
              role="alert"
              className="rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-center text-sm text-danger"
            >
              {codeError}
            </p>
          ) : null}
        </div>
      ) : null}

      {sub === "changeemail" ? (
        <div className="mx-auto mt-4 max-w-sm">
          <div className="flex gap-2">
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="you@example.com"
              aria-label="Email address"
              type="email"
              className="input"
            />
            <button
              type="button"
              onClick={() => {
                const t = newEmail.trim();
                if (/.+@.+\..+/.test(t)) resend(t);
              }}
              className="btn btn-primary btn-touch shrink-0 rounded-full"
            >
              Send link
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSub("idle")}
            className="mt-2 font-round text-sm text-fg-dim hover:text-accent"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </WizardShell>
  );
}
