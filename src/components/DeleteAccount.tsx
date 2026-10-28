import {
  AccountApiError,
  type DeleteAccountResponse,
  SessionExpiredError,
  deleteAccount,
} from "@/lib/account/client";
import type { DoorDescriptor } from "@/lib/account/descriptor";
import { clearAccountToken } from "@/lib/account/store";
import { useId, useState } from "react";
import { Link } from "react-router";

// "Delete account" — the last section of the Account screen (T-318). Renders
// only when the serving door advertises `capabilities.account_delete === true`
// (cloud does; a self-hosted hub advertises nothing, so nothing shows there).
//
// The door closes the account at once and signs it out everywhere, then erases
// the data after 24 hours unless the person follows the undo link it emails.
// So on success the session is already dead server-side: we drop the cached
// account bearer right away, show the outcome (with the undo deadline), and
// "Done" runs the Account screen's own sign-out (logout + clear + home).

/** Trimmed, case-insensitive — the same match the door applies. */
function matchesEmail(typed: string, email: string): boolean {
  return typed.trim().toLowerCase() === email.trim().toLowerCase();
}

function formatUndoDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function errorCopy(err: unknown): string {
  if (err instanceof SessionExpiredError) {
    return "Your sign-in has ended. Sign in again, then come back here to delete your account.";
  }
  if (err instanceof AccountApiError) {
    if (err.message === "already_deleting") {
      return "This account is already being deleted. Check your email for the undo link.";
    }
    if (err.message === "confirm_mismatch") {
      return "That doesn't match your account email.";
    }
    // The door's own message ("Couldn't reach storage, try again.", …).
    if (err.message && !/^[a-z0-9_]+$/.test(err.message)) return err.message;
  }
  return "Couldn't delete your account. Nothing has changed. Try again.";
}

export function DeleteAccount({
  email,
  descriptor,
  onSignOut,
}: {
  /** The signed-in account's email — the confirmation phrase. */
  email?: string;
  descriptor: DoorDescriptor | null;
  /** The Account screen's existing sign-out (logout + clear token + home). */
  onSignOut: () => void;
}) {
  if (descriptor?.capabilities?.account_delete !== true || !email) return null;
  return <DeleteAccountSection email={email} onSignOut={onSignOut} />;
}

function DeleteAccountSection({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DeleteAccountResponse | null>(null);

  const confirmed = matchesEmail(typed, email);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteAccount(typed.trim());
      // The door already ended every session for this account — the cached
      // bearer is dead, so don't keep it around while the outcome shows.
      clearAccountToken();
      setDone(result);
    } catch (err) {
      setError(errorCopy(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Delete account" className="card p-6 shadow-soft">
      <h2 className="font-serif text-xl text-fg">Delete account</h2>
      {done ? (
        <div className="mt-2 space-y-4">
          <output className="block text-sm text-fg-muted">
            Your account is closed. We sent an email with an undo link; it works for 24 hours, until{" "}
            {formatUndoDeadline(done.undo_expires_at)}.
          </output>
          <button type="button" onClick={onSignOut} className="btn btn-primary btn-touch">
            Done
          </button>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-fg-muted">
            Your account closes now and you're signed out everywhere. Everything is erased after 24
            hours: your vaults, notes, files, snapshots and exports. Until then the email we send
            has an undo link.{" "}
            <Link to="/export" className="focus-ring text-accent underline">
              Export first
            </Link>{" "}
            if you want a copy.
          </p>
          <form onSubmit={submit} className="mt-4 space-y-3">
            <label htmlFor={inputId} className="block text-sm font-medium text-fg">
              Type your account email to confirm
            </label>
            <input
              id={inputId}
              type="email"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={email}
              className="input"
            />
            <button
              type="submit"
              disabled={!confirmed || busy}
              className="btn btn-danger-solid btn-touch"
            >
              {busy ? "Deleting…" : "Delete my account"}
            </button>
          </form>
          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
