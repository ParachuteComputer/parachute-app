import { ParachuteMark, Wordmark } from "@/components/ParachuteMark";
import { getSession, requestMagicLink } from "@/lib/account/client";
import { loadLastSigninEmail, saveLastSigninEmail } from "@/lib/account/store";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";

const SIGNIN_NEXT = "/welcome";
const POLL_MS = 3000;

// SYNTHESIS #2 — "Check your email". Neutral copy (no account-existence oracle;
// the email itself is the earliest honest new-vs-returning moment). Polls
// `/account/session` so THIS tab auto-advances the instant the link is clicked
// in the same browser. Resend / use-a-different-email are the calm micro-states.
export function CheckEmail() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => loadLastSigninEmail() ?? "");
  const [sub, setSub] = useState<"idle" | "resent" | "changeemail">("idle");
  const [newEmail, setNewEmail] = useState("");
  const ranResend = useRef(false);

  // Auto-advance when the link is clicked in this browser.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const session = await getSession();
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

  return (
    <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col">
      {/* F6 — a quiet way out; "/" drops back to the front door (this tab
          isn't signed in yet, so the boot dispatcher shows the sign-in form). */}
      <div className="flex items-center justify-between px-6 pt-6 sm:px-10">
        <Wordmark />
        <Link to="/" className="focus-ring font-round text-sm text-fg-dim hover:text-accent">
          ← Back
        </Link>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <div className="mx-auto w-full max-w-md">
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
              onClick={() => setSub("changeemail")}
              className="font-round text-sm font-semibold text-link hover:underline"
              style={{ color: "var(--color-sage)" }}
            >
              Use a different email
            </button>
          </div>

          {sub === "resent" ? (
            <p className="mx-auto mt-4 max-w-sm rounded-xl border border-grass bg-grass-soft px-4 py-3 text-sm text-grass-ink">
              ✓ Sent again — check your inbox.
            </p>
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
        </div>
      </div>
    </div>
  );
}
