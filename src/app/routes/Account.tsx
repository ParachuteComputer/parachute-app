import {
  BillingApiError,
  SessionExpiredError,
  getAccountSummary,
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
import { useVaultStore } from "@/lib/vault";
import { announceVaultSwitch } from "@/lib/vault/switch";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

// The Account surface — the app AS the manager (SYNTHESIS "The shape"). The
// person lives HERE and drives their whole account through the account bearer;
// Cloud shrinks to the counter you visit only to sign up, pay, or change plan.
// Everything else — open/create vaults, view plan + usage, manage AI
// connections — happens in the app.
//
// Door-agnostic + graceful: reads the account API at the SERVING origin (never a
// hardcoded cloud host). When there's no cloud door / no session (a self-host
// device, or signed out), it degrades to a calm "this device" view — local
// vaults + connect + AI, no account/plan sections, never a crash.
type View =
  | { kind: "loading" }
  | {
      kind: "manager";
      email?: string;
      /** HUB-PARITY P4: a password door may sign in under a username instead
       *  of an email; "Signed in as X" falls back `email ?? username`. */
      username?: string;
      csrf: string;
      // null = the vault list FAILED to load (transient 500 / session lapse).
      // Distinct from [] (genuinely no vaults) so we never show the "create your
      // first" empty-state on a failure — that would invite a duplicate vault.
      vaults: AccountVault[] | null;
      summary: AccountSummary | null;
      // The door descriptor's `plans` ladder powers the Billing section's
      // upgrade cards (trial/free state). `null` on any fetch failure — the
      // Billing section degrades to no cards rather than fabricating a ladder.
      descriptor: DoorDescriptor | null;
    }
  | { kind: "device" };

export function Account() {
  const [view, setView] = useState<View>({ kind: "loading" });

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
      if (!session.signed_in) {
        if (live) setView({ kind: "device" });
        return;
      }
      // Both reads ride the same account bearer; each degrades on its own. A
      // vault-load FAILURE resolves to null (→ a "couldn't load, retry" card),
      // NOT [] — an empty list must mean genuinely-no-vaults, or we'd nudge a
      // signed-in person to create a duplicate. An absent summary is just null.
      // The door descriptor is same-origin + public (no bearer needed) and
      // never throws — it's fetched alongside for the Billing section's
      // upgrade-plan cards.
      const [vaults, summary, descriptor] = await Promise.all([
        listVaults()
          .then((r) => r.vaults)
          .catch((err) => {
            // HUB-PARITY P4 weather: the account-token mint underlying this
            // call may 403 force_change_password / 423 — surface the
            // matching non-blocking gate rather than just degrading to null.
            markHubGateFromError(err);
            return null;
          }),
        getAccountSummary(),
        getDoorDescriptor(),
      ]);
      if (live) {
        setView({
          kind: "manager",
          email: session.email,
          username: session.username,
          csrf: session.csrf,
          vaults,
          summary,
          descriptor,
        });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Retry just the vault list (the "Couldn't load your vaults" card), leaving
  // the rest of the manager view in place.
  const reloadVaults = useCallback(async () => {
    try {
      const { vaults } = await listVaults();
      setView((v) => (v.kind === "manager" ? { ...v, vaults } : v));
    } catch {
      setView((v) => (v.kind === "manager" ? { ...v, vaults: null } : v));
    }
  }, []);

  return (
    <div className="page-prose">
      <header className="mb-8">
        <nav className="mb-4 text-sm text-fg-dim">
          <Link to="/" className="focus-ring hover:text-accent">
            ← Home
          </Link>
        </nav>
        <h1 className="page-title">Account</h1>
        <p className="mt-2 max-w-prose text-fg-muted">
          Managed here. Cloud is just the counter you visit to sign up, pay, or change plan —
          everything else lives in the app, held by your account.
        </p>
      </header>

      {view.kind === "loading" ? (
        <output aria-live="polite" className="block py-10 text-center text-sm text-fg-dim">
          <span className="animate-pulse">Loading your account…</span>
        </output>
      ) : view.kind === "device" ? (
        <DeviceView />
      ) : (
        <ManagerView
          email={view.email}
          username={view.username}
          csrf={view.csrf}
          vaults={view.vaults}
          summary={view.summary}
          descriptor={view.descriptor}
          onReloadVaults={reloadVaults}
        />
      )}
    </div>
  );
}

// The signed-in account manager: who you are, plan + billing, your Cloud
// vaults, and AI connections — everything driven by the account bearer.
function ManagerView({
  email,
  username,
  csrf,
  vaults,
  summary,
  descriptor,
  onReloadVaults,
}: {
  email?: string;
  username?: string;
  csrf: string;
  vaults: AccountVault[] | null;
  summary: AccountSummary | null;
  descriptor: DoorDescriptor | null;
  onReloadVaults: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const activeVault = useVaultStore((s) => s.getActiveVault());

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
    <div className="space-y-8">
      <AccountBlock email={email} username={username} onSignOut={signOut} />
      <BillingSection summary={summary} descriptor={descriptor} />
      <VaultsBlock vaults={vaults} onReload={onReloadVaults} />
      <ConnectionsBlock hasActiveVault={!!activeVault} />
    </div>
  );
}

// "Signed in as X" + sign out. Plan + billing live in their own section below
// (BillingSection) — this card is identity only.
function AccountBlock({
  email,
  username,
  onSignOut,
}: {
  email?: string;
  username?: string;
  onSignOut: () => void;
}) {
  return (
    <section aria-label="Account" className="card rounded-xl p-6 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-1">Signed in as</p>
          <p className="truncate font-serif text-xl text-fg">
            {email ?? username ?? "your account"}
          </p>
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

// The Billing section — the ONE trip out to Stripe (Plan A: straight from the
// app, no cloud-console re-login). Pure presentation over data the account
// summary + door descriptor already handed us: zero Stripe knowledge, zero
// pricing math, zero cloud origin — just two typed redirect calls.
//
// Absent entirely when the door has no billing wired (self-hosted hub / no
// Stripe configured) — there's nothing honest to show, so the section simply
// doesn't exist.
function BillingSection({
  summary,
  descriptor,
}: {
  summary: AccountSummary | null;
  descriptor: DoorDescriptor | null;
}) {
  if (!summary?.billing_enabled) return null;
  return (
    <section aria-label="Billing" className="card rounded-xl p-6 shadow-soft">
      <h2 className="font-serif text-xl text-fg">Billing</h2>
      {summary.has_billing_customer ? (
        <ManageBilling summary={summary} />
      ) : (
        <UpgradePlans summary={summary} plans={descriptor?.plans ?? []} />
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
      {error ? <p className="mt-2 text-xs text-fg-dim">{error}</p> : null}
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

// Trial/free state: the door's upgrade ladder as plan cards (from the door
// descriptor — the app doesn't know pricing, it just renders what the door
// advertised), current tier marked, each purchasable tier a straight trip to
// Stripe Checkout. A GLOBAL segmented interval picker (monthly/quarterly/
// yearly) sits above the grid — one selection for the whole ladder, since
// Standard/Plus/Power sell all three cycles and a per-card picker would just
// repeat the same three buttons three times. Entry (F1's matrix hole: no
// monthly Price) disables its own button + shows its cheapest real cycle as a
// hint rather than ever sending a checkout call that will 400.
function UpgradePlans({ summary, plans }: { summary: AccountSummary; plans: DoorPlan[] }) {
  const availableIntervals = unionAvailableIntervals(plans);
  // `null` ⇒ no plan published `intervals` data at all — the legacy path:
  // no picker, price_month display, interval-less checkout call.
  const [selectedInterval, setSelectedInterval] = useState<BillingInterval | null>(
    availableIntervals[0] ?? null,
  );
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
      setError(
        err instanceof BillingApiError && err.code === "already_subscribed"
          ? "You're already subscribed — refresh to see your plan."
          : "Billing isn't available right now.",
      );
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
                onClick={() => setSelectedInterval(key)}
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
            const priceLine =
              availableIntervals.length === 0
                ? typeof plan.price_month === "number"
                  ? `$${plan.price_month}/mo`
                  : null
                : selectedEntry?.available
                  ? formatIntervalPrice(selectedEntry, selectedInterval as BillingInterval)
                  : null;
            const fallback = canCheckoutSelected ? null : cheapestPlanInterval(plan);
            return (
              <li key={plan.id} className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-serif text-base text-fg">{plan.name}</span>
                  {isCurrent ? <span className="chip">Current</span> : null}
                </div>
                {priceLine ? <p className="mt-1 text-sm text-fg-muted">{priceLine}</p> : null}
                {typeof plan.vaults === "number" ? (
                  <p className="text-xs text-fg-dim">{plan.vaults} vaults</p>
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
      {error ? <p className="mt-2 text-xs text-fg-dim">{error}</p> : null}
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

// The account's Cloud vaults (the endpoint returns only these — all `Cloud`).
// Every card verb is Open; the self-hosted device list lives on /vaults.
function VaultsBlock({
  vaults,
  onReload,
}: {
  vaults: AccountVault[] | null;
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
      // initiated, push (was a gratuitous replace — F7 offender).
      navigate("/");
    } catch (err) {
      setBusyName(null);
      // F12 — same friendly-copy mapping as the create-vault naming form:
      // never a raw wire code.
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

  return (
    <section aria-label="Your vaults">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="eyebrow">Your vaults</h2>
        <Link to="/vaults" className="focus-ring text-sm text-fg-dim hover:text-accent">
          All on this device →
        </Link>
      </div>

      {vaults === null ? (
        // Load FAILED (not empty) — never the "create your first" nudge here, or
        // a transient 500 / session lapse invites a duplicate vault.
        <div className="card rounded-xl p-6 text-center shadow-soft">
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
        <div className="card rounded-xl p-6 text-center shadow-soft">
          <p className="mb-1 font-serif text-lg text-fg">No vaults yet.</p>
          <p className="mb-5 text-sm text-fg-muted">
            Create your first — a private home for your notes, always yours to export.
          </p>
          <Link to="/welcome?new=1" className="btn btn-primary btn-touch">
            Create a vault
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {vaults.map((vault) => {
            const usage = formatUsageBytes(vault.usage);
            const address = vault.url ? vault.url.replace(/^https?:\/\//, "") : null;
            return (
              <li key={vault.name} className="card rounded-xl p-5 shadow-soft">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-serif text-lg text-fg">{vault.name}</span>
                      <span className="chip">☁ Cloud</span>
                    </div>
                    {address ? <p className="mt-1 truncate note-id">{address}</p> : null}
                    {usage ? (
                      <p className="mt-0.5 font-round text-xs text-fg-muted">{usage}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => open(vault)}
                    disabled={busyName === vault.name}
                    className="btn btn-primary btn-touch shrink-0 rounded-full"
                  >
                    {busyName === vault.name ? "Opening…" : "Open →"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p className="mt-4 rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {vaults !== null ? (
        <p className="mt-4 font-round text-sm text-fg-muted">
          <Link to="/welcome?new=1" className="font-semibold text-accent hover:underline">
            ＋ Create a new vault
          </Link>{" "}
          ·{" "}
          <Link
            to="/add"
            className="font-semibold hover:underline"
            style={{ color: "var(--color-sky)" }}
          >
            Connect a self-hosted vault
          </Link>
        </p>
      ) : null}
    </section>
  );
}

// AI connections live per-vault (the MCP URL is a vault address), so this is a
// pointer to the existing Connect surface — or a nudge to open a vault first.
function ConnectionsBlock({ hasActiveVault }: { hasActiveVault: boolean }) {
  return (
    <section aria-label="AI connections" className="card rounded-xl p-6 shadow-soft">
      <h2 className="font-serif text-xl text-fg">AI connections</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Invite Claude, ChatGPT, or any MCP client into a vault — one memory, shared with every
        assistant you choose.
      </p>
      <div className="mt-4">
        {hasActiveVault ? (
          <Link to="/connect" className="btn btn-primary btn-touch">
            Manage AI connections
          </Link>
        ) : (
          <p className="text-sm text-fg-dim">Open a vault above to connect an AI to it.</p>
        )}
      </div>
    </section>
  );
}

// No cloud door / signed out: manage what's on THIS device. Honest — no account
// or plan sections (there's no account to speak of here), just the local vaults
// and the way in.
function DeviceView() {
  const vaults = useVaultStore((s) => s.vaults);
  const list = Object.values(vaults);
  return (
    <div className="space-y-8">
      <section className="card rounded-xl p-6 shadow-soft">
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
      <ConnectionsBlock hasActiveVault={list.length > 0} />
    </div>
  );
}
