import { IconExport, IconImport, IconSpark } from "@/components/NavIcons";
import {
  BillingApiError,
  SessionExpiredError,
  getSession,
  listVaults,
  logout,
  openBillingPortal,
  startCheckout,
} from "@/lib/account/client";
import type { DoorDescriptor } from "@/lib/account/descriptor";
import { getDoorDescriptor } from "@/lib/account/descriptor";
import { markHubGateFromError } from "@/lib/account/dispatch";
import { describeAccountError } from "@/lib/account/error-copy";
import { openHostedVault } from "@/lib/account/hosted-vault";
import { formatBytes, formatUsageBytes } from "@/lib/account/provenance";
import { clearAccountToken, useAccountSessionStore } from "@/lib/account/store";
import type {
  AccountSummary,
  AccountVault,
  BillingInterval,
  DoorPlan,
  DoorPlanInterval,
} from "@/lib/account/types";
import { summaryOrNull, useAccountSummary } from "@/lib/account/use-summary";
import { useVaultStore } from "@/lib/vault";
import { announceVaultSwitch } from "@/lib/vault/switch";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

// "Your parachute" — the manager's home (DESIGN-SPEC §3.1, W2-8). The person
// lives HERE and drives their whole account through the account bearer; Cloud
// shrinks to the counter you visit only to sign up, pay, or change plan. Four
// cards: Identity · Plan & billing · Vaults · Connections.
//
// Door-agnostic + graceful: reads the account API at the SERVING origin (never
// a hardcoded cloud host). When there's no cloud door / no session (a
// self-host device, or signed out), it degrades to a calm "this device" view —
// local vaults + connections, no account/plan sections, never a crash.
//
// The correctness piece (WALK-manager #1 / F4): the plan may never silently
// vanish. A summary fetch FAILURE renders the Plan & billing card's own retry
// state — distinguishable from a door that honestly has no summary to serve
// (tri-state seam in client.ts / use-summary.ts).

type BootView =
  | { kind: "loading" }
  | {
      kind: "manager";
      email?: string;
      /** HUB-PARITY P4: a password door may sign in under a username instead
       *  of an email; "Signed in as X" falls back `email ?? username`. */
      username?: string;
      csrf: string;
    }
  | { kind: "device" };

/** The vault list's own tri-state — mirrors the summary seam: a failure gets a
 *  retry card, never the "create your first" empty-state (which would invite a
 *  duplicate vault on a transient 500 / session lapse). */
type VaultsState = "loading" | "error" | AccountVault[];

export function Account() {
  const [view, setView] = useState<BootView>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    (async () => {
      let session: Awaited<ReturnType<typeof getSession>>;
      try {
        session = await getSession();
      } catch {
        // No door to ask (self-host device / offline) → manage this device.
        if (live) setView({ kind: "device" });
        return;
      }
      if (!live) return;
      setView(
        session.signed_in
          ? {
              kind: "manager",
              email: session.email,
              username: session.username,
              csrf: session.csrf,
            }
          : { kind: "device" },
      );
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="page-prose">
      <header className="mb-8">
        {/* No "← Home" breadcrumb — a primary-nav room (F11 rule). */}
        <h1 className="page-title">Your parachute</h1>
        <p className="mt-2 max-w-prose text-fg-muted">
          Your account, plan, vaults, and connections — managed here.
        </p>
      </header>

      {view.kind === "loading" ? (
        <output aria-live="polite" className="block py-10 text-center text-sm text-fg-dim">
          <span className="animate-pulse">Loading your account…</span>
        </output>
      ) : view.kind === "device" ? (
        <DeviceView />
      ) : (
        <ManagerView email={view.email} username={view.username} csrf={view.csrf} />
      )}
    </div>
  );
}

// The signed-in manager: the four-card stack. Owns the three data reads beyond
// the session — each card degrades on its own, none gates the others.
function ManagerView({
  email,
  username,
  csrf,
}: {
  email?: string;
  username?: string;
  csrf: string;
}) {
  const navigate = useNavigate();
  const activeVault = useVaultStore((s) => s.getActiveVault());

  // Plan/trial context — the SHARED summary query (§2.4): same cache as the
  // switcher, the nav badge, and Home's ambience. Tri-state: summary | null
  // (door serves no summary) | "error" (transient failure → the retry card).
  const summaryQuery = useAccountSummary();
  const summaryState = summaryQuery.isPending ? "loading" : (summaryQuery.data ?? null);
  const summary = summaryOrNull(summaryQuery.data);
  const retrySummary = useCallback(() => summaryQuery.refetch(), [summaryQuery.refetch]);

  // The account's vault list + the door descriptor (the upgrade ladder). The
  // descriptor is same-origin + public and never throws (memoized module-side).
  const [vaults, setVaults] = useState<VaultsState>("loading");
  const [descriptor, setDescriptor] = useState<DoorDescriptor | null>(null);

  useEffect(() => {
    let live = true;
    listVaults()
      .then((r) => {
        if (live) setVaults(r.vaults);
      })
      .catch((err) => {
        // HUB-PARITY P4 weather: the account-token mint underlying this call
        // may 403 force_change_password / 423 — surface the matching
        // non-blocking gate rather than just degrading to the retry card.
        markHubGateFromError(err);
        if (live) setVaults("error");
      });
    getDoorDescriptor().then((d) => {
      if (live) setDescriptor(d);
    });
    return () => {
      live = false;
    };
  }, []);

  const reloadVaults = useCallback(async () => {
    try {
      const { vaults } = await listVaults();
      setVaults(vaults);
    } catch {
      setVaults("error");
    }
  }, []);

  async function signOut() {
    try {
      await logout(csrf);
    } finally {
      clearAccountToken();
      // NAVIGATION.md: "Sign out → /" — replace; the session context is
      // gone, so Back into a signed-in page would lie.
      navigate("/", { replace: true });
    }
  }

  return (
    <div className="space-y-6">
      <IdentityCard email={email} username={username} summary={summary} onSignOut={signOut} />
      <PlanBillingCard
        state={summaryState}
        descriptor={descriptor}
        onRetry={retrySummary}
        retrying={summaryQuery.isFetching}
      />
      <VaultsCard vaults={vaults} summary={summary} onReload={reloadVaults} />
      <ConnectionsCard hasActiveVault={!!activeVault} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card 1 — Identity. SIGNED IN AS · email (Fraunces) · the plan chip · the
// quiet sign-out ghost. The chip is ambience: no summary (failed or absent) ⇒
// no chip — the retry affordance lives in Card 2, never here.
// ---------------------------------------------------------------------------

function IdentityCard({
  email,
  username,
  summary,
  onSignOut,
}: {
  email?: string;
  username?: string;
  summary: AccountSummary | null;
  onSignOut: () => void;
}) {
  return (
    <section aria-label="Account" className="card p-6 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-1">Signed in as</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* UI-audit finding #10: `truncate` ellipsized this mid-domain on
                phone — exactly the string (an account-identifying email) a
                person most wants to read in full. Wrap instead. */}
            <p className="break-words font-serif text-xl text-fg">
              {email ?? username ?? "your account"}
            </p>
            <PlanChip summary={summary} />
          </div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="focus-ring shrink-0 text-sm text-fg-dim hover:text-accent"
        >
          Sign out
        </button>
      </div>
    </section>
  );
}

function PlanChip({ summary }: { summary: AccountSummary | null }) {
  if (!summary) return null;
  const days = summary.plan.trial_days_left;
  if (typeof days === "number") {
    return (
      <span className="chip border-transparent bg-sun-soft font-medium text-sun-ink">
        Free trial · {days === 0 ? "ends today" : `${days} day${days === 1 ? "" : "s"} left`}
      </span>
    );
  }
  return <span className="chip">{summary.plan.label}</span>;
}

// ---------------------------------------------------------------------------
// Card 2 — Plan & billing. The five states (DESIGN-SPEC §3.1):
//   loading            → skeleton lines
//   absent             → no card (the door serves no summary — a hub — or
//                        billing_enabled: false — nothing honest to show)
//   failed             → the card's own retry state (WALK-manager #1: a
//                        transient hiccup must never silently vanish the plan)
//   trial / free       → current-plan line · interval picker · plan cards
//   paid               → plan line + the one true trip to the billing portal
// ---------------------------------------------------------------------------

function PlanBillingCard({
  state,
  descriptor,
  onRetry,
  retrying,
}: {
  state: AccountSummary | null | "error" | "loading";
  descriptor: DoorDescriptor | null;
  onRetry: () => void;
  retrying: boolean;
}) {
  // Absent — the door serves no summary (404: a self-hosted hub's honest
  // steady-state), or it does and billing isn't wired. Either way there is
  // nothing honest to show, so the card simply doesn't exist.
  if (state === null) return null;
  if (state !== "loading" && state !== "error" && !state.billing_enabled) return null;

  return (
    <section aria-label="Plan & billing" className="card p-6 shadow-soft">
      <h2 className="font-serif text-xl text-fg">Plan & billing</h2>
      {state === "loading" ? (
        <div aria-busy="true" className="mt-4 space-y-2.5">
          <div className="skeleton h-4 w-3/5 rounded-md" />
          <div className="skeleton h-4 w-2/5 rounded-md" />
        </div>
      ) : state === "error" ? (
        // The retry card — mirrors the vaults card's failure state exactly.
        <div className="mt-4 text-center">
          <p className="mb-1 font-serif text-lg text-fg">Couldn't load your plan.</p>
          <p className="mb-5 text-sm text-fg-muted">
            A hiccup reaching your account — your plan hasn't changed.
          </p>
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="btn btn-primary btn-touch"
          >
            {retrying ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : state.has_billing_customer ? (
        <ManageBilling summary={state} />
      ) : (
        <UpgradePlans summary={state} plans={descriptor?.plans ?? []} />
      )}
    </section>
  );
}

// Existing subscriber: the current-plan line + the one true trip to the
// Stripe billing portal. A 409/503 (comped account, or billing momentarily
// unconfigured) surfaces a small inline message — never a blocking error.
function ManageBilling({ summary }: { summary: AccountSummary }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function manage() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await openBillingPortal();
      window.location.assign(url);
    } catch (err) {
      setBusy(false);
      // A real session expiry (post-retry 401) is NOT a billing problem — hand
      // it to the app's existing "your sign-in ended" handling (the account
      // session banner), not a billing-specific inline message.
      if (err instanceof SessionExpiredError) {
        useAccountSessionStore.getState().markExpired();
        return;
      }
      setError("Billing isn't available right now.");
    }
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-fg-muted">{planSummaryLine(summary)}</p>
      <button
        type="button"
        onClick={manage}
        disabled={busy}
        className="btn btn-primary btn-touch mt-4"
      >
        {busy ? "Opening…" : "Manage plan & billing ↗"}
      </button>
      {error ? <BillingErrorLine text={error} /> : null}
    </div>
  );
}

// F1/F3/F5 — the billing-interval ladder in cheapest-first order. Doubles as
// the picker's render order and the "cheapest available" default rule below:
// a plan's monthly price is (normal SaaS discounting) always its lowest raw
// per-cycle number when the door sells it at all, so "prefer monthly, then
// quarterly, then yearly" is the same thing as "prefer cheapest available".
const INTERVAL_ORDER: readonly BillingInterval[] = ["monthly", "quarterly", "yearly"];
const INTERVAL_LABEL: Record<BillingInterval, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};
// Used only when a plan's interval entry has no door-authored `label` to
// render verbatim (older/partial data) — reconstructed from `price`.
const INTERVAL_SUFFIX: Record<BillingInterval, string> = {
  monthly: "/mo",
  quarterly: "/quarter",
  yearly: "/yr",
};
/** Cycles per year — the honest "about $N/mo" equivalence for plans that
 *  don't sell a monthly cycle (decision (a): Entry reads
 *  "$3/quarter · $10/yr — about $1/mo", never a bare "$1/mo"). */
const MONTHS_PER_INTERVAL: Record<BillingInterval, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/** The set of intervals available on ANY offered tier, cheapest-first — the
 *  picker only ever shows a cycle at least one plan can actually sell. Empty
 *  when no plan carries `intervals` data at all (the degrade-gracefully case:
 *  no picker, no interval sent, exactly today's behavior). */
function unionAvailableIntervals(plans: DoorPlan[]): BillingInterval[] {
  const seen = new Set<BillingInterval>();
  for (const plan of plans) {
    for (const key of INTERVAL_ORDER) {
      if (plan.intervals?.[key]?.available) seen.add(key);
    }
  }
  return INTERVAL_ORDER.filter((key) => seen.has(key));
}

/** Render one interval entry's price, preferring the door's own label. */
function formatIntervalPrice(entry: DoorPlanInterval, interval: BillingInterval): string | null {
  if (entry.label) return entry.label;
  return typeof entry.price === "number" ? `$${entry.price}${INTERVAL_SUFFIX[interval]}` : null;
}

/** A tier's own cheapest available cycle — the hint shown on a disabled
 *  Upgrade button when the globally-selected interval isn't one this tier
 *  sells (Entry + "Monthly", per F1's decision (a)). */
function cheapestPlanInterval(
  plan: DoorPlan,
): { interval: BillingInterval; entry: DoorPlanInterval } | null {
  for (const key of INTERVAL_ORDER) {
    const entry = plan.intervals?.[key];
    if (entry?.available) return { interval: key, entry };
  }
  return null;
}

/**
 * The card's honest per-interval price line (DESIGN-SPEC §3.1, decision (a)):
 * every cycle the tier actually sells, the door's own labels, joined — Entry
 * = "$3/quarter · $10/yr — about $1/mo". The "about $N/mo" equivalence renders
 * ONLY when the tier has no monthly cycle (it answers "what's that per
 * month?" for a plan that can't be bought monthly) and is derived from the
 * cheapest per-month real price, rounded to a whole dollar — approximate by
 * construction and labeled so ("about").
 */
function planPriceLine(plan: DoorPlan, hasIntervalData: boolean): string | null {
  if (!hasIntervalData || !plan.intervals) {
    return typeof plan.price_month === "number" ? `$${plan.price_month}/mo` : null;
  }
  const parts: string[] = [];
  let monthlyAvailable = false;
  let perMonth: number | null = null;
  for (const key of INTERVAL_ORDER) {
    const entry = plan.intervals[key];
    if (!entry?.available) continue;
    if (key === "monthly") monthlyAvailable = true;
    const label = formatIntervalPrice(entry, key);
    if (label) parts.push(label);
    if (typeof entry.price === "number") {
      const equivalent = entry.price / MONTHS_PER_INTERVAL[key];
      perMonth = perMonth === null ? equivalent : Math.min(perMonth, equivalent);
    }
  }
  if (parts.length === 0) return null;
  const line = parts.join(" · ");
  if (monthlyAvailable || perMonth === null) return line;
  return `${line} — about $${Math.max(1, Math.round(perMonth))}/mo`;
}

/** Honest checkout-failure copy (§3.1): a 400 about THIS plan/cycle must never
 *  read as a billing outage — `shots-manager/desktop-05-entry-upgrade-error.png`
 *  is the anti-pattern this replaces. */
function checkoutErrorCopy(err: unknown): string {
  if (err instanceof BillingApiError) {
    switch (err.code) {
      case "already_subscribed":
        return "You're already subscribed — refresh to see your plan.";
      case "invalid_plan":
      case "invalid_interval":
      case "invalid_tier":
        return "That plan isn't offered on this cycle — pick another.";
      default:
        break;
    }
  }
  return "Billing isn't available right now.";
}

// A billing error is honest, visible weather — the same danger-soft line the
// vaults card uses, not a quiet gray whisper that reads like a footnote.
function BillingErrorLine({ text }: { text: string }) {
  return (
    <p className="mt-3 rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
      {text}
    </p>
  );
}

// Trial/free state: the door's upgrade ladder as plan cards (from the door
// descriptor — the app doesn't know pricing, it just renders what the door
// advertised), current tier marked, each purchasable tier a straight trip to
// Stripe Checkout. A GLOBAL segmented interval picker (monthly/quarterly/
// yearly) sits above the grid — one selection for the whole ladder. Entry
// (F1's matrix hole: no monthly Price) disables its own button + shows its
// cheapest real cycle as a hint rather than ever sending a checkout call that
// will 400.
function UpgradePlans({ summary, plans }: { summary: AccountSummary; plans: DoorPlan[] }) {
  const availableIntervals = unionAvailableIntervals(plans);
  // The selection is DERIVED, not initialized: `plans` can arrive AFTER this
  // component first mounts (the descriptor fetch is independent of the
  // summary's — W2-8's progressive load), and a useState initializer computed
  // against the early empty ladder would pin `null` forever — the crash class
  // "static-write + stale-read". The user's pick applies only while it's still
  // a cycle the ladder sells; otherwise the cheapest available leads.
  // `null` ⇒ no plan published `intervals` data at all — the legacy path:
  // no picker, price_month display, interval-less checkout call.
  const [pickedInterval, setPickedInterval] = useState<BillingInterval | null>(null);
  const selectedInterval =
    pickedInterval !== null && availableIntervals.includes(pickedInterval)
      ? pickedInterval
      : (availableIntervals[0] ?? null);
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upgrade(tier: DoorPlan["id"]) {
    if (busyTier) return;
    setBusyTier(tier);
    setError(null);
    try {
      const { url } = selectedInterval
        ? await startCheckout(tier, selectedInterval)
        : await startCheckout(tier);
      window.location.assign(url);
    } catch (err) {
      setBusyTier(null);
      // Session expiry rides the app's session-ended handling, not a billing
      // message (see ManageBilling.manage).
      if (err instanceof SessionExpiredError) {
        useAccountSessionStore.getState().markExpired();
        return;
      }
      setError(checkoutErrorCopy(err));
    }
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-fg-muted">{planSummaryLine(summary)}</p>
      {selectedInterval && availableIntervals.length > 1 ? (
        <fieldset className="mt-4 flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">Billing interval</legend>
          {availableIntervals.map((key) => {
            const active = key === selectedInterval;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setPickedInterval(key)}
                aria-pressed={active}
                className={`chip focus-ring ${active ? "chip-tag-active font-medium" : "chip-tag"}`}
              >
                {INTERVAL_LABEL[key]}
              </button>
            );
          })}
        </fieldset>
      ) : null}
      {plans.length > 0 ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {plans.map((plan) => {
            const isCurrent = plan.id === summary.plan.tier;
            const selectedEntry = selectedInterval ? plan.intervals?.[selectedInterval] : undefined;
            // Legacy plans (no `intervals` data anywhere) always "can checkout"
            // — there's no cycle dimension to mismatch on.
            const canCheckoutSelected =
              availableIntervals.length === 0 || selectedEntry?.available === true;
            const priceLine = planPriceLine(plan, availableIntervals.length > 0);
            const fallback = canCheckoutSelected ? null : cheapestPlanInterval(plan);
            return (
              <li key={plan.id} className="rounded-xl border border-border bg-bg p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-serif text-lg text-fg">{plan.name}</span>
                  {isCurrent ? <span className="chip">Current</span> : null}
                </div>
                {priceLine ? <p className="mt-1 text-sm text-fg-muted">{priceLine}</p> : null}
                {typeof plan.vaults === "number" ? (
                  <p className="mt-0.5 text-xs text-fg-dim">
                    {plan.vaults} vault{plan.vaults === 1 ? "" : "s"}
                  </p>
                ) : null}
                {isCurrent ? null : canCheckoutSelected ? (
                  <button
                    type="button"
                    onClick={() => upgrade(plan.id)}
                    disabled={busyTier !== null}
                    className="btn btn-primary btn-sm btn-touch mt-3 w-full"
                  >
                    {busyTier === plan.id ? "Starting…" : `Upgrade to ${plan.name}`}
                  </button>
                ) : (
                  <div className="mt-3">
                    <button
                      type="button"
                      disabled
                      className="btn btn-secondary btn-sm btn-touch w-full"
                    >
                      Not available{" "}
                      {INTERVAL_LABEL[selectedInterval as BillingInterval].toLowerCase()}
                    </button>
                    {fallback ? (
                      <p className="mt-1 text-xs text-fg-dim">
                        Available from {formatIntervalPrice(fallback.entry, fallback.interval)}
                      </p>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? <BillingErrorLine text={error} /> : null}
    </div>
  );
}

// One honest line from whatever the summary carries — label, price/trial, and
// the two meters (vaults, storage) only when their limits are present.
function planSummaryLine(summary: AccountSummary): string {
  const { plan } = summary;
  const parts: string[] = [plan.label];
  if (typeof plan.trial_days_left === "number") {
    parts.push(`${plan.trial_days_left} day${plan.trial_days_left === 1 ? "" : "s"} left`);
  } else if (typeof plan.price_monthly_usd === "number" && plan.price_monthly_usd > 0) {
    parts.push(`$${plan.price_monthly_usd}/mo`);
  }
  // Both meters must be present — never fabricate a `0 of N` if a door reports
  // the limit but not the count (that would read as "no vaults used" falsely).
  if (typeof plan.vault_limit === "number" && typeof plan.vaults_used === "number") {
    parts.push(`${plan.vaults_used} of ${plan.vault_limit} vaults`);
  }
  const storage = formatBytes(plan.storage_used_bytes ?? 0);
  if (storage) {
    const cap = plan.storage_limit_bytes ? formatBytes(plan.storage_limit_bytes) : null;
    parts.push(cap ? `${storage} of ${cap}` : storage);
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Card 3 — Your vaults. Title + the "n of m on your plan" meter (only when the
// summary carries BOTH numbers — never fabricated), glyph rows, and ONE foot
// verb: "＋ Add a vault" → /add-vault (the chooser holds the create/connect
// fork). Failure keeps its retry card; empty keeps its warm first-vault door.
// ---------------------------------------------------------------------------

function VaultsCard({
  vaults,
  summary,
  onReload,
}: {
  vaults: VaultsState;
  summary: AccountSummary | null;
  onReload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  async function open(vault: AccountVault) {
    if (busyName) return;
    setBusyName(vault.name);
    setError(null);
    try {
      await openHostedVault(vault.name);
      // §4.4 switch-confirmation: "Now in {vault}".
      announceVaultSwitch(vault.name);
      // NAVIGATION.md: "Account.tsx VaultsBlock: Open {vault} → /" — user-
      // initiated, push.
      navigate("/");
    } catch (err) {
      setBusyName(null);
      // F12 — friendly copy, never a raw wire code.
      setError(describeAccountError(err, "Couldn't open that vault."));
    }
  }

  async function retry() {
    setRetrying(true);
    try {
      await onReload();
    } finally {
      setRetrying(false);
    }
  }

  // The meter needs both numbers — a limit without a count (or vice versa)
  // renders nothing rather than a fabricated "0 of N".
  const plan = summary?.plan;
  const meter =
    plan && typeof plan.vault_limit === "number" && typeof plan.vaults_used === "number"
      ? `${plan.vaults_used} of ${plan.vault_limit} on your plan`
      : null;

  return (
    <section aria-label="Your vaults" className="card p-6 shadow-soft">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-serif text-xl text-fg">Your vaults</h2>
        {meter ? <span className="text-xs text-fg-muted">{meter}</span> : null}
      </div>

      {vaults === "loading" ? (
        <div aria-busy="true" className="mt-4 space-y-2.5">
          <div className="skeleton h-9 rounded-lg" />
          <div className="skeleton h-9 w-4/5 rounded-lg" />
        </div>
      ) : vaults === "error" ? (
        // Load FAILED (not empty) — never the "create your first" nudge here, or
        // a transient 500 / session lapse invites a duplicate vault.
        <div className="mt-4 text-center">
          <p className="mb-1 font-serif text-lg text-fg">Couldn't load your vaults.</p>
          <p className="mb-5 text-sm text-fg-muted">
            A hiccup reaching your account — nothing's lost, your vaults are safe.
          </p>
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            className="btn btn-primary btn-touch"
          >
            {retrying ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : vaults.length === 0 ? (
        <div className="mt-4 text-center">
          <p className="mb-1 font-serif text-lg text-fg">No vaults yet.</p>
          <p className="mb-5 text-sm text-fg-muted">
            Create your first — a private home for your notes, always yours to export.
          </p>
          {/* NAVIGATION.md: card link — user-initiated, push. */}
          <Link to="/add-vault/create" className="btn btn-primary btn-touch">
            Create a vault
          </Link>
        </div>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-border-light">
            {vaults.map((vault) => {
              const usage = formatUsageBytes(vault.usage);
              const address = vault.url ? vault.url.replace(/^https?:\/\//, "") : null;
              return (
                <li key={vault.name} className="flex items-center gap-3 py-3">
                  <VaultGlyph name={vault.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-serif text-lg leading-snug text-fg">{vault.name}</p>
                    {address ? <p className="mt-0.5 truncate note-id">{address}</p> : null}
                    {usage ? <p className="mt-0.5 text-xs text-fg-muted">{usage}</p> : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => open(vault)}
                    disabled={busyName === vault.name}
                    className="btn btn-primary btn-sm btn-touch shrink-0"
                  >
                    {busyName === vault.name ? "Opening…" : "Open →"}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 border-t border-border-light pt-3 text-sm">
            {/* NAVIGATION.md: card link — user-initiated, push. ONE verb — the
                chooser at /add-vault holds the create/connect fork (§3.1). */}
            <Link to="/add-vault" className="focus-ring font-semibold text-accent hover:underline">
              ＋ Add a vault
            </Link>
          </p>
        </>
      )}

      {error ? (
        <p className="mt-4 rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

// The vault-initial glyph in a grass-soft circle — the switcher's identity
// mark, echoed here (§3.1 Card 3 row anatomy).
function VaultGlyph({ name }: { name: string }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-grass-soft text-sm font-semibold text-grass-ink"
    >
      {initial}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Card 4 — Connections. Icon-in-soft-circle rows (adopt #9): Connect your
// AI → /connect, Import notes → /import, Export notes → /export (Wave-3 —
// Import's sibling: "Open format. Export anytime." finally has a door). With
// no active vault the AI row dims with the honest pointer — a vault is the
// thing an AI connects TO. Import and Export both stay reachable regardless —
// each page holds its own no-vault state (route-guard redirect).
// ---------------------------------------------------------------------------

function ConnectionsCard({ hasActiveVault }: { hasActiveVault: boolean }) {
  return (
    <section aria-label="Connections" className="card p-6 shadow-soft">
      <h2 className="font-serif text-xl text-fg">Connections</h2>
      <div className="mt-2 divide-y divide-border-light">
        {hasActiveVault ? (
          <ConnectionRow
            to="/connect"
            tone="sky"
            icon={<IconSpark width={18} height={18} />}
            title="Connect your AI"
            description="Claude, ChatGPT, or any MCP client — one memory, shared."
          />
        ) : (
          <div className="-mx-2 flex items-center gap-3 px-2 py-3 opacity-60">
            <ConnectionCircle tone="sky">
              <IconSpark width={18} height={18} />
            </ConnectionCircle>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-fg">Connect your AI</p>
              <p className="mt-0.5 text-sm text-fg-muted">
                Open a vault above to connect an AI to it.
              </p>
            </div>
          </div>
        )}
        <ConnectionRow
          to="/import"
          tone="grass"
          icon={<IconImport width={18} height={18} />}
          title="Import notes"
          description="Bring your notes over from anywhere markdown lives."
        />
        <ConnectionRow
          to="/export"
          tone="sun"
          icon={<IconExport width={18} height={18} />}
          title="Export notes"
          description="Download your vault as open Markdown — yours to keep."
        />
      </div>
    </section>
  );
}

function ConnectionRow({
  to,
  tone,
  icon,
  title,
  description,
}: {
  to: string;
  tone: "sky" | "grass" | "sun";
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    // NAVIGATION.md: card link — user-initiated, push.
    <Link
      to={to}
      className="focus-ring -mx-2 flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-bg-soft"
    >
      <ConnectionCircle tone={tone}>{icon}</ConnectionCircle>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-fg">{title}</span>
        <span className="mt-0.5 block text-sm text-fg-muted">{description}</span>
      </span>
      <span aria-hidden className="shrink-0 text-lg text-fg-dim">
        ›
      </span>
    </Link>
  );
}

// The 36–40px tinted soft circle behind a thin-stroke icon (adopt #9). Sky =
// the "connected apps" voice; grass = notes coming home to the vault; sun =
// notes going back out into the light (Export's mirror of grass).
function ConnectionCircle({
  tone,
  children,
}: {
  tone: "sky" | "grass" | "sun";
  children: ReactNode;
}) {
  const toneClass =
    tone === "grass"
      ? "bg-grass-soft text-grass-ink"
      : tone === "sun"
        ? "bg-sun-soft text-sun-ink"
        : "bg-bg-soft";
  return (
    <span
      aria-hidden
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${toneClass}`}
      style={tone === "sky" ? { color: "var(--color-sky)" } : undefined}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// No cloud door / signed out: manage what's on THIS device. Honest — no
// account or plan sections (there's no account to speak of here), just the
// local vaults and the way in.
// ---------------------------------------------------------------------------

function DeviceView() {
  const vaults = useVaultStore((s) => s.vaults);
  const list = Object.values(vaults);
  return (
    <div className="space-y-6">
      <section className="card p-6 shadow-soft">
        <h2 className="font-serif text-xl text-fg">This device</h2>
        <p className="mt-1 text-sm text-fg-muted">
          You're managing the vaults connected on this device. Sign in to your account to manage
          your plan and hosted vaults from anywhere.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/" className="btn btn-primary btn-touch">
            Sign in
          </Link>
          <Link to="/vaults" className="btn btn-ghost btn-touch">
            {list.length > 0 ? `${list.length} connected` : "Connect a vault"}
          </Link>
        </div>
      </section>
      <ConnectionsCard hasActiveVault={list.length > 0} />
    </div>
  );
}
