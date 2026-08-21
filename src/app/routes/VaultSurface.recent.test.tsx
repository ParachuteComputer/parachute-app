import { VaultSurface } from "@/app/routes/VaultSurface";
import { getAccountSummaryState } from "@/lib/account/client";
import { HOSTED_CLIENT_ID } from "@/lib/account/hosted-vault";
import type { AccountSummary } from "@/lib/account/types";
import { NavBandsProvider } from "@/lib/nav/model";
import { __resetInstallAffordanceForTests } from "@/lib/pwa-install";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Recent lens (LZ-4) — the old Home dissolved into VaultSurface. This
// suite is Home.test.tsx migrated (masthead, quick doors, setup nudge, trial
// ambience, day-header hop, first-capture invitation — nothing Home tested
// loses coverage), plus the LZ-4 changes: the archived drop-out, the
// 14-day/100-note floor + foot line, the Recent-only furniture confinement,
// and the draft surviving a Recent→All lens switch.

// The shared account-summary read (trial ambience, §3.1 places 2 + 4) — mocked
// so these tests control the plan state without wiring a whole account door.
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
        <NavBandsProvider>
          <Routes>
            <Route path="/" element={children} />
            <Route path="/notes" element={<LocationSpy />} />
            <Route path="/new" element={<LocationSpy />} />
            <Route path="/connect" element={<LocationSpy />} />
            <Route path="/calendar" element={<LocationSpy />} />
            <Route path="/today" element={<LocationSpy />} />
          </Routes>
        </NavBandsProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

// Fixture stamps are RELATIVE to now — the Recent floor (14 days) would age
// fixed dates out of the window and time-bomb the suite.
const hoursAgo = (n: number) => new Date(Date.now() - n * 3600_000).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const SEED_ONLY: Row[] = [
  {
    id: "g1",
    path: "Welcome to your vault 🪂",
    tags: ["guide"],
    createdAt: hoursAgo(5),
    updatedAt: hoursAgo(5),
  },
];

const WITH_USER_NOTE: Row[] = [
  ...SEED_ONLY,
  {
    id: "u1",
    path: "My first thought",
    preview: "Something I wrote.",
    tags: ["capture"],
    createdAt: hoursAgo(2),
    updatedAt: hoursAgo(2),
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

describe("VaultSurface — the Recent lens (LZ-4, formerly Home)", () => {
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
    const fetchImpl = installFetch(SEED_ONLY);
    render(
      <Wrap>
        <VaultSurface lens="recent" />
      </Wrap>,
    );
    // The H1 is the vault name — not "Home", not "Welcome". The name is the
    // identity threaded through the whole app.
    expect(await screen.findByRole("heading", { level: 1, name: "default" })).toBeInTheDocument();
    expect(screen.getByText(/everything here is yours/i)).toBeInTheDocument();
    const dateQuery = fetchImpl.mock.calls
      .map(([input]) => new URL(String(input)).searchParams)
      .find((params) => params.has("meta[updated_at][gte]"));
    expect(dateQuery).toBeDefined();
    expect(dateQuery!.get("exclude_tag")).toBe("archived");
    expect(dateQuery!.has("limit")).toBe(false);
  });

  it("wears the lens label over the list — RECENT · what you've touched lately", async () => {
    installFetch(WITH_USER_NOTE);
    render(
      <Wrap>
        <VaultSurface lens="recent" />
      </Wrap>,
    );
    expect(
      await screen.findByRole("heading", { name: /recent · what you've touched lately/i }),
    ).toBeInTheDocument();
    // The lens is a label, never the headline — the H1 stays the vault name.
    expect(screen.queryByRole("heading", { level: 1, name: /recent/i })).toBeNull();
  });

  // LZ-5: the mobile lens strip rides the Recent body too — the strip
  // renders on EVERY lens, so a phone can leave any lens in one tap. At `/`
  // the Recent chip is the active pill (the model's matcher, verbatim).
  it("carries the mobile lens strip (lg:hidden) with Recent active at / (LZ-5)", async () => {
    installFetch(WITH_USER_NOTE);
    render(
      <Wrap>
        <VaultSurface lens="recent" />
      </Wrap>,
    );
    const strip = await screen.findByRole("navigation", { name: /^lenses$/i });
    expect(strip.className).toMatch(/\blg:hidden\b/);
    const chips = within(strip).getAllByRole("link");
    expect(chips.map((a) => a.getAttribute("href"))).toEqual([
      "/",
      "/notes",
      "/notes?view=pinned",
      "/notes?view=archived",
    ]);
    expect(
      chips.filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent),
    ).toEqual(["Recent"]);
  });

  it("shows warm quick doors + a setup nudge + the focus-warmed composer for a fresh vault", async () => {
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <VaultSurface lens="recent" />
      </Wrap>,
    );
    await screen.findByRole("heading", { level: 1, name: "default" });
    // Fresh mode is gated on notes settling — await the quick doors appearing.
    const quickNav = await screen.findByRole("navigation", { name: /quick actions/i });
    expect(within(quickNav).getByText(/connect your ai/i)).toBeInTheDocument();
    expect(within(quickNav).getByText(/bring your notes over/i)).toBeInTheDocument();
    // The single quiet sun nudge (not a wall of checkboxes).
    expect(screen.getByText(/finish setting up/i)).toBeInTheDocument();
    // The fresh-mode focus warmth rides the composer (`focused` → the
    // composer-focus ring), exactly as on the old Home.
    expect(screen.getByRole("form", { name: /write a note/i })).toHaveClass("composer-focus");
    // The seed guide note shows in the timeline (it's a real note).
    expect(screen.getByText(/welcome to your vault/i)).toBeInTheDocument();
  });

  it("goes quiet for a returning vault: no quick doors, the note gathers below", async () => {
    installFetch(WITH_USER_NOTE);
    render(
      <Wrap>
        <VaultSurface lens="recent" />
      </Wrap>,
    );
    expect(await screen.findByText("My first thought")).toBeInTheDocument();
    // Vault name still leads; the fresh-only quick doors are gone.
    expect(screen.getByRole("heading", { level: 1, name: "default" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /quick actions/i })).not.toBeInTheDocument();
    // No focus warmth once the vault is lived-in.
    expect(screen.getByRole("form", { name: /write a note/i })).not.toHaveClass("composer-focus");
  });

  // THE CRUX (W3): this is the new-device fix, proven in place. `beforeEach`
  // already clears localStorage for every test in this file — so this vault
  // is exactly what an established account looks like on a brand-new browser
  // (a real note, zero local storage). Before the rework this still showed
  // the shelf (connect/import were per-device ticks that never got made on a
  // fresh device); now `write` is the only tracked signal, and a real note
  // satisfies it everywhere.
  it("W3: an established vault shows NO setup shelf, even with empty localStorage (the cross-device fix)", async () => {
    installFetch(WITH_USER_NOTE);
    render(
      <Wrap>
        <VaultSurface lens="recent" />
      </Wrap>,
    );
    expect(await screen.findByText("My first thought")).toBeInTheDocument();
    expect(screen.queryByText(/finish setting up/i)).not.toBeInTheDocument();
    expect(localStorage.getItem("notes:home-checklist:v1")).toBeNull();
  });

  it("shows the setup shelf for a genuinely fresh/empty vault (seed guide only, no user note)", async () => {
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <VaultSurface lens="recent" />
      </Wrap>,
    );
    expect(await screen.findByText(/finish setting up/i)).toBeInTheDocument();
    expect(screen.getByText(/write your first note/i)).toBeInTheDocument();
  });

  it("dismisses the setup nudge for this session only — no longer persisted (W3)", async () => {
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <VaultSurface lens="recent" />
      </Wrap>,
    );
    await screen.findByText(/finish setting up/i);
    fireEvent.click(screen.getByRole("button", { name: /dismiss setup/i }));
    await waitFor(() => expect(screen.queryByText(/finish setting up/i)).not.toBeInTheDocument());
    // Nothing written to storage — dismissing is in-memory only now. A fresh
    // mount (new tab, reload) re-evaluates from the real vault state instead
    // of trusting a stale per-device flag.
    expect(localStorage.getItem("notes:home-checklist:v1")).toBeNull();
  });

  it("hides the account backlink for a self-host (OAuth) vault", async () => {
    // Default seed vault has clientId "c" (a foreign OAuth client, not the
    // home door) → no account on THIS door → no backlink.
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <VaultSurface lens="recent" />
      </Wrap>,
    );
    await screen.findByRole("heading", { level: 1, name: "default" });
    expect(screen.queryByRole("link", { name: /manage your account/i })).not.toBeInTheDocument();
  });

  it("W2-5: the header's stopgap Calendar link stays gone (the nav bands carry Calendar)", async () => {
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <VaultSurface lens="recent" />
      </Wrap>,
    );
    await screen.findByRole("heading", { level: 1, name: "default" });
    expect(screen.queryByRole("link", { name: /^calendar$/i })).not.toBeInTheDocument();
  });

  it("F8/W2-3: the day-header hop still lands on the day drill-in", async () => {
    // Pin the clock so the 2026-07-02 row reads as "Today" — a deterministic
    // day-group label regardless of host locale/timezone (and safely inside
    // the 14-day floor).
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 2, 12, 0, 0));
    installFetch([
      {
        id: "u1",
        path: "My first thought",
        preview: "Something I wrote.",
        tags: ["capture"],
        createdAt: "2026-07-02T09:00:00.000Z",
        updatedAt: "2026-07-02T09:00:00.000Z",
      },
    ]);
    render(
      <Wrap>
        <VaultSurface lens="recent" />
      </Wrap>,
    );
    await screen.findByText("My first thought");
    // The row's day-group header is a link into the single-day view (shared
    // RecentTimeline component; this asserts the hop still works now that
    // the Recent lens is the only renderer of this list).
    const dayHeader = screen.getByRole("link", { name: /^today$/i });
    expect(dayHeader).toHaveAttribute("href", "/today?date=2026-07-02");
  });

  it("invites the first capture when the vault is genuinely empty (no seed note either)", async () => {
    installFetch([]);
    render(
      <Wrap>
        <VaultSurface lens="recent" />
      </Wrap>,
    );
    expect(await screen.findByText(/a quiet, empty page/i)).toBeInTheDocument();
    // The calm arrival: no lens label over nothing, no floor foot (All notes
    // would be exactly as empty).
    expect(
      screen.queryByRole("heading", { name: /recent · what you've touched lately/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/looking for older notes/i)).not.toBeInTheDocument();
    // W2-10: the CTA focuses the real composer in place — no hop to /new.
    fireEvent.click(screen.getByRole("button", { name: /write the first one/i }));
    expect(screen.getByRole("textbox", { name: /what's on your mind\?/i })).toHaveFocus();
  });

  it("shows an in-app /account backlink for a home-door vault (no cross-origin console hop)", async () => {
    seedHostedStore();
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <VaultSurface lens="recent" />
      </Wrap>,
    );
    await screen.findByRole("heading", { level: 1, name: "aaron" });
    // In-app react-router link (same origin) — never a cross-origin console URL.
    const link = screen.getByRole("link", { name: /manage your account/i });
    expect(link).toHaveAttribute("href", "/account");
    expect(link.getAttribute("href")).not.toContain("cloud.parachute.computer");
  });

  // ---------------------------------------------------------------------
  // LZ-4 §1.1 — archived notes drop OUT of Recent, and the window wears a
  // visible floor: 14 days or 100 notes, whichever comes first, with the
  // quiet "All notes →" foot.
  // ---------------------------------------------------------------------
  describe("the archived drop + the floor", () => {
    it("drops archived notes out of Recent entirely (Home used to show them dimmed)", async () => {
      installFetch([
        ...WITH_USER_NOTE,
        {
          id: "a1",
          path: "Set-aside plan",
          tags: ["archived"],
          createdAt: hoursAgo(1),
          updatedAt: hoursAgo(1),
        },
      ]);
      render(
        <Wrap>
          <VaultSurface lens="recent" />
        </Wrap>,
      );
      expect(await screen.findByText("My first thought")).toBeInTheDocument();
      // Fresher than every other note, and still not here — archived means
      // set aside, not "touched lately".
      expect(screen.queryByText("Set-aside plan")).not.toBeInTheDocument();
      // And Recent carries no All-lens chrome to toggle them back: no search,
      // no Filters, no show-archived. That capability lives on All.
      expect(screen.queryByLabelText(/search notes/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /filters/i })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/show archived/i)).not.toBeInTheDocument();
    });

    it("cuts the window at 14 days — older notes belong to All notes", async () => {
      installFetch([
        ...WITH_USER_NOTE,
        {
          id: "old1",
          path: "Last month's plan",
          tags: ["capture"],
          createdAt: daysAgo(20),
          updatedAt: daysAgo(20),
        },
      ]);
      render(
        <Wrap>
          <VaultSurface lens="recent" />
        </Wrap>,
      );
      expect(await screen.findByText("My first thought")).toBeInTheDocument();
      expect(screen.queryByText("Last month's plan")).not.toBeInTheDocument();
      // The floor is visible: the quiet foot points at everything. (The
      // "All notes →" arrow name keeps this distinct from the LZ-5 lens
      // strip's own All-notes chip.)
      expect(screen.getByText(/looking for older notes\?/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /all notes →/i })).toHaveAttribute("href", "/notes");
    });

    it("caps the window at 100 notes even inside the 14 days", async () => {
      const many: Row[] = Array.from({ length: 120 }, (_, i) => ({
        id: `m${i}`,
        path: `quick/thought-${i}`,
        tags: ["capture"],
        createdAt: hoursAgo(i * 0.1),
        updatedAt: hoursAgo(i * 0.1),
      }));
      installFetch(many);
      render(
        <Wrap>
          <VaultSurface lens="recent" />
        </Wrap>,
      );
      await screen.findByText("quick/thought-0");
      const section = screen.getByRole("region", { name: /recent notes/i });
      // The 100 most recent rows render; the 20 oldest wait behind the foot.
      expect(within(section).getAllByRole("listitem")).toHaveLength(100);
      expect(within(section).queryByText("quick/thought-119")).not.toBeInTheDocument();
      expect(within(section).getByText(/looking for older notes\?/i)).toBeInTheDocument();
    });

    it("a dormant vault (notes exist, none inside the window) gets the honest line + the door — not the empty-page invite", async () => {
      installFetch([
        {
          id: "old1",
          path: "Last month's plan",
          tags: ["capture"],
          createdAt: daysAgo(30),
          updatedAt: daysAgo(30),
        },
      ]);
      render(
        <Wrap>
          <VaultSurface lens="recent" />
        </Wrap>,
      );
      expect(await screen.findByText(/nothing touched in the last two weeks/i)).toBeInTheDocument();
      // Not the empty-vault invitation — the vault ISN'T empty. (The arrow
      // name targets the foot's door, not the lens strip's chip.)
      expect(screen.queryByText(/a quiet, empty page/i)).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: /all notes →/i })).toHaveAttribute("href", "/notes");
    });

    it("the foot rides the populated window too — Recent always names its edge", async () => {
      installFetch(WITH_USER_NOTE);
      render(
        <Wrap>
          <VaultSurface lens="recent" />
        </Wrap>,
      );
      await screen.findByText("My first thought");
      const foot = screen.getByText(/looking for older notes\?/i);
      expect(within(foot).getByRole("link", { name: /all notes/i })).toHaveAttribute(
        "href",
        "/notes",
      );
    });
  });

  // ---------------------------------------------------------------------
  // Trial ambience (DESIGN-SPEC §3.1) — the Recent lens carries sanctioned
  // places 2 (the PlanBacklink trial line) and 4 (the ≤7-day countdown nudge
  // under the composer, Recent lens only). Nowhere else on this surface.
  // ---------------------------------------------------------------------
  describe("trial ambience — the backlink line + the ≤7-day nudge", () => {
    it("the backlink carries the trial countdown while trialing (place 2)", async () => {
      seedHostedStore();
      vi.mocked(getAccountSummaryState).mockResolvedValue(trialSummary(5));
      installFetch(SEED_ONLY);
      render(
        <Wrap>
          <VaultSurface lens="recent" />
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
          <VaultSurface lens="recent" />
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
          <VaultSurface lens="recent" />
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
          <VaultSurface lens="recent" />
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
          <VaultSurface lens="recent" />
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
          <VaultSurface lens="recent" />
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
          <VaultSurface lens="recent" />
        </Wrap>,
      );
      await screen.findByRole("heading", { level: 1, name: "default" });
      expect(getAccountSummaryState).not.toHaveBeenCalled();
      expect(screen.queryByText(/your trial ends/i)).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------
  // LZ-4 — furniture confinement: the Recent-only furniture (trial nudge,
  // quick doors, setup nudge, plan backlink) appears on the Recent lens
  // EXCLUSIVELY. Same four sanctioned ambience places, no expansion, no
  // leakage onto All/Pinned/Archive.
  // ---------------------------------------------------------------------
  describe("Recent-only furniture stays off the other lenses", () => {
    const assertNoFurniture = () => {
      expect(screen.queryByRole("navigation", { name: /quick actions/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/finish setting up/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/your trial ends/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /manage your account/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/looking for older notes/i)).not.toBeInTheDocument();
    };

    it("the All lens carries none of it", async () => {
      // Hosted vault + a live trial: the strongest bait. Still nothing.
      // (Since LZ-5 the surface hosts the lens strip, whose nav model reads
      // the SHARED summary query for the Account trial chip — the same
      // app-wide read the Rail/NavSheet already make at every viewport — so
      // "never fetches" is no longer the confinement claim; "no visible
      // furniture off Recent" is.)
      seedHostedStore();
      vi.mocked(getAccountSummaryState).mockResolvedValue(trialSummary(3));
      installFetch([]);
      render(
        <Wrap>
          <VaultSurface />
        </Wrap>,
      );
      await screen.findByText(/this vault has no notes yet/i);
      assertNoFurniture();
    });

    it("the Pinned and Archive browse lenses carry none of it", async () => {
      seedHostedStore();
      vi.mocked(getAccountSummaryState).mockResolvedValue(trialSummary(3));
      installFetch([]);
      for (const preset of ["pinned", "archived"] as const) {
        const view = render(
          <Wrap>
            <VaultSurface preset={preset} />
          </Wrap>,
        );
        await screen.findByRole("heading", { level: 1, name: "aaron" });
        assertNoFurniture();
        view.unmount();
      }
    });
  });

  // ---------------------------------------------------------------------
  // LZ-4 §3.2 — remount honesty: a Recent↔All switch remounts the composer
  // (different lens bodies), and the draft must ride through — restored
  // synchronously at mount from the per-vault draft store, the unmount
  // flush catching anything mid-debounce.
  // ---------------------------------------------------------------------
  it("the composer draft survives a Recent→All lens switch intact", async () => {
    installFetch(WITH_USER_NOTE);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <MemoryRouter initialEntries={["/"]}>
        <QueryClientProvider client={qc}>
          <NavBandsProvider>
            <Routes>
              <Route path="/" element={<VaultSurface lens="recent" />} />
              <Route path="/notes" element={<VaultSurface />} />
            </Routes>
          </NavBandsProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    // Wait for the timeline (and with it the floor's foot) to settle.
    await screen.findByText("My first thought");

    // Type on Recent…
    const recentInput = screen.getByRole("textbox", { name: /what's on your mind\?/i });
    fireEvent.change(recentInput, { target: { value: "a thought mid-flight" } });

    // …switch lenses through the floor's own door (same push semantics as the
    // rail's All notes item). A real pointerdown on any outside door fires
    // blur BEFORE the click lands — and that blur-flush (LZ-1) is exactly
    // what protects a mid-type switch: the incoming lens reads the draft
    // store during RENDER, before the outgoing composer's unmount cleanup
    // runs. jsdom's fireEvent.click skips the implicit blur, so fire it in
    // the real order.
    fireEvent.blur(recentInput);
    fireEvent.click(screen.getByRole("link", { name: /all notes →/i }));
    await screen.findByRole("heading", { name: /all notes · everything, searchable/i });

    // …and the words are already there. Nothing lost to the remount.
    const allInput = screen.getByRole("textbox", { name: /what's on your mind\?/i });
    expect(allInput).toHaveValue("a thought mid-flight");
  });
});
