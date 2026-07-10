import { ParachuteMark, Wordmark } from "@/components/ParachuteMark";
import { beginHostedSignin } from "@/lib/vault/hosted-door";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";

// The arrival — the app's front door for a visitor with no vault yet (App.tsx's
// NotesIndex renders the guided Home once a vault is connected).
//
// This is an ENTRY FORK, not vault-naming (Aaron's live feedback: "the first
// thing shouldn't ask what my vault is — it should let me sign in or connect a
// self-hosted vault; ask the name AFTER account creation"). Two intuitive paths:
//
//   1. HOSTED (primary): one warm email field → the hosted door's magic-link
//      ceremony (cloud.parachute.computer). Magic-link unifies new (account
//      created) and returning (signed in). The user never types a URL.
//   2. SELF-HOSTED (secondary, quieter): connect your own hub/vault by URL
//      (the existing /add flow).
//
// The vault-naming delight now lands in the right place — the first-run
// `/welcome` screen after a new hosted account is created (see Welcome.tsx).
export function Landing() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A light plausibility check — the door validates authoritatively.
  const looksLikeEmail = /.+@.+\..+/.test(email.trim());

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!looksLikeEmail || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Redirects the browser to the hosted door's ceremony (does not return).
      await beginHostedSignin(email);
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof Error
          ? `Couldn't reach the sign-in service: ${err.message}`
          : "Couldn't reach the sign-in service. Please try again.",
      );
    }
  }

  return (
    <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col">
      <div className="flex items-center px-6 pt-6 sm:px-10">
        <Wordmark />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <div className="mx-auto w-full max-w-md">
          <ParachuteMark size={60} className="mx-auto mb-6 drop-in" />

          <p className="eyebrow mb-3">Welcome</p>
          <h1 className="hero-title mb-4">
            A soft place for your thoughts to <span className="accent-word">land.</span>
          </h1>
          <p className="mx-auto mb-8 max-w-sm text-lg leading-relaxed text-fg-muted">
            All your notes in one vault. Any AI can read it. It stays yours.
          </p>

          {/* PRIMARY — hosted sign-in / create, one email away. */}
          <form onSubmit={onSubmit} className="mx-auto w-full max-w-sm">
            <div className="composer flex flex-col gap-3 p-4 text-left">
              <label htmlFor="email" className="eyebrow">
                Sign in or create your Parachute
              </label>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                // biome-ignore lint/a11y/noAutofocus: the arrival's single purpose is this field.
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
                {busy ? "Taking you to sign in…" : "Continue with email →"}
              </button>
            </div>
          </form>

          <p className="mx-auto mt-3 max-w-sm font-round text-xs text-fg-dim">
            New here or returning — one magic link signs you in. No password.
          </p>

          {error ? (
            <p className="mx-auto mt-3 max-w-sm rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}

          {/* SECONDARY — self-hosted, quieter. */}
          <div className="mt-8 border-t border-border pt-6">
            <Link
              to="/add"
              className="font-round text-sm font-semibold hover:underline"
              style={{ color: "var(--color-sage)" }}
            >
              Self-hosting? Connect your own vault →
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-2.5">
            {["Local-first", "Open standard (MCP)", "Export anytime"].map((p) => (
              <span
                key={p}
                className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1.5 font-round text-xs text-fg-muted"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
