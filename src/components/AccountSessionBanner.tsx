import { useAccountSessionStore } from "@/lib/account/store";
import { Link } from "react-router";

// SYNTHESIS weather #12 — the session-expired banner. NON-BLOCKING by design:
// notes stay readable + editable on this device (they're local-first); the
// banner just invites re-signing to keep SYNCING. Shown app-wide when any
// hosted call 401s (`useAccountSessionStore.markExpired`). Dismissible.
export function AccountSessionBanner() {
  const expired = useAccountSessionStore((s) => s.expired);
  const clear = useAccountSessionStore((s) => s.clearExpired);
  if (!expired) return null;
  return (
    <output className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-2.5">
      <div className="flex w-full items-center gap-3 rounded-xl border border-sun bg-sun-soft px-4 py-2.5 text-sm text-sun-ink">
        <span className="min-w-0 flex-1">
          Your sign-in ended. Notes are safe on this device — sign in again to keep syncing.
        </span>
        <Link
          to="/"
          onClick={() => clear()}
          className="shrink-0 rounded-full bg-accent px-3 py-1 font-round text-xs font-semibold text-on-accent hover:bg-accent-hover"
        >
          Sign in
        </Link>
        <button
          type="button"
          onClick={() => clear()}
          aria-label="Dismiss"
          className="shrink-0 text-sun-ink/70 hover:text-sun-ink"
        >
          ✕
        </button>
      </div>
    </output>
  );
}
