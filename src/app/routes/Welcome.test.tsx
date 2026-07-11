import { Welcome } from "@/app/routes/Welcome";
import { getSession, listVaults } from "@/lib/account/client";
import { createHostedVault, openHostedVault } from "@/lib/account/hosted-vault";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The post-sign-in dispatcher (SYNTHESIS #4): confirms the session, lists the
// account's vaults, then branches by count — first-vault naming (#5), the
// welcome-back beat (#7), or the picker (#8). `createHostedVault` /
// `openHostedVault` (hosted-vault.ts) are the only vault-mutating calls it
// makes; both are mocked here so no real network/store side effects run.

vi.mock("@/lib/account/client", () => ({
  getSession: vi.fn(),
  listVaults: vi.fn(),
}));

vi.mock("@/lib/account/hosted-vault", async () => {
  const actual = await vi.importActual<typeof import("@/lib/account/hosted-vault")>(
    "@/lib/account/hosted-vault",
  );
  return {
    ...actual,
    createHostedVault: vi.fn(),
    openHostedVault: vi.fn(),
  };
});

function renderWelcome(initial = "/welcome") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/" element={<div>Home surface</div>} />
        <Route path="/add" element={<div>Connect a vault</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Welcome (the post-sign-in dispatcher)", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
    vi.mocked(listVaults).mockReset();
    vi.mocked(createHostedVault).mockReset().mockResolvedValue("v1");
    vi.mocked(openHostedVault).mockReset().mockResolvedValue("v1");
  });

  it("redirects to the front door when the session isn't signed in", async () => {
    vi.mocked(getSession).mockResolvedValue({ signed_in: false, csrf: "c" });
    renderWelcome();
    await waitFor(() => expect(screen.getByText("Home surface")).toBeInTheDocument());
    expect(listVaults).not.toHaveBeenCalled();
  });

  it("redirects to the front door when the session check fails (network)", async () => {
    vi.mocked(getSession).mockRejectedValue(new Error("offline"));
    renderWelcome();
    await waitFor(() => expect(screen.getByText("Home surface")).toBeInTheDocument());
  });

  describe("first-vault naming (0 vaults)", () => {
    beforeEach(() => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "csrf-1",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
    });

    it("shows the signed-in chip, account-created eyebrow, and the live name echo + button label", async () => {
      renderWelcome();
      await waitFor(() => expect(screen.getByText(/let's make your first/i)).toBeInTheDocument());
      expect(screen.getByText(/signed in as ag@unforced\.org/i)).toBeInTheDocument();
      expect(screen.getByText(/account created/i)).toBeInTheDocument();

      const field = screen.getByLabelText(/vault name/i) as HTMLInputElement;
      fireEvent.change(field, { target: { value: "Moss Garden!" } });
      // auto-lowercase + strip to [a-z0-9-]
      expect(field.value).toBe("mossgarden");
      expect(screen.getByText(/your vault:/i)).toBeInTheDocument();
      expect(screen.getByText("mossgarden")).toBeInTheDocument();
      // Door-agnostic: no hardcoded cloud host in the echo (the door assigns the
      // real address at mint time). The permanent-address promise stays.
      expect(screen.queryByText(/u\.parachute\.computer/i)).not.toBeInTheDocument();
      expect(screen.getByText(/the address is permanent/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /create mossgarden →/i })).toBeInTheDocument();
    });

    it("has NO skip affordance and NO 'change it later' copy (the name is the immutable slug)", async () => {
      renderWelcome();
      await waitFor(() => expect(screen.getByText(/let's make your first/i)).toBeInTheDocument());
      expect(screen.queryByText(/skip/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/change it later/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/change later/i)).not.toBeInTheDocument();
    });

    it("submits the name, creates the hosted vault, and lands on the ready beat", async () => {
      renderWelcome();
      await waitFor(() => expect(screen.getByText(/let's make your first/i)).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "moss" } });
      fireEvent.click(screen.getByRole("button", { name: /create moss →/i }));

      await waitFor(() => expect(createHostedVault).toHaveBeenCalledWith("moss", "csrf-1"));
      // The "X is ready." headline splits across the accent-word <span>, so its
      // accessible NAME (which concatenates descendant text) is what to match —
      // getByText only sees an element's own direct text nodes.
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /moss is ready/i })).toBeInTheDocument(),
      );

      fireEvent.click(screen.getByRole("button", { name: /open my vault/i }));
      await waitFor(() => expect(screen.getByText("Home surface")).toBeInTheDocument());
    });
  });

  describe("picker (many vaults)", () => {
    beforeEach(() => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "csrf-2",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({
        vaults: [
          { name: "moss", address: "https://u.parachute.computer/vault/moss" },
          { name: "journal", address: "https://u.parachute.computer/vault/journal" },
          { name: "atlas", address: "https://u.parachute.computer/vault/atlas" },
        ],
      });
    });

    it("shows a card with Open per vault and opens the picked one", async () => {
      renderWelcome();
      // Same accent-word-span note as above — assert via accessible name.
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /which vault today/i })).toBeInTheDocument(),
      );

      expect(screen.getByText(/3 vaults on cloud/i)).toBeInTheDocument();
      const opens = screen.getAllByRole("button", { name: /open →/i });
      expect(opens).toHaveLength(3);
      expect(screen.getAllByText("☁ Cloud")).toHaveLength(3);

      fireEvent.click(opens[1] as HTMLElement);
      await waitFor(() => expect(openHostedVault).toHaveBeenCalledWith("journal", "csrf-2"));
    });

    it("offers Create a new vault (addvault naming) and Connect a self-hosted vault", async () => {
      renderWelcome();
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /which vault today/i })).toBeInTheDocument(),
      );

      expect(screen.getByRole("link", { name: /connect a self-hosted vault/i })).toHaveAttribute(
        "href",
        "/add",
      );

      fireEvent.click(screen.getByRole("button", { name: /create a new vault/i }));
      await waitFor(() => expect(screen.getByText(/adding a vault/i)).toBeInTheDocument());
      expect(screen.getByText(/let's make your new/i)).toBeInTheDocument();
      expect(screen.getByText(/separate from/i)).toBeInTheDocument();
      expect(screen.getByText(/moss/)).toBeInTheDocument();
    });
  });

  describe("welcome-back (1 vault)", () => {
    it("auto-opens the single vault and clears the way to Home", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "csrf-3",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [{ name: "moss" }] });
      renderWelcome();
      await waitFor(() => expect(openHostedVault).toHaveBeenCalledWith("moss", "csrf-3"));
      await waitFor(() => expect(screen.getByText("Home surface")).toBeInTheDocument());
    });
  });

  describe("?new=1 — the add-vault naming entry point", () => {
    it("routes straight to the addvault naming form on a fresh mount", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "csrf-4",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [{ name: "moss" }] });
      renderWelcome("/welcome?new=1");
      await waitFor(() => expect(screen.getByText(/adding a vault/i)).toBeInTheDocument());
      expect(openHostedVault).not.toHaveBeenCalled();
    });
  });

  describe("net-error (signed in, vault list fetch fails)", () => {
    it("shows the weather card with a retry", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "csrf-5",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockRejectedValueOnce(new Error("boom"));
      renderWelcome();
      await waitFor(() => expect(screen.getByText(/couldn't fetch your/i)).toBeInTheDocument());

      vi.mocked(listVaults).mockResolvedValueOnce({ vaults: [] });
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      await waitFor(() => expect(screen.getByText(/let's make your first/i)).toBeInTheDocument());
    });
  });
});
