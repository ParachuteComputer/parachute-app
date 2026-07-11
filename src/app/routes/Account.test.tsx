import { Account } from "@/app/routes/Account";
import { getAccountSummary, getSession, listVaults } from "@/lib/account/client";
import { openHostedVault } from "@/lib/account/hosted-vault";
import type { AccountSummary } from "@/lib/account/types";
import { useVaultStore } from "@/lib/vault";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The app-as-manager surface (SYNTHESIS "The shape"): who you are + plan, your
// Cloud vaults, AI connections — all driven by the account bearer. Degrades to a
// calm "this device" view with no cloud door / signed out.

vi.mock("@/lib/account/client", () => ({
  getSession: vi.fn(),
  listVaults: vi.fn(),
  getAccountSummary: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/account/hosted-vault", () => ({
  openHostedVault: vi.fn().mockResolvedValue("v1"),
}));

const SUMMARY: AccountSummary = {
  email: "ag@unforced.org",
  plan: {
    tier: "standard",
    label: "Standard",
    price_monthly_usd: 5,
    vault_limit: 3,
    vaults_used: 1,
  },
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
  vi.mocked(getSession).mockReset();
  vi.mocked(listVaults).mockReset();
  vi.mocked(getAccountSummary).mockReset();
  vi.mocked(openHostedVault).mockReset().mockResolvedValue("v1");
});
afterEach(() => {
  useVaultStore.setState({ vaults: {}, activeVaultId: null });
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
    expect(screen.getByRole("link", { name: /manage plan & billing/i })).toBeInTheDocument();
    expect(screen.getByText("AI connections")).toBeInTheDocument();
  });

  it("degrades gracefully when the summary is absent (no fabricated numbers)", async () => {
    vi.mocked(getSession).mockResolvedValue({
      signed_in: true,
      csrf: "c",
      email: "ag@unforced.org",
    });
    vi.mocked(listVaults).mockResolvedValue({ vaults: [CLOUD_VAULT] });
    vi.mocked(getAccountSummary).mockResolvedValue(null);

    renderAccount();
    await waitFor(() => expect(screen.getByText("ag@unforced.org")).toBeInTheDocument());
    expect(screen.getByText(/your plan lives on the door/i)).toBeInTheDocument();
    expect(screen.queryByText(/\d+ of \d+ vaults/)).not.toBeInTheDocument(); // no fake meter
    // Billing still derives from a cloud vault host (the door-agnostic fallback).
    expect(screen.getByRole("link", { name: /manage plan & billing/i })).toHaveAttribute(
      "href",
      "https://cloud.parachute.computer/console",
    );
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
    });

    renderAccount();
    await waitFor(() => expect(screen.getByText(/Standard/)).toBeInTheDocument());
    expect(screen.queryByText(/of 3 vaults/)).not.toBeInTheDocument();
  });

  it("opens the billing link in a new tab so the app stays open", async () => {
    vi.mocked(getSession).mockResolvedValue({
      signed_in: true,
      csrf: "c",
      email: "ag@unforced.org",
    });
    vi.mocked(listVaults).mockResolvedValue({ vaults: [CLOUD_VAULT] });
    vi.mocked(getAccountSummary).mockResolvedValue(null);

    renderAccount();
    const link = await screen.findByRole("link", { name: /manage plan & billing/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });
});
