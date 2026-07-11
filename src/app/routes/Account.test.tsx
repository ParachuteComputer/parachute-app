import { Account } from "@/app/routes/Account";
import {
  AccountApiError,
  BillingApiError,
  SessionExpiredError,
  getAccountSummary,
  getSession,
  listVaults,
  openBillingPortal,
  startCheckout,
} from "@/lib/account/client";
import { getDoorDescriptor } from "@/lib/account/descriptor";
import { openHostedVault } from "@/lib/account/hosted-vault";
import { useAccountSessionStore } from "@/lib/account/store";
import type { AccountSummary, DoorPlan } from "@/lib/account/types";
import { useVaultStore } from "@/lib/vault";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The app-as-manager surface (SYNTHESIS "The shape"): who you are + plan, your
// Cloud vaults, AI connections — all driven by the account bearer. Degrades to a
// calm "this device" view with no cloud door / signed out.

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
    getAccountSummary: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    openBillingPortal: vi.fn(),
    startCheckout: vi.fn(),
  };
});
vi.mock("@/lib/account/hosted-vault", () => ({
  openHostedVault: vi.fn().mockResolvedValue("v1"),
}));
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

const CLOUD_VAULT = { name: "moss", url: "https://u.parachute.computer/vault/moss" };

function renderAccount() {
  return render(
    <MemoryRouter initialEntries={["/account"]}>
      <Routes>
        <Route path="/account" element={<Account />} />
        <Route path="/" element={<div>Home surface</div>} />
        <Route path="/connect" element={<div>Connect surface</div>} />
        <Route path="/vaults" element={<div>Vaults surface</div>} />
        <Route path="/welcome" element={<div>Welcome surface</div>} />
        <Route path="/add" element={<div>Add surface</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useVaultStore.setState({ vaults: {}, activeVaultId: null });
  useAccountSessionStore.setState({ expired: false, gate: null });
  vi.mocked(getSession).mockReset();
  vi.mocked(listVaults).mockReset();
  vi.mocked(getAccountSummary).mockReset();
  vi.mocked(openHostedVault).mockReset().mockResolvedValue("v1");
  vi.mocked(openBillingPortal).mockReset();
  vi.mocked(startCheckout).mockReset();
  vi.mocked(getDoorDescriptor).mockReset().mockResolvedValue(null);
});
afterEach(() => {
  useVaultStore.setState({ vaults: {}, activeVaultId: null });
  useAccountSessionStore.setState({ expired: false, gate: null });
});

describe("Account — the app-as-manager surface", () => {
  it("renders the manager view: email, plan line, Cloud vault, billing, AI connections", async () => {
    vi.mocked(getSession).mockResolvedValue({
      signed_in: true,
      csrf: "c",
      email: "ag@unforced.org",
    });
    vi.mocked(listVaults).mockResolvedValue({
      vaults: [{ ...CLOUD_VAULT, usage: { notes_bytes: 68 * 1024 * 1024 } }],
    });
    vi.mocked(getAccountSummary).mockResolvedValue(SUMMARY);

    renderAccount();
    await waitFor(() => expect(screen.getByText("ag@unforced.org")).toBeInTheDocument());
    expect(screen.getByText(/1 of 3 vaults/)).toBeInTheDocument();
    expect(screen.getByText(/\$5\/mo/)).toBeInTheDocument();
    expect(screen.getByText("moss")).toBeInTheDocument();
    expect(screen.getByText(/☁ Cloud/)).toBeInTheDocument();
    expect(screen.getByText(/68 MB/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open →/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /manage plan & billing/i })).toBeInTheDocument();
    expect(screen.getByText("AI connections")).toBeInTheDocument();
  });

  it("degrades gracefully when the summary is absent (no fabricated numbers, no Billing section)", async () => {
    vi.mocked(getSession).mockResolvedValue({
      signed_in: true,
      csrf: "c",
      email: "ag@unforced.org",
    });
    vi.mocked(listVaults).mockResolvedValue({ vaults: [CLOUD_VAULT] });
    vi.mocked(getAccountSummary).mockResolvedValue(null);

    renderAccount();
    await waitFor(() => expect(screen.getByText("ag@unforced.org")).toBeInTheDocument());
    expect(screen.queryByText(/\d+ of \d+ vaults/)).not.toBeInTheDocument(); // no fake meter
    // No summary ⇒ billing_enabled can't be known truthy ⇒ the Billing section
    // doesn't exist (never a false door to a plan/billing state we can't verify).
    expect(screen.queryByText("Billing")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /manage plan & billing/i }),
    ).not.toBeInTheDocument();
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
    vi.mocked(getSession).mockResolvedValue({
      signed_in: true,
      csrf: "c",
      email: "ag@unforced.org",
    });
    vi.mocked(listVaults).mockResolvedValue({ vaults: [CLOUD_VAULT] });
    vi.mocked(getAccountSummary).mockResolvedValue(null);

    renderAccount();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /open →/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /open →/i }));
    await waitFor(() => expect(openHostedVault).toHaveBeenCalledWith("moss"));
    await waitFor(() => expect(screen.getByText("Home surface")).toBeInTheDocument());
  });

  // F12 — same friendly-copy mapping as the create-vault naming form: never a
  // raw wire code.
  it("maps a bare wire code to friendly copy when opening a vault fails", async () => {
    vi.mocked(getSession).mockResolvedValue({
      signed_in: true,
      csrf: "c",
      email: "ag@unforced.org",
    });
    vi.mocked(listVaults).mockResolvedValue({ vaults: [CLOUD_VAULT] });
    vi.mocked(getAccountSummary).mockResolvedValue(null);
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
    vi.mocked(getSession).mockResolvedValue({
      signed_in: true,
      csrf: "c",
      email: "ag@unforced.org",
    });
    vi.mocked(listVaults).mockRejectedValue(new Error("500"));
    vi.mocked(getAccountSummary).mockResolvedValue(null);

    renderAccount();
    await waitFor(() => expect(screen.getByText(/couldn't load your vaults/i)).toBeInTheDocument());
    // The empty-state / create affordances must NOT show on a failure (that would
    // invite a duplicate vault).
    expect(screen.queryByText(/no vaults yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /create a new vault/i })).not.toBeInTheDocument();

    // Retry re-fetches and renders the list.
    vi.mocked(listVaults).mockResolvedValue({ vaults: [CLOUD_VAULT] });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getByText("moss")).toBeInTheDocument());
  });

  it("omits the vault meter when the door gives a limit but no count (no fabricated 0)", async () => {
    vi.mocked(getSession).mockResolvedValue({
      signed_in: true,
      csrf: "c",
      email: "ag@unforced.org",
    });
    vi.mocked(listVaults).mockResolvedValue({ vaults: [CLOUD_VAULT] });
    vi.mocked(getAccountSummary).mockResolvedValue({
      email: "ag@unforced.org",
      plan: { tier: "standard", label: "Standard", vault_limit: 3 }, // no vaults_used
      billing_enabled: true,
      has_billing_customer: true,
    });

    renderAccount();
    await waitFor(() => expect(screen.getByText(/Standard/)).toBeInTheDocument());
    expect(screen.queryByText(/of 3 vaults/)).not.toBeInTheDocument();
  });

  // HUB-PARITY P4 — a password door may sign a person in under `username`
  // instead of `email`. "Signed in as X" falls back `email ?? username`.
  it("falls back to username in the header when a hub-shaped session has no email", async () => {
    vi.mocked(getSession).mockResolvedValue({ signed_in: true, csrf: "c", username: "aaron" });
    vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
    vi.mocked(getAccountSummary).mockResolvedValue(null);

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
      vi.mocked(getAccountSummary).mockResolvedValue(null);

      renderAccount();
      await waitFor(() =>
        expect(screen.getByText(/couldn't load your vaults/i)).toBeInTheDocument(),
      );
      expect(useAccountSessionStore.getState().gate).toBe("force_change_password");
    });

    it("a 423 marks the admin_locked gate", async () => {
      vi.mocked(getSession).mockResolvedValue({ signed_in: true, csrf: "c", username: "aaron" });
      vi.mocked(listVaults).mockRejectedValue(new AccountApiError(423, "admin_locked"));
      vi.mocked(getAccountSummary).mockResolvedValue(null);

      renderAccount();
      await waitFor(() =>
        expect(screen.getByText(/couldn't load your vaults/i)).toBeInTheDocument(),
      );
      expect(useAccountSessionStore.getState().gate).toBe("admin_locked");
    });

    it("an ordinary failure (not a hub gate) never sets a gate", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "c",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockRejectedValue(new Error("500"));
      vi.mocked(getAccountSummary).mockResolvedValue(null);

      renderAccount();
      await waitFor(() =>
        expect(screen.getByText(/couldn't load your vaults/i)).toBeInTheDocument(),
      );
      expect(useAccountSessionStore.getState().gate).toBeNull();
    });
  });

  // Plan A: the Billing section is straight-to-Stripe — no cloud-console
  // re-login. Three states, gated purely on `AccountSummary.billing_enabled`
  // + `has_billing_customer` (data the app already holds); the two actions are
  // typed redirect calls, asserted by checking `window.location.assign` lands
  // on the endpoint's own `{ url }` — never a value the app computed itself.
  describe("Billing section — Stripe-direct redirects", () => {
    beforeEach(() => {
      // openBillingPortal/startCheckout redirect via window.location.assign;
      // jsdom's default throws "Not implemented: navigation".
      vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("billing_enabled: false → no Billing section at all (self-hosted / no-billing door)", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "c",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummary).mockResolvedValue({
        ...SUMMARY,
        billing_enabled: false,
        has_billing_customer: false,
      });

      renderAccount();
      await waitFor(() => expect(screen.getByText("ag@unforced.org")).toBeInTheDocument());
      expect(screen.queryByText("Billing")).not.toBeInTheDocument();
      expect(openBillingPortal).not.toHaveBeenCalled();
    });

    it("has_billing_customer: true → Manage button opens the billing portal and redirects to its url", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "c",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummary).mockResolvedValue(SUMMARY); // billing_enabled + has_billing_customer: true
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
      // No plan cards — this is the existing-subscriber state.
      expect(screen.queryByText(/upgrade to/i)).not.toBeInTheDocument();
      expect(startCheckout).not.toHaveBeenCalled();
    });

    it("a 409/503 from the billing portal shows a small inline message, not a crash", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "c",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummary).mockResolvedValue(SUMMARY);
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
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "c",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummary).mockResolvedValue(SUMMARY);
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

    it("has_billing_customer: false → renders the door's plan cards, marks the current plan, and Upgrade calls checkout with the right tier", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "c",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummary).mockResolvedValue({
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
      const standardCard = screen.getByText("Standard").closest("li") as HTMLElement;
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
        vi.mocked(getSession).mockResolvedValue({
          signed_in: true,
          csrf: "c",
          email: "ag@unforced.org",
        });
        vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
        vi.mocked(getAccountSummary).mockResolvedValue({
          ...SUMMARY,
          plan: { tier: "trial", label: "Free trial", trial_days_left: 5 },
          billing_enabled: true,
          has_billing_customer: false,
        });
        vi.mocked(getDoorDescriptor).mockResolvedValue({ plans });
        vi.mocked(startCheckout).mockResolvedValue({
          url: "https://checkout.stripe.com/session/xyz",
        });
      }

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
        expect(screen.getByText("$3/quarter")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: /upgrade to entry/i }));
        await waitFor(() => expect(startCheckout).toHaveBeenCalledWith("entry", "quarterly"));
      });

      it("honest per-interval price display: shows the door's own per-cycle label, not a bare price_month", async () => {
        mockManagerWithPlans(PLANS_WITH_INTERVALS);
        renderAccount();
        await screen.findByRole("group", { name: /billing interval/i });
        // Default selection is "Monthly" (Standard sells it — the cheapest cycle
        // in the union), so Standard shows its monthly label…
        expect(screen.getByText("$5/mo")).toBeInTheDocument();
        // …and Entry (no monthly) shows the disabled hint with its own cheapest
        // real cycle, never a bare "$1/mo" that would contradict checkout.
        expect(screen.queryByText("$1/mo")).not.toBeInTheDocument();
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

    it("checkout 409 already_subscribed → inline message, no redirect", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "c",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(getAccountSummary).mockResolvedValue({
        ...SUMMARY,
        billing_enabled: true,
        has_billing_customer: false,
      });
      vi.mocked(getDoorDescriptor).mockResolvedValue({ plans: PLANS });
      vi.mocked(startCheckout).mockRejectedValue(
        new BillingApiError(409, "already_subscribed", "already_subscribed"),
      );

      renderAccount();
      await waitFor(() => expect(screen.getByText("Entry")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: /upgrade to plus/i }));

      await waitFor(() => expect(screen.getByText(/already subscribed/i)).toBeInTheDocument());
      expect(window.location.assign).not.toHaveBeenCalled();
    });
  });
});
