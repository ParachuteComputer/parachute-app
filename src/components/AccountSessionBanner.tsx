import { useAccountSessionStore } from "@/lib/account/store";
import { withMount } from "@/lib/base-url";
import { Link, useLocation } from "react-router";

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

// HUB-PARITY P4 weather (design §2 row 4) — the hub's two extra gates. Both
// NON-BLOCKING (reading local notes is never gated on either); this is a
// distinct concern from the session-expired banner above (a live but
// under-provisioned account, not a lapsed session). Set by the boot
// dispatcher (`dispatch.ts`) or the Account surface when `/account/token`
// (or a C3 call riding the same mint) 403s `force_change_password` / 423s.
export function HubGateBanner() {
  const gate = useAccountSessionStore((s) => s.gate);
  const clear = useAccountSessionStore((s) => s.clearGate);
  const location = useLocation();
  if (!gate) return null;

  if (gate === "force_change_password") {
    // `next` round-trips to wherever the person currently is, mount-aware
    // (under a hub the app lives at `/app`) — `/account/change-password`
    // itself is the DOOR's own path, never mount-prefixed.
    const next = withMount(`${location.pathname}${location.search}`);
    return (
      <output className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-2.5">
        <div className="flex w-full items-center gap-3 rounded-xl border border-sun bg-sun-soft px-4 py-2.5 text-sm text-sun-ink">
          <span className="min-w-0 flex-1">Finish setting your password.</span>
          <a
            href={`/account/change-password?next=${encodeURIComponent(next)}`}
            className="shrink-0 rounded-full bg-accent px-3 py-1 font-round text-xs font-semibold text-on-accent hover:bg-accent-hover"
          >
            Continue →
          </a>
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

  return (
    <output className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-2.5">
      <div className="flex w-full items-center gap-3 rounded-xl border border-sun bg-sun-soft px-4 py-2.5 text-sm text-sun-ink">
        <span className="min-w-0 flex-1">
          This parachute's admin screen is locked — unlock it at /admin.
        </span>
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
