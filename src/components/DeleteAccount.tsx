import { type DeleteAccountResponse, deleteAccount, listVaults } from "@/lib/account/client";
import type { DoorDescriptor } from "@/lib/account/descriptor";
import { describeDeletionError } from "@/lib/account/error-copy";
import { isHomeDoorVault } from "@/lib/account/hosted-vault";
import { clearAccountToken } from "@/lib/account/store";
import { vaultServerSlug } from "@/lib/vault/deep-link";
import { useVaultStore } from "@/lib/vault/store";
import { useId, useState } from "react";
import { Link } from "react-router";

// "Delete account" — the last section of the Account screen (T-318). Renders
// only when the serving door advertises `capabilities.account_delete === true`
// (cloud does; a self-hosted hub advertises nothing, so nothing shows there).
//
// The door closes the account at once and signs it out everywhere, then erases
// the data after 24 hours unless the person follows the undo link it emails.
// So on success the session is already dead server-side: we drop the cached
// account bearer and this account's hosted vaults on this device right away,
// show the outcome (with the undo deadline), and "Done" runs the Account
// screen's own sign-out (logout + clear + home).

/** Trimmed, case-insensitive — the same match the door applies. */
function matchesEmail(typed: string, email: string): boolean {
  return typed.trim().toLowerCase() === email.trim().toLowerCase();
}

function formatUndoDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const ERROR_COPY = {
  byCode: {
    confirm_mismatch: "That doesn't match your account email.",
    already_deleting: "This account is already being deleted. Check your email for the undo link.",
  },
  sessionEnded:
    "Your sign-in has ended. Sign in again, then come back here to delete your account.",
  fallback: "Couldn't delete your account. Nothing has changed. Try again.",
};

/** The undo link comes from the door; only ever render it as a web link. */
function isSafeLink(url: string | undefined): url is string {
  return typeof url === "string" && (/^https?:\/\//i.test(url) || url.startsWith("/"));
}

/** Forget THIS account's hosted vaults on this device — their tokens, service
 *  catalogs and drafts — the same way "Remove from this device" does. The
 *  account is closed, so none of them can sync any more. Only vaults the door
 *  listed for this account (by server slug) go: a device can still hold another
 *  account's vaults on the same door, and those must stay. */
function forgetAccountVaults(slugs: ReadonlySet<string>): void {
  const { vaults, removeVault } = useVaultStore.getState();
  for (const record of Object.values(vaults)) {
    const slug = vaultServerSlug(record.url) ?? record.name;
    if (isHomeDoorVault(record) && slugs.has(slug)) removeVault(record.id);
  }
}

/** The deleting account's vault slugs, read BEFORE the delete (afterwards the
 *  bearer is dead). A failed read forgets nothing: leaving a dead record is
 *  recoverable ("Remove from this device"); erasing another account's isn't. */
async function accountVaultSlugs(): Promise<Set<string>> {
  try {
    const res = await listVaults();
    return new Set((Array.isArray(res?.vaults) ? res.vaults : []).map((v) => v.name));
  } catch {
    return new Set();
  }
}

export function DeleteAccount({
  email,
  descriptor,
  onDeleted,
}: {
  /** The signed-in account's email — the confirmation phrase. */
  email?: string;
  descriptor: DoorDescriptor | null;
  /** Called with the door's answer once the account is closed. The Account
   *  screen shows the outcome itself: the session is gone, so this signed-in
   *  section is about to unmount, and the outcome must outlive it. */
  onDeleted: (result: DeleteAccountResponse) => void;
}) {
  if (descriptor?.capabilities?.account_delete !== true || !email) return null;
  return <DeleteAccountSection email={email} onDeleted={onDeleted} />;
}

function DeleteAccountSection({
  email,
  onDeleted,
}: {
  email: string;
  onDeleted: (result: DeleteAccountResponse) => void;
}) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = matchesEmail(typed, email);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const slugs = await accountVaultSlugs();
      const result = await deleteAccount(typed.trim());
      // The door already ended every session for this account — the cached
      // bearer is dead, and so is every hosted vault's token. Don't keep any
      // of it around while the outcome shows.
      clearAccountToken();
      forgetAccountVaults(slugs);
      onDeleted(result);
    } catch (err) {
      setError(describeDeletionError(err, ERROR_COPY));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Delete account" className="card p-6 shadow-soft">
      <h2 className="font-serif text-xl text-fg">Delete account</h2>
      <>
        <p className="mt-2 text-sm text-fg-muted">
          Your account closes now and you're signed out everywhere. Everything is erased after 24
          hours: your vaults, notes, files, snapshots and exports. Until then the email we send has
          an undo link.{" "}
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
    </section>
  );
}

/** What the person sees once their account is closed: the undo deadline (and
 *  the undo link itself when the email couldn't be sent), then Done. Rendered
 *  by the Account screen, outside the signed-in view. */
export function DeletionOutcome({
  done,
  onDone,
}: {
  done: DeleteAccountResponse;
  onDone: () => void;
}) {
  return (
    <section aria-label="Account closed" className="card p-6 shadow-soft">
      <h2 className="font-serif text-xl text-fg">Account closed</h2>
      <div className="mt-2 space-y-4">
        {done.notice_sent === false && isSafeLink(done.undo_url) ? (
          // The door couldn't send the email — the undo link it returned is
          // the person's only way back, so it goes on screen.
          <output className="block text-sm text-fg-muted">
            Your account is closed. We couldn't send the email with the undo link, so here it is:{" "}
            <a href={done.undo_url} className="focus-ring text-accent underline">
              undo the deletion
            </a>
            . It works for 24 hours, until {formatUndoDeadline(done.undo_expires_at)}.
          </output>
        ) : (
          <output className="block text-sm text-fg-muted">
            Your account is closed. We sent an email with an undo link; it works for 24 hours, until{" "}
            {formatUndoDeadline(done.undo_expires_at)}.
          </output>
        )}
        <button type="button" onClick={onDone} className="btn btn-primary btn-touch">
          Done
        </button>
      </div>
    </section>
  );
}
