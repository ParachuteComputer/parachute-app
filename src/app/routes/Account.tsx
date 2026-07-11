import { getAccountSummary, getSession, listVaults, logout } from "@/lib/account/client";
import { openHostedVault } from "@/lib/account/hosted-vault";
import { formatBytes, formatUsageBytes, manageBillingUrl } from "@/lib/account/provenance";
import { clearAccountToken } from "@/lib/account/store";
import type { AccountSummary, AccountVault } from "@/lib/account/types";
import { useVaultStore } from "@/lib/vault";
import { useEffect, useState } from "react";
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
      csrf: string;
      vaults: AccountVault[];
      summary: AccountSummary | null;
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
      // Both reads ride the same account bearer; each degrades on its own
      // (an empty list / an absent summary never strands the screen).
      const [vaultsRes, summary] = await Promise.all([
        listVaults().catch(() => ({ vaults: [] as AccountVault[] })),
        getAccountSummary(),
      ]);
      if (live) {
        setView({
          kind: "manager",
          email: session.email,
          csrf: session.csrf,
          vaults: vaultsRes.vaults,
          summary,
        });
      }
    })();
    return () => {
      live = false;
    };
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
          csrf={view.csrf}
          vaults={view.vaults}
          summary={view.summary}
        />
      )}
    </div>
  );
}

// The signed-in account manager: who you are + plan, your Cloud vaults, and AI
// connections — everything driven by the account bearer.
function ManagerView({
  email,
  csrf,
  vaults,
  summary,
}: {
  email?: string;
  csrf: string;
  vaults: AccountVault[];
  summary: AccountSummary | null;
}) {
  const navigate = useNavigate();
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const firstCloudVaultUrl = vaults.find((v) => v.url)?.url ?? null;
  const billingUrl = manageBillingUrl(summary, firstCloudVaultUrl);

  async function signOut() {
    try {
      await logout(csrf);
    } finally {
      clearAccountToken();
      navigate("/", { replace: true });
    }
  }

  return (
    <div className="space-y-8">
      <AccountBlock email={email} summary={summary} billingUrl={billingUrl} onSignOut={signOut} />
      <VaultsBlock vaults={vaults} />
      <ConnectionsBlock hasActiveVault={!!activeVault} />
    </div>
  );
}

// "Signed in as X" + the plan/usage line (only when the summary is present —
// never fabricated) + the one true trip out: Manage plan & billing.
function AccountBlock({
  email,
  summary,
  billingUrl,
  onSignOut,
}: {
  email?: string;
  summary: AccountSummary | null;
  billingUrl: string | null;
  onSignOut: () => void;
}) {
  const planLine = summary ? planSummaryLine(summary) : null;
  return (
    <section aria-label="Account" className="card rounded-xl p-6 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-1">Signed in as</p>
          <p className="truncate font-serif text-xl text-fg">{email ?? "your account"}</p>
          {planLine ? (
            <p className="mt-2 text-sm text-fg-muted">{planLine}</p>
          ) : (
            <p className="mt-2 text-sm text-fg-dim">
              Your plan lives on the door you signed in to.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="focus-ring shrink-0 text-sm text-fg-dim hover:text-accent"
        >
          Sign out
        </button>
      </div>
      {billingUrl ? (
        <div className="mt-5 border-t border-border pt-5">
          <a href={billingUrl} className="btn btn-primary btn-touch">
            Manage plan &amp; billing ↗
          </a>
          <p className="mt-2 text-xs text-fg-dim">
            Payment and plan changes happen on the door, then you land right back here.
          </p>
        </div>
      ) : null}
    </section>
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
  if (typeof plan.vault_limit === "number") {
    parts.push(`${plan.vaults_used ?? 0} of ${plan.vault_limit} vaults`);
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
function VaultsBlock({ vaults }: { vaults: AccountVault[] }) {
  const navigate = useNavigate();
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(vault: AccountVault) {
    if (busyName) return;
    setBusyName(vault.name);
    setError(null);
    try {
      await openHostedVault(vault.name);
      navigate("/", { replace: true });
    } catch (err) {
      setBusyName(null);
      setError(err instanceof Error ? err.message : "Couldn't open that vault.");
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

      {vaults.length === 0 ? (
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

      <p className="mt-4 font-round text-sm text-fg-muted">
        <Link to="/welcome?new=1" className="font-semibold text-accent hover:underline">
          ＋ Create a new vault
        </Link>{" "}
        ·{" "}
        <Link
          to="/add"
          className="font-semibold hover:underline"
          style={{ color: "var(--color-sage)" }}
        >
          Connect a self-hosted vault
        </Link>
      </p>
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
