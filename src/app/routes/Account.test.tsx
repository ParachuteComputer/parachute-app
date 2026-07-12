import { Account } from "@/app/routes/Account";
import {
  AccountApiError,
  BillingApiError,
  SessionExpiredError,
  getAccountSummaryState,
  getSession,
  listVaults,
  openBillingPortal,
  startCheckout,
} from "@/lib/account/client";
import { getDoorDescriptor } from "@/lib/account/descriptor";
import { HOSTED_CLIENT_ID, openHostedVault } from "@/lib/account/hosted-vault";
import { useAccountSessionStore } from "@/lib/account/store";
import type { AccountSummary, DoorPlan } from "@/lib/account/types";
import { useVaultStore } from "@/lib/vault";
import { type NavLogEntry, NavTypeLog } from "@/test/nav-probe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// "Your parachute" — the four-card manager home (DESIGN-SPEC §3.1, W2-8):
// Identity · Plan & billing (five states) · Vaults · Connections. Degrades to
// a calm "this device" view with no cloud door / signed out.

// Spreads the REAL module (not a bare object) so `AccountApiError` /
// `SessionExpiredError` stay the real classes — `markHubGateFromError`
// (dispatch.ts, HUB-PARITY P4) does an `instanceof AccountApiError` check on
// whatever `listVaults()` rejects with, and a bare-object mock without those
// classes would make that check throw (`instanceof` on `undefined`).
vi.mock("@/lib/account/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/account/client")>("@/lib/account/client");
  return {
    ...actual,
    getSession: vi.fn(),
    listVaults: vi.fn(),
    getAccountSummaryState: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    openBillingPortal: vi.fn(),
    startCheckout: vi.fn(),
  };
});
vi.mock("@/lib/account/hosted-vault", async () => {
  const actual = await vi.importActual<typeof import("@/lib/account/hosted-vault")>(
    "@/lib/account/hosted-vault",
  );
  return {
    ...actual,
    openHostedVault: vi.fn().mockResolvedValue("v1"),
  };
});
vi.mock("@/lib/account/descriptor", async () => {
  const actual = await vi.importActual<typeof import("@/lib/account/descriptor")>(
    "@/lib/account/descriptor",
  );
  return {
    ...actual,
    getDoorDescriptor: vi.fn().mockResolvedValue(null),
  };
});

const PLANS: DoorPlan[] = [
  { id: "entry", name: "Entry", vaults: 1, price_month: 0 },
  { id: "standard", name: "Standard", vaults: 3, price_month: 5 },
  { id: "plus", name: "Plus", vaults: 10, price_month: 15 },
];

// F1/F3/F5 — the live shape cloud now publishes: Entry has NO monthly Price
// (Stripe's flat fee eats a $1 charge), Standard sells all three cycles.
const PLANS_WITH_INTERVALS: DoorPlan[] = [
  {
    id: "entry",
    name: "Entry",
    vaults: 1,
    price_month: 1,
    intervals: {
      monthly: { available: false },
      quarterly: { available: true, price: 3, label: "$3/quarter" },
      yearly: { available: true, price: 10, label: "$10/yr" },
    },
  },
  {
    id: "standard",
    name: "Standard",
    vaults: 3,
    price_month: 5,
    intervals: {
      monthly: { available: true, price: 5, label: "$5/mo" },
      quarterly: { available: true, price: 12, label: "$12/quarter" },
      yearly: { available: true, price: 40, label: "$40/yr" },
    },
  },
];

// Only Entry offered — no plan in the ladder sells monthly, so the picker
// must not show a "Monthly" pill at all (the union-across-tiers filter).
const ENTRY_ONLY_INTERVALS: DoorPlan[] = [
  {
    id: "entry",
    name: "Entry",
    vaults: 1,
    price_month: 1,
    intervals: {
      monthly: { available: false },
      quarterly: { available: true, price: 3, label: "$3/quarter" },
      yearly: { available: true, price: 10, label: "$10/yr" },
    },
  },
];

const SUMMARY: AccountSummary = {
  email: "ag@unforced.org",
  plan: {
    tier: "standard",
    label: "Standard",
    price_monthly_usd: 5,
    vault_limit: 3,
    vaults_used: 1,
  },
  billing_enabled: true,
  has_billing_customer: true,
};

const TRIAL_SUMMARY: AccountSummary = {
  email: "ag@unforced.org",
  plan: { tier: "trial", label: "Free trial", trial_days_left: 5 },
  billing_enabled: true,
  has_billing_customer: false,
};

const CLOUD_VAULT = { name: "moss", url: "https://u.parachute.computer/vault/moss" };

function signedIn() {
  vi.mocked(getSession).mockResolvedValue({
    signed_in: true,
    csrf: "c",
    email: "ag@unforced.org",
  });
}

function renderAccount(navLog?: NavLogEntry[]) {
  // A FRESH QueryClient per render — the shared account-summary query must not
  // leak cached answers between tests.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <MemoryRouter initialEntries={["/account"]}>
      <QueryClientProvider client={qc}>
        {navLog ? <NavTypeLog log={navLog} /> : null}
        <Routes>
          <Route path="/account" element={<Account />} />
          <Route path="/" element={<div>Home surface</div>} />
          <Route path="/connect" element={<div>Connect surface</div>} />
          <Route path="/import" element={<div>Import surface</div>} />
          <Route path="/export" element={<div>Export surface</div>} />
          <Route path="/vaults" element={<div>Vaults surface</div>} />
          <Route path="/add-vault" element={<div>Chooser surface</div>} />
          <Route path="/add" element={<div>Add surface</div>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useVaultStore.setState({ vaults: {}, activeVaultId: null });
  useAccountSessionStore.setState({ expired: false, gate: null });
  vi.mocked(getSession).mockReset();
  vi.mocked(listVaults).mockReset();
  vi.mocked(getAccountSummaryState).mockReset();
  vi.mocked(openHostedVault).mockReset().mockResolvedValue("v1");
  vi.mocked(openBillingPortal).mockReset();
  vi.mocked(startCheckout).mockReset();
  vi.mocked(getDoorDescriptor).mockReset().mockResolvedValue(null);
});
afterEach(() => {
  useVaultStore.setState({ vaults: {}, activeVaultId: null });
  useAccountSessionStore.setState({ expired: false, gate: null });
});

describe("Account — 'Your parachute', the four-card manager home", () => {
  it("renders the header and the four cards: identity, plan & billing, vaults, connections", async () => {
    signedIn();
    vi.mocked(listVaults).mockResolvedValue({
      vaults: [{ ...CLOUD_VAULT, usage: { notes_bytes: 68 * 1024 * 1024 } }],
    });
    vi.mocked(getAccountSummaryState).mockResolvedValue(SUMMARY);

    renderAccount();
    expect(screen.getByRole("heading", { name: "Your parachute" })).toBeInTheDocument();
    // No "← Home" breadcrumb — a primary-nav room (F11).
    expect(screen.queryByRole("link", { name: /← home/i })).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("ag@unforced.org")).toBeInTheDocument());
    expect(screen.getByText(/signed in as/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plan & billing" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your vaults" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connections" })).toBeInTheDocument();
    expect(await screen.findByText(/1 of 3 vaults/)).toBeInTheDocument();
    expect(screen.getByText(/\$5\/mo/)).toBeInTheDocument();
    expect(screen.getByText("moss")).toBeInTheDocument();
    expect(screen.getByText(/68 MB/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open →/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /manage plan & billing/i })).toBeInTheDocument();
  });

  // NAVIGATION.md: "Sign out → /" — replace; the session context is gone, so
  // Back into a signed-in page would lie.
  it("Sign out REPLACEs / (NAVIGATION.md)", async () => {
    const navLog: NavLogEntry[] = [];
    signedIn();
    vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
    vi.mocked(getAccountSummaryState).mockResolvedValue(null);

    renderAccount(navLog);
    await waitFor(() => expect(screen.getByText("ag@unforced.org")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^sign out$/i }));
    await waitFor(() => expect(navLog.at(-1)).toEqual({ type: "REPLACE", pathname: "/" }));
  });

  it("shows the device view when signed out — no account/plan sections", async () => {
    vi.mocked(getSession).mockResolvedValue({ signed_in: false, csrf: "c" });
    renderAccount();
    await waitFor(() => expect(screen.getByText("This device")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.queryByText(/manage plan & billing/i)).not.toBeInTheDocument();
    expect(listVaults).not.toHaveBeenCalled();
  });

  it("shows the device view when the door is unreachable (never crashes)", async () => {
    vi.mocked(getSession).mockRejectedValue(new Error("offline"));
    renderAccount();
    await waitFor(() => expect(screen.getByText("This device")).toBeInTheDocument());
  });

  it("opens a Cloud vault → mints its token and lands Home", async () => {
    signedIn();
    vi.mocked(listVaults).mockResolvedValue({ vaults: [CLOUD_VAULT] });
    vi.mocked(getAccountSummaryState).mockResolvedValue(null);

    renderAccount();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /open →/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /open →/i }));
    await waitFor(() => expect(openHostedVault).toHaveBeenCalledWith("moss"));
    await waitFor(() => expect(screen.getByText("Home surface")).toBeInTheDocument());
  });

  // NAVIGATION.md: "Account.tsx VaultsBlock: Open {vault} → /" — user-
  // initiated, push (F7 offender: this used to be a gratuitous replace).
  it("opening a Cloud vault PUSHes / (NAVIGATION.md)", async () => {
    const navLog: NavLogEntry[] = [];
    signedIn();
    vi.mocked(listVaults).mockResolvedValue({ vaults: [CLOUD_VAULT] });
    vi.mocked(getAccountSummaryState).mockResolvedValue(null);

    renderAccount(navLog);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /open →/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /open →/i }));
    await waitFor(() => expect(screen.getByText("Home surface")).toBeInTheDocument());
    expect(navLog.at(-1)).toEqual({ type: "PUSH", pathname: "/" });
  });

  // F12 — same friendly-copy mapping as the create-vault naming form: never a
  // raw wire code.
  it("maps a bare wire code to friendly copy when opening a vault fails", async () => {
    signedIn();
    vi.mocked(listVaults).mockResolvedValue({ vaults: [CLOUD_VAULT] });
    vi.mocked(getAccountSummaryState).mockResolvedValue(null);
    vi.mocked(openHostedVault).mockRejectedValue(new AccountApiError(403, "not_owner"));

    renderAccount();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /open →/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /open →/i }));
    await waitFor(() =>
      expect(screen.getByText(/isn't linked to this account/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText("not_owner")).not.toBeInTheDocument();
  });

  it("shows a retry card (NOT the empty-state) when the vault list fails to load", async () => {
    signedIn();
    vi.mocked(listVaults).mockRejectedValue(new Error("500"));
    vi.mocked(getAccountSummaryState).mockResolvedValue(null);

    renderAccount();
    await waitFor(() => expect(screen.getByText(/couldn't load your vaults/i)).toBeInTheDocument());
    // The empty-state / create affordances must NOT show on a failure (that would
    // invite a duplicate vault).
    expect(screen.queryByText(/no vaults yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /add a vault/i })).not.toBeInTheDocument();

    // Retry re-fetches and renders the list.
    vi.mocked(listVaults).mockResolvedValue({ vaults: [CLOUD_VAULT] });
    fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    await waitFor(() => expect(screen.getByText("moss")).toBeInTheDocument());
  });

  // HUB-PARITY P4 — a password door may sign a person in under `username`
  // instead of `email`. "Signed in as X" falls back `email ?? username`.
  it("falls back to username in the header when a hub-shaped session has no email", async () => {
    vi.mocked(getSession).mockResolvedValue({ signed_in: true, csrf: "c", username: "aaron" });
    vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
    vi.mocked(getAccountSummaryState).mockResolvedValue(null);

    renderAccount();
    await waitFor(() => expect(screen.getByText("aaron")).toBeInTheDocument());
  });

  // HUB-PARITY P4 weather (design §2 row 4): the account-token mint underlying
  // listVaults() can 403 force_change_password / 423 — surface the matching
  // non-blocking gate (`useAccountSessionStore`) rather than just degrading.
  describe("hub gates (force_change_password / admin_locked)", () => {
    it("a 403 force_change_password on the underlying token mint marks the gate", async () => {
      vi.mocked(getSession).mockResolvedValue({ signed_in: true, csrf: "c", username: "aaron" });
      vi.mocked(listVaults).mockRejectedValue(new AccountApiError(403, "force_change_password"));
      vi.mocked(getAccountSummaryState).mockResolvedValue(null);

      renderAccount();
      await waitFor(() =>
        expect(screen.getByText(/couldn't load your vaults/i)).toBeInTheDocument(),
      );
      expect(useAccountSessionStore.getState().gate).toBe("force_change_password");
    });

    it("a 423 marks the admin_locked gate", async () => {
      vi.mocked(getSession).mockResolvedValue({ signed_in: true, csrf: "c", username: "aaron" });
      vi.mocked(listVaults).mockRejectedValue(new AccountApiError(423, "admin_locked"));
      vi.mocked(getAccountSummaryState).mockResolvedValue(null);

      renderAccount();
      await waitFor(() =>
        expect(screen.getByText(/couldn't load your vaults/i)).toBeInTheDocument(),
      );
      expect(useAccountSessionStore.getState().gate).toBe("admin_locked");
    });

    it("an ordinary failure (not a hub gate) never sets a gate", async () => {
      signedIn();
      vi.mocked(listVaults).mockRejectedValue(new Error("500"));
      vi.mocked(getAccountSummaryState).mockResolvedValue(null);

      renderAccount();
      await waitFor(() =>
        expect(screen.getByText(/couldn't load your vaults/i)).toBeInTheDocument(),
      );
      expect(useAccountSessionStore.getState().gate).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // Card 1 — Identity: the plan chip (§3.1). Trialing → sun chip with the
  // countdown; paid → the quiet plan-label chip; failed/absent → NO chip
  // (the retry affordance lives in Card 2, never a badge).
  // ---------------------------------------------------------------------
  describe("the identity card's plan chip", () => {
    it("shows the trial countdown chip while trialing", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummaryState).mockResolvedValue(TRIAL_SUMMARY);

      renderAccount();
      await waitFor(() => expect(screen.getByText("ag@unforced.org")).toBeInTheDocument());
      const identity = screen.getByRole("region", { name: "Account" });
      expect(await within(identity).findByText(/free trial · 5 days left/i)).toBeInTheDocument();
    });

    it("shows the quiet plan-label chip when paid", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummaryState).mockResolvedValue(SUMMARY);

      renderAccount();
      await waitFor(() => expect(screen.getByText("ag@unforced.org")).toBeInTheDocument());
      const identity = screen.getByRole("region", { name: "Account" });
      expect(await within(identity).findByText("Standard")).toBeInTheDocument();
    });

    it("shows NO chip when the summary fetch failed (the retry lives in Card 2)", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummaryState).mockResolvedValue("error");

      renderAccount();
      // Wait for the summary to have RESOLVED (to "error" — the retry card
      // shows in Card 2) so the no-chip assertion can't pass vacuously early.
      await waitFor(() => expect(screen.getByText(/couldn't load your plan/i)).toBeInTheDocument());
      const identity = screen.getByRole("region", { name: "Account" });
      expect(within(identity).queryByText(/free trial/i)).not.toBeInTheDocument();
      expect(within(identity).queryByText("Standard")).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------
  // Card 2 — Plan & billing: the five states (§3.1). THE correctness piece:
  // a summary fetch FAILURE renders the card's own retry state — never
  // silence, never a vanished plan (WALK-manager #1, the MOCK-DOOR
  // SUMMARY_STATE-failure hole).
  // ---------------------------------------------------------------------
  describe("Plan & billing — the five states", () => {
    it("state: loading → the card renders skeleton lines while the summary is in flight", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      // Never resolves during this test — the loading state holds.
      vi.mocked(getAccountSummaryState).mockReturnValue(new Promise(() => {}));

      renderAccount();
      await waitFor(() => expect(screen.getByText("ag@unforced.org")).toBeInTheDocument());
      const card = screen.getByRole("region", { name: "Plan & billing" });
      expect(card.querySelector('[aria-busy="true"]')).not.toBeNull();
    });

    it("state: billing disabled (self-host) → the card is absent entirely", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummaryState).mockResolvedValue({
        ...SUMMARY,
        billing_enabled: false,
        has_billing_customer: false,
      });

      renderAccount();
      await waitFor(() => expect(screen.getByText("ag@unforced.org")).toBeInTheDocument());
      // The card may render its loading skeleton for a beat — once the answer
      // lands (billing disabled) it must be GONE, not an empty shell.
      await waitFor(() => expect(screen.queryByText("Plan & billing")).not.toBeInTheDocument());
      expect(openBillingPortal).not.toHaveBeenCalled();
    });

    it("state: absent (the door serves no summary — a hub 404) → no card, no retry, no fabricated meter", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [CLOUD_VAULT] });
      vi.mocked(getAccountSummaryState).mockResolvedValue(null);

      renderAccount();
      await waitFor(() => expect(screen.getByText("ag@unforced.org")).toBeInTheDocument());
      // The loading skeleton may show for a beat — once the door's answer
      // lands (no summary served) the card is GONE: no shell, no retry card
      // that could never succeed.
      await waitFor(() => expect(screen.queryByText("Plan & billing")).not.toBeInTheDocument());
      expect(screen.queryByText(/couldn't load your plan/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/\d+ of \d+ on your plan/)).not.toBeInTheDocument();
      expect(screen.queryByText(/\d+ of \d+ vaults/)).not.toBeInTheDocument();
    });

    it("state: FAILED → the retry card renders (never silence), and Retry recovers in place", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummaryState)
        .mockResolvedValueOnce("error")
        .mockResolvedValueOnce(TRIAL_SUMMARY);

      renderAccount();
      // The failure state: serif line + reassurance + a pill Retry — the page
      // must NOT look complete-but-planless (WALK-manager #1).
      await waitFor(() => expect(screen.getByText(/couldn't load your plan/i)).toBeInTheDocument());
      expect(
        screen.getByText(/a hiccup reaching your account — your plan hasn't changed/i),
      ).toBeInTheDocument();
      const card = screen.getByRole("region", { name: "Plan & billing" });

      // Retry recovers IN PLACE: the same card swaps to the trial state.
      fireEvent.click(within(card).getByRole("button", { name: /^retry$/i }));
      await waitFor(() =>
        expect(within(card).getByText(/free trial · 5 days left/i)).toBeInTheDocument(),
      );
      expect(screen.queryByText(/couldn't load your plan/i)).not.toBeInTheDocument();
      expect(getAccountSummaryState).toHaveBeenCalledTimes(2);
    });

    it("state: trial/free → current-plan line + plan cards (and the identity chip rides along)", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummaryState).mockResolvedValue(TRIAL_SUMMARY);
      vi.mocked(getDoorDescriptor).mockResolvedValue({ plans: PLANS });

      renderAccount();
      await waitFor(() => expect(screen.getByText("Entry")).toBeInTheDocument());
      const card = screen.getByRole("region", { name: "Plan & billing" });
      expect(within(card).getByText(/free trial · 5 days left/i)).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: /upgrade to plus/i })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /manage plan & billing/i }),
      ).not.toBeInTheDocument();
    });

    it("state: paid → plan line + the portal pill, no upgrade cards", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummaryState).mockResolvedValue(SUMMARY);
      vi.mocked(getDoorDescriptor).mockResolvedValue({ plans: PLANS });

      renderAccount();
      const button = await screen.findByRole("button", { name: /manage plan & billing/i });
      expect(button).toBeInTheDocument();
      expect(screen.queryByText(/upgrade to/i)).not.toBeInTheDocument();
      expect(startCheckout).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // Card 3 — Your vaults: the meter + the one-verb foot (§3.1).
  // ---------------------------------------------------------------------
  describe("the vaults card", () => {
    it("shows the 'n of m on your plan' meter when the summary carries both numbers", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [CLOUD_VAULT] });
      vi.mocked(getAccountSummaryState).mockResolvedValue(SUMMARY);

      renderAccount();
      await waitFor(() => expect(screen.getByText("moss")).toBeInTheDocument());
      expect(screen.getByText("1 of 3 on your plan")).toBeInTheDocument();
    });

    it("never fabricates the meter from a partial summary (limit but no count)", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [CLOUD_VAULT] });
      vi.mocked(getAccountSummaryState).mockResolvedValue({
        email: "ag@unforced.org",
        plan: { tier: "standard", label: "Standard", vault_limit: 3 }, // no vaults_used
        billing_enabled: true,
        has_billing_customer: true,
      });

      renderAccount();
      await waitFor(() => expect(screen.getByText("moss")).toBeInTheDocument());
      expect(screen.queryByText(/of 3 on your plan/)).not.toBeInTheDocument();
      expect(screen.queryByText(/of 3 vaults/)).not.toBeInTheDocument();
    });

    it("the foot collapses to ONE verb: '＋ Add a vault' → /add-vault (the chooser holds the fork)", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [CLOUD_VAULT] });
      vi.mocked(getAccountSummaryState).mockResolvedValue(null);

      renderAccount();
      await waitFor(() => expect(screen.getByText("moss")).toBeInTheDocument());
      const addLink = screen.getByRole("link", { name: /＋ add a vault/i });
      expect(addLink).toHaveAttribute("href", "/add-vault");
      // The old two-verb foot is gone.
      expect(screen.queryByRole("link", { name: /create a new vault/i })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /connect a self-hosted vault/i }),
      ).not.toBeInTheDocument();
    });

    it("keeps the warm first-vault door on a genuinely empty list", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummaryState).mockResolvedValue(null);

      renderAccount();
      await waitFor(() => expect(screen.getByText(/no vaults yet/i)).toBeInTheDocument());
      expect(screen.getByRole("link", { name: /create a vault/i })).toHaveAttribute(
        "href",
        "/add-vault/create",
      );
    });
  });

  // ---------------------------------------------------------------------
  // Card 4 — Connections: two icon rows, honest dimming (§3.1).
  // ---------------------------------------------------------------------
  describe("the connections card", () => {
    it("renders both rows as links when a vault is active", async () => {
      useVaultStore.setState({
        vaults: {
          v1: {
            id: "v1",
            url: "http://localhost:1940",
            name: "moss",
            issuer: "http://localhost:1940",
            clientId: HOSTED_CLIENT_ID,
            scope: "full",
            addedAt: "2026-07-01T00:00:00.000Z",
            lastUsedAt: "2026-07-01T00:00:00.000Z",
          },
        },
        activeVaultId: "v1",
      });
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummaryState).mockResolvedValue(null);

      renderAccount();
      await waitFor(() => expect(screen.getByText("ag@unforced.org")).toBeInTheDocument());
      expect(screen.getByRole("link", { name: /connect your ai/i })).toHaveAttribute(
        "href",
        "/connect",
      );
      expect(screen.getByRole("link", { name: /import notes/i })).toHaveAttribute(
        "href",
        "/import",
      );
      // Export is Import's sibling row (Wave-3).
      expect(screen.getByRole("link", { name: /export notes/i })).toHaveAttribute(
        "href",
        "/export",
      );
    });

    it("dims the AI row with the honest pointer when no vault is active", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummaryState).mockResolvedValue(null);

      renderAccount();
      await waitFor(() => expect(screen.getByText("ag@unforced.org")).toBeInTheDocument());
      expect(screen.getByText(/open a vault above to connect an ai to it/i)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /connect your ai/i })).not.toBeInTheDocument();
      // Import and Export both stay reachable — each page holds its own
      // no-vault state.
      expect(screen.getByRole("link", { name: /import notes/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /export notes/i })).toBeInTheDocument();
    });
  });

  // Plan A: the Billing section is straight-to-Stripe — no cloud-console
  // re-login. The two actions are typed redirect calls, asserted by checking
  // `window.location.assign` lands on the endpoint's own `{ url }` — never a
  // value the app computed itself.
  describe("Billing — Stripe-direct redirects", () => {
    beforeEach(() => {
      // openBillingPortal/startCheckout redirect via window.location.assign;
      // jsdom's default throws "Not implemented: navigation".
      vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("Manage opens the billing portal and redirects to its url", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummaryState).mockResolvedValue(SUMMARY);
      vi.mocked(openBillingPortal).mockResolvedValue({
        url: "https://billing.stripe.com/session/abc",
      });

      renderAccount();
      const button = await screen.findByRole("button", { name: /manage plan & billing/i });
      fireEvent.click(button);

      await waitFor(() => expect(openBillingPortal).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(window.location.assign).toHaveBeenCalledWith(
          "https://billing.stripe.com/session/abc",
        ),
      );
      expect(screen.queryByText(/upgrade to/i)).not.toBeInTheDocument();
      expect(startCheckout).not.toHaveBeenCalled();
    });

    it("a 409/503 from the billing portal shows a small inline message, not a crash", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummaryState).mockResolvedValue(SUMMARY);
      vi.mocked(openBillingPortal).mockRejectedValue(
        new BillingApiError(409, "no_billing_customer", "no_billing_customer"),
      );

      renderAccount();
      const button = await screen.findByRole("button", { name: /manage plan & billing/i });
      fireEvent.click(button);

      await waitFor(() =>
        expect(screen.getByText(/billing isn't available right now/i)).toBeInTheDocument(),
      );
      expect(window.location.assign).not.toHaveBeenCalled();
    });

    it("a real session expiry rides the app's session-ended handling, NOT the billing inline message", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummaryState).mockResolvedValue(SUMMARY);
      vi.mocked(openBillingPortal).mockRejectedValue(new SessionExpiredError());

      renderAccount();
      const button = await screen.findByRole("button", { name: /manage plan & billing/i });
      fireEvent.click(button);

      // The account session store is marked expired (drives the existing
      // AccountSessionBanner), and the billing-specific message is NOT shown.
      await waitFor(() => expect(useAccountSessionStore.getState().expired).toBe(true));
      expect(screen.queryByText(/billing isn't available right now/i)).not.toBeInTheDocument();
      expect(window.location.assign).not.toHaveBeenCalled();
    });

    it("renders the door's plan cards, marks the current plan, and Upgrade calls checkout with the right tier", async () => {
      signedIn();
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummaryState).mockResolvedValue({
        ...SUMMARY,
        billing_enabled: true,
        has_billing_customer: false,
      });
      vi.mocked(getDoorDescriptor).mockResolvedValue({ plans: PLANS });
      vi.mocked(startCheckout).mockResolvedValue({
        url: "https://checkout.stripe.com/session/xyz",
      });

      renderAccount();
      await waitFor(() => expect(screen.getByText("Entry")).toBeInTheDocument());
      expect(screen.getByText("Plus")).toBeInTheDocument();
      // The current plan (tier "standard") is marked, not offered an Upgrade button.
      const planCard = screen.getByRole("region", { name: "Plan & billing" });
      const standardCard = within(planCard).getByText("Standard").closest("li") as HTMLElement;
      expect(standardCard).not.toBeNull();
      expect(within(standardCard).getByText("Current")).toBeInTheDocument();
      expect(within(standardCard).queryByRole("button")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /manage plan & billing/i }),
      ).not.toBeInTheDocument();
      // F1/F5 — a descriptor with no `intervals` data anywhere degrades to the
      // OLD display + behavior: no interval picker at all.
      expect(screen.queryByRole("group", { name: /billing interval/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /upgrade to plus/i }));
      // Interval-less call — exactly the pre-F1 signature — since this descriptor
      // carries no per-interval data to choose from.
      await waitFor(() => expect(startCheckout).toHaveBeenCalledWith("plus"));
      await waitFor(() =>
        expect(window.location.assign).toHaveBeenCalledWith(
          "https://checkout.stripe.com/session/xyz",
        ),
      );
    });

    // F1/F3/F5 — the Entry-billing story: the interval picker, honest
    // per-interval prices, and Entry's no-monthly matrix hole handled without
    // ever sending a checkout call that will 400.
    describe("the interval picker (F1/F3/F5)", () => {
      function mockManagerWithPlans(plans: DoorPlan[]) {
        signedIn();
        vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
        vi.mocked(getAccountSummaryState).mockResolvedValue(TRIAL_SUMMARY);
        vi.mocked(getDoorDescriptor).mockResolvedValue({ plans });
        vi.mocked(startCheckout).mockResolvedValue({
          url: "https://checkout.stripe.com/session/xyz",
        });
      }

      it("survives the descriptor landing AFTER the summary (late plans re-derive the default interval — no crash, no null selection)", async () => {
        // The real-browser order the mocked round-trips hide: the summary
        // settles first (UpgradePlans mounts against an EMPTY ladder), then
        // the descriptor arrives. A state-initialized selection would stay
        // null and crash the disabled-Entry branch (`INTERVAL_LABEL[null]`).
        signedIn();
        vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
        vi.mocked(getAccountSummaryState).mockResolvedValue(TRIAL_SUMMARY);
        vi.mocked(getDoorDescriptor).mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ plans: PLANS_WITH_INTERVALS }), 50),
            ),
        );
        vi.mocked(startCheckout).mockResolvedValue({
          url: "https://checkout.stripe.com/session/xyz",
        });

        renderAccount();
        // The plan card grid appears once the late descriptor lands…
        const group = await screen.findByRole("group", { name: /billing interval/i });
        // …with the default selection re-derived from the real ladder
        // (monthly — the cheapest cycle in the union), Entry's disabled
        // branch rendered without crashing.
        expect(within(group).getByRole("button", { name: "Monthly" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(screen.getByText(/not available monthly/i)).toBeInTheDocument();

        const standardCard = screen.getByText("Standard").closest("li") as HTMLElement;
        fireEvent.click(within(standardCard).getByRole("button", { name: /upgrade to standard/i }));
        await waitFor(() => expect(startCheckout).toHaveBeenCalledWith("standard", "monthly"));
      });

      it("renders only the intervals available across the offered tiers (no Monthly pill when no tier sells it)", async () => {
        mockManagerWithPlans(ENTRY_ONLY_INTERVALS);
        renderAccount();
        const group = await screen.findByRole("group", { name: /billing interval/i });
        expect(within(group).getByRole("button", { name: "Quarterly" })).toBeInTheDocument();
        expect(within(group).getByRole("button", { name: "Yearly" })).toBeInTheDocument();
        expect(within(group).queryByRole("button", { name: "Monthly" })).not.toBeInTheDocument();
      });

      it("defaults to the cheapest available interval (quarterly, since Entry has no monthly) and Upgrade sends it", async () => {
        mockManagerWithPlans(ENTRY_ONLY_INTERVALS);
        renderAccount();
        await screen.findByRole("group", { name: /billing interval/i });
        expect(screen.getByRole("button", { name: "Quarterly" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );

        fireEvent.click(screen.getByRole("button", { name: /upgrade to entry/i }));
        await waitFor(() => expect(startCheckout).toHaveBeenCalledWith("entry", "quarterly"));
      });

      it("the honest per-interval price line: every cycle the tier sells + the 'about $N/mo' equivalence (decision a)", async () => {
        mockManagerWithPlans(PLANS_WITH_INTERVALS);
        renderAccount();
        await screen.findByRole("group", { name: /billing interval/i });
        // Entry (no monthly) reads its full honest line — "$3/quarter · $10/yr
        // — about $1/mo" — never a bare "$1/mo" that contradicts checkout.
        expect(screen.getByText("$3/quarter · $10/yr — about $1/mo")).toBeInTheDocument();
        expect(screen.queryByText(/^\$1\/mo$/)).not.toBeInTheDocument();
        // Standard sells monthly, so no equivalence suffix — just its cycles.
        expect(screen.getByText("$5/mo · $12/quarter · $40/yr")).toBeInTheDocument();
        // Entry + the default Monthly selection: disabled placeholder + hint.
        expect(screen.getByText(/not available monthly/i)).toBeInTheDocument();
        expect(screen.getByText(/available from \$3\/quarter/i)).toBeInTheDocument();
      });

      it('selecting Quarterly then clicking Upgrade-Entry calls startCheckout("entry", "quarterly") — never a 400-bound button', async () => {
        mockManagerWithPlans(PLANS_WITH_INTERVALS);
        renderAccount();
        await screen.findByRole("group", { name: /billing interval/i });

        // At the default ("Monthly"), Entry's own Upgrade button doesn't exist —
        // it's a disabled placeholder, so there's nothing to accidentally click
        // that would 400 the checkout call.
        const entryCard = screen.getByText("Entry").closest("li") as HTMLElement;
        expect(
          within(entryCard).queryByRole("button", { name: /upgrade to entry/i }),
        ).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Quarterly" }));
        const upgradeEntry = await within(entryCard).findByRole("button", {
          name: /upgrade to entry/i,
        });
        fireEvent.click(upgradeEntry);

        await waitFor(() => expect(startCheckout).toHaveBeenCalledWith("entry", "quarterly"));
        await waitFor(() =>
          expect(window.location.assign).toHaveBeenCalledWith(
            "https://checkout.stripe.com/session/xyz",
          ),
        );
      });

      it("Standard's Upgrade sends the default-selected interval (monthly — the cheapest across the ladder)", async () => {
        mockManagerWithPlans(PLANS_WITH_INTERVALS);
        renderAccount();
        await screen.findByRole("group", { name: /billing interval/i });

        const standardCard = screen.getByText("Standard").closest("li") as HTMLElement;
        fireEvent.click(within(standardCard).getByRole("button", { name: /upgrade to standard/i }));
        await waitFor(() => expect(startCheckout).toHaveBeenCalledWith("standard", "monthly"));
      });

      it("switching to Yearly before Upgrading Standard sends the yearly interval", async () => {
        mockManagerWithPlans(PLANS_WITH_INTERVALS);
        renderAccount();
        await screen.findByRole("group", { name: /billing interval/i });

        fireEvent.click(screen.getByRole("button", { name: "Yearly" }));
        const standardCard = screen.getByText("Standard").closest("li") as HTMLElement;
        fireEvent.click(within(standardCard).getByRole("button", { name: /upgrade to standard/i }));
        await waitFor(() => expect(startCheckout).toHaveBeenCalledWith("standard", "yearly"));
      });
    });

    // §3.1 honest checkout errors: a 400 about THIS plan/cycle must never read
    // as a billing outage ("Billing isn't available right now." is reserved
    // for real unavailability — desktop-05-entry-upgrade-error.png is the
    // anti-pattern).
    describe("honest checkout-error copy", () => {
      function mockTrialWithPlans() {
        signedIn();
        vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
        vi.mocked(getAccountSummaryState).mockResolvedValue(TRIAL_SUMMARY);
        vi.mocked(getDoorDescriptor).mockResolvedValue({ plans: PLANS });
      }

      it("checkout 400 invalid_plan → 'not offered on this cycle', NEVER the outage line", async () => {
        mockTrialWithPlans();
        vi.mocked(startCheckout).mockRejectedValue(
          new BillingApiError(400, "invalid_plan", "invalid_plan"),
        );

        renderAccount();
        await waitFor(() => expect(screen.getByText("Entry")).toBeInTheDocument());
        fireEvent.click(screen.getByRole("button", { name: /upgrade to plus/i }));

        await waitFor(() =>
          expect(
            screen.getByText(/that plan isn't offered on this cycle — pick another/i),
          ).toBeInTheDocument(),
        );
        expect(screen.queryByText(/billing isn't available right now/i)).not.toBeInTheDocument();
        expect(window.location.assign).not.toHaveBeenCalled();
      });

      it("checkout 409 already_subscribed → its own honest line, no redirect", async () => {
        mockTrialWithPlans();
        vi.mocked(startCheckout).mockRejectedValue(
          new BillingApiError(409, "already_subscribed", "already_subscribed"),
        );

        renderAccount();
        await waitFor(() => expect(screen.getByText("Entry")).toBeInTheDocument());
        fireEvent.click(screen.getByRole("button", { name: /upgrade to plus/i }));

        await waitFor(() => expect(screen.getByText(/already subscribed/i)).toBeInTheDocument());
        expect(window.location.assign).not.toHaveBeenCalled();
      });

      it("checkout 503 unconfigured → the outage line is honest there", async () => {
        mockTrialWithPlans();
        vi.mocked(startCheckout).mockRejectedValue(
          new BillingApiError(503, "unconfigured", "Billing isn't configured for this door."),
        );

        renderAccount();
        await waitFor(() => expect(screen.getByText("Entry")).toBeInTheDocument());
        fireEvent.click(screen.getByRole("button", { name: /upgrade to plus/i }));

        await waitFor(() =>
          expect(screen.getByText(/billing isn't available right now/i)).toBeInTheDocument(),
        );
      });
    });
  });
});
