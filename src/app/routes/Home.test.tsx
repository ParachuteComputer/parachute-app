import { Home } from "@/app/routes/Home";
import { getAccountSummaryState } from "@/lib/account/client";
import { HOSTED_CLIENT_ID } from "@/lib/account/hosted-vault";
import type { AccountSummary } from "@/lib/account/types";
import { loadChecklistState } from "@/lib/home/checklist";
import { __resetInstallAffordanceForTests } from "@/lib/pwa-install";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The shared account-summary read (trial ambience, §3.1 places 2 + 4) — mocked
// so Home tests control the plan state without wiring a whole account door.
// Spreads the real module so everything else (error classes etc.) stays real.
vi.mock("@/lib/account/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/account/client")>("@/lib/account/client");
  return {
    ...actual,
    getAccountSummaryState: vi.fn().mockResolvedValue(null),
  };
});

interface Row {
  id: string;
  path: string;
  createdAt: string;
  updatedAt?: string;
  tags?: string[];
  preview?: string;
}

function installFetch(notes: Row[]) {
  const impl = vi.fn<typeof fetch>(async () => {
    return { ok: true, status: 200, json: async () => notes, text: async () => "" } as Response;
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

function seedStore() {
  useVaultStore.setState({
    vaults: {
      v1: {
        id: "v1",
        url: "http://localhost:1940",
        name: "default",
        issuer: "http://localhost:1940",
        clientId: "c",
        scope: "full",
        addedAt: "2026-07-01T00:00:00.000Z",
        lastUsedAt: "2026-07-01T00:00:00.000Z",
      },
    },
    activeVaultId: "v1",
  });
  localStorage.setItem(
    "lens:token:v1",
    JSON.stringify({ accessToken: "t", scope: "full", vault: "default" }),
  );
}

function LocationSpy() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <MemoryRouter initialEntries={["/"]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/" element={children} />
          <Route path="/notes" element={<LocationSpy />} />
          <Route path="/new" element={<LocationSpy />} />
          <Route path="/connect" element={<LocationSpy />} />
          <Route path="/calendar" element={<LocationSpy />} />
          <Route path="/today" element={<LocationSpy />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const SEED_ONLY: Row[] = [
  {
    id: "g1",
    path: "Welcome to your vault 🪂",
    tags: ["guide"],
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-01T09:00:00.000Z",
  },
];

const WITH_USER_NOTE: Row[] = [
  ...SEED_ONLY,
  {
    id: "u1",
    path: "My first thought",
    preview: "Something I wrote.",
    tags: ["capture"],
    createdAt: "2026-07-02T09:00:00.000Z",
    updatedAt: "2026-07-02T09:00:00.000Z",
  },
];

// A home-door (account-minted) vault — the seed under which trial ambience is
// even possible (a self-host OAuth vault never fetches the summary).
function seedHostedStore() {
  useVaultStore.setState({
    vaults: {
      v1: {
        id: "v1",
        url: "https://u.parachute.computer/vault/aaron",
        name: "aaron",
        issuer: "https://u.parachute.computer",
        clientId: HOSTED_CLIENT_ID,
        scope: "full",
        addedAt: "2026-07-01T00:00:00.000Z",
        lastUsedAt: "2026-07-01T00:00:00.000Z",
      },
    },
    activeVaultId: "v1",
  });
}

function trialSummary(daysLeft: number): AccountSummary {
  return {
    email: "ag@unforced.org",
    plan: { tier: "trial", label: "Free trial", trial_days_left: daysLeft },
    billing_enabled: true,
    has_billing_customer: false,
  };
}

const PAID_SUMMARY: AccountSummary = {
  email: "ag@unforced.org",
  plan: { tier: "standard", label: "Standard", price_monthly_usd: 5 },
  billing_enabled: true,
  has_billing_customer: true,
};

describe("Home — the warm front door", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetInstallAffordanceForTests();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    vi.mocked(getAccountSummaryState).mockReset().mockResolvedValue(null);
    seedStore();
  });
  afterEach(() => {
    __resetInstallAffordanceForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  it("leads with the vault name as the serif masthead (identity everywhere)", async () => {
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <Home />
      </Wrap>,
    );
    // The H1 is the vault name — not "Home", not "Welcome". The name is the
    // identity threaded through the whole app.
    expect(await screen.findByRole("heading", { level: 1, name: "default" })).toBeInTheDocument();
    expect(screen.getByText(/everything here is yours/i)).toBeInTheDocument();
  });

  // W2-10's honest composer (F10: type in place, save without leaving,
  // one shared draft with /new, the flush-on-blur guard, a capability-gated
  // mic) — LZ-1 extracted the component to src/components/Composer.tsx; its
  // own test suite moved with it: see Composer.test.tsx.

  it("shows warm quick doors + a setup nudge for a fresh vault", async () => {
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <Home />
      </Wrap>,
    );
    await screen.findByRole("heading", { level: 1, name: "default" });
    // Fresh mode is gated on notes settling — await the quick doors appearing.
    const quickNav = await screen.findByRole("navigation", { name: /quick actions/i });
    expect(within(quickNav).getByText(/connect your ai/i)).toBeInTheDocument();
    expect(within(quickNav).getByText(/bring your notes over/i)).toBeInTheDocument();
    // The single quiet sun nudge (not a wall of checkboxes).
    expect(screen.getByText(/finish setting up/i)).toBeInTheDocument();
    // The seed guide note shows in the timeline (it's a real note).
    expect(screen.getByText(/welcome to your vault/i)).toBeInTheDocument();
  });

  it("goes quiet for a returning vault: no quick doors, the note gathers below", async () => {
    installFetch(WITH_USER_NOTE);
    render(
      <Wrap>
        <Home />
      </Wrap>,
    );
    expect(await screen.findByText("My first thought")).toBeInTheDocument();
    // Vault name still leads; the fresh-only quick doors are gone.
    expect(screen.getByRole("heading", { level: 1, name: "default" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /quick actions/i })).not.toBeInTheDocument();
  });

  it("dismisses the setup nudge and remembers it", async () => {
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <Home />
      </Wrap>,
    );
    await screen.findByText(/finish setting up/i);
    fireEvent.click(screen.getByRole("button", { name: /dismiss setup/i }));
    await waitFor(() => expect(screen.queryByText(/finish setting up/i)).not.toBeInTheDocument());
    expect(loadChecklistState("v1").dismissed).toBe(true);
  });

  it("hides the account backlink for a self-host (OAuth) vault", async () => {
    // Default seed vault has clientId "c" (a foreign OAuth client, not the
    // home door) → no account on THIS door → no backlink.
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <Home />
      </Wrap>,
    );
    await screen.findByRole("heading", { level: 1, name: "default" });
    expect(screen.queryByRole("link", { name: /manage your account/i })).not.toBeInTheDocument();
  });

  it("W2-5: the header's stopgap Calendar link is gone (the nav bands carry Calendar now)", async () => {
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <Home />
      </Wrap>,
    );
    await screen.findByRole("heading", { level: 1, name: "default" });
    expect(screen.queryByRole("link", { name: /^calendar$/i })).not.toBeInTheDocument();
  });

  it("F8/W2-3: the day-header hop still lands on the day drill-in", async () => {
    // Pin the clock so WITH_USER_NOTE's 2026-07-02 row reads as "Today" — a
    // deterministic day-group label regardless of host locale/timezone.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 2, 12, 0, 0));
    installFetch(WITH_USER_NOTE);
    render(
      <Wrap>
        <Home />
      </Wrap>,
    );
    await screen.findByText("My first thought");
    // WITH_USER_NOTE's second row is dated 2026-07-02 — its day-group header
    // is a link into the single-day view (shared RecentTimeline component;
    // this asserts the hop still works now that Home is the only renderer of
    // this list).
    const dayHeader = screen.getByRole("link", { name: /^today$/i });
    expect(dayHeader).toHaveAttribute("href", "/today?date=2026-07-02");
  });

  it("invites the first capture when the vault is genuinely empty (no seed note either)", async () => {
    installFetch([]);
    render(
      <Wrap>
        <Home />
      </Wrap>,
    );
    expect(await screen.findByText(/a quiet, empty page/i)).toBeInTheDocument();
    // W2-10: the CTA focuses the real composer in place — no hop to /new.
    fireEvent.click(screen.getByRole("button", { name: /write the first one/i }));
    expect(screen.getByRole("textbox", { name: /what's on your mind\?/i })).toHaveFocus();
  });

  it("shows an in-app /account backlink for a home-door vault (no cross-origin console hop)", async () => {
    useVaultStore.setState({
      vaults: {
        v1: {
          id: "v1",
          url: "https://u.parachute.computer/vault/aaron",
          name: "aaron",
          issuer: "https://u.parachute.computer",
          clientId: HOSTED_CLIENT_ID, // home-door (account-minted) vault
          scope: "full",
          addedAt: "2026-07-01T00:00:00.000Z",
          lastUsedAt: "2026-07-01T00:00:00.000Z",
        },
      },
      activeVaultId: "v1",
    });
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <Home />
      </Wrap>,
    );
    await screen.findByRole("heading", { level: 1, name: "aaron" });
    // In-app react-router link (same origin) — never a cross-origin console URL.
    const link = screen.getByRole("link", { name: /manage your account/i });
    expect(link).toHaveAttribute("href", "/account");
    expect(link.getAttribute("href")).not.toContain("cloud.parachute.computer");
  });

  // ---------------------------------------------------------------------
  // Trial ambience (DESIGN-SPEC §3.1) — Home carries sanctioned places 2
  // (the PlanBacklink trial line) and 4 (the ≤7-day countdown nudge under
  // the composer, Today only). Nowhere else on this page.
  // ---------------------------------------------------------------------
  describe("trial ambience — the backlink line + the ≤7-day nudge", () => {
    it("the backlink carries the trial countdown while trialing (place 2)", async () => {
      seedHostedStore();
      vi.mocked(getAccountSummaryState).mockResolvedValue(trialSummary(5));
      installFetch(SEED_ONLY);
      render(
        <Wrap>
          <Home />
        </Wrap>,
      );
      await screen.findByRole("heading", { level: 1, name: "aaron" });
      const link = await screen.findByRole("link", {
        name: /free trial · 5 days left · manage your account/i,
      });
      expect(link).toHaveAttribute("href", "/account");
    });

    it("the backlink is plain when not trialing", async () => {
      seedHostedStore();
      vi.mocked(getAccountSummaryState).mockResolvedValue(PAID_SUMMARY);
      installFetch(SEED_ONLY);
      render(
        <Wrap>
          <Home />
        </Wrap>,
      );
      await screen.findByRole("heading", { level: 1, name: "aaron" });
      const link = screen.getByRole("link", { name: /manage your account/i });
      expect(link.textContent).not.toMatch(/free trial/i);
    });

    it("shows the countdown nudge under the composer ONLY at ≤7 days (place 4)", async () => {
      seedHostedStore();
      vi.mocked(getAccountSummaryState).mockResolvedValue(trialSummary(7));
      installFetch(SEED_ONLY);
      render(
        <Wrap>
          <Home />
        </Wrap>,
      );
      const nudge = await screen.findByRole("link", {
        name: /your trial ends in 7 days — see plans/i,
      });
      expect(nudge).toHaveAttribute("href", "/account");
      // Not dismissible — it exists for ≤7 days by definition. (The setup
      // nudge's dismiss button is a different row; the trial nudge has none.)
      expect(nudge.closest(".nudge-sun")?.querySelector("button")).toBeNull();
    });

    it("keeps the nudge away above 7 days — ambience, not a nag", async () => {
      seedHostedStore();
      vi.mocked(getAccountSummaryState).mockResolvedValue(trialSummary(8));
      installFetch(SEED_ONLY);
      render(
        <Wrap>
          <Home />
        </Wrap>,
      );
      await screen.findByRole("heading", { level: 1, name: "aaron" });
      // The trial line still shows in the backlink (place 2) …
      await screen.findByRole("link", { name: /free trial · 8 days left/i });
      // … but the countdown nudge does not exist yet.
      expect(screen.queryByText(/your trial ends in/i)).not.toBeInTheDocument();
    });

    it("reads 'ends today' at zero days", async () => {
      seedHostedStore();
      vi.mocked(getAccountSummaryState).mockResolvedValue(trialSummary(0));
      installFetch(SEED_ONLY);
      render(
        <Wrap>
          <Home />
        </Wrap>,
      );
      expect(
        await screen.findByRole("link", { name: /your trial ends today — see plans/i }),
      ).toBeInTheDocument();
    });

    it("shows no nudge when paid, and never fetches for a self-host vault", async () => {
      // Paid, hosted: no nudge, plain backlink.
      seedHostedStore();
      vi.mocked(getAccountSummaryState).mockResolvedValue(PAID_SUMMARY);
      installFetch(SEED_ONLY);
      const { unmount } = render(
        <Wrap>
          <Home />
        </Wrap>,
      );
      await screen.findByRole("heading", { level: 1, name: "aaron" });
      expect(screen.queryByText(/your trial ends/i)).not.toBeInTheDocument();
      unmount();

      // Self-host (OAuth clientId "c"): the summary query never even fires.
      vi.mocked(getAccountSummaryState).mockClear();
      seedStore();
      render(
        <Wrap>
          <Home />
        </Wrap>,
      );
      await screen.findByRole("heading", { level: 1, name: "default" });
      expect(getAccountSummaryState).not.toHaveBeenCalled();
      expect(screen.queryByText(/your trial ends/i)).not.toBeInTheDocument();
    });
  });
});
