import { Welcome } from "@/app/routes/Welcome";
import { getSession, listVaults } from "@/lib/account/client";
import { getDoorDescriptor } from "@/lib/account/descriptor";
import { createHostedVault, openHostedVault } from "@/lib/account/hosted-vault";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
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

// Defaults to null (no descriptor / no template) — the naming echo's
// documented fallback, keeping every pre-P4 test byte-unchanged.
vi.mock("@/lib/account/descriptor", () => ({
  getDoorDescriptor: vi.fn().mockResolvedValue(null),
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

function FrontDoorEcho() {
  const location = useLocation();
  return <div>Home surface{location.search}</div>;
}

function renderWelcome(initial = "/welcome") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/" element={<FrontDoorEcho />} />
        <Route path="/add" element={<div>Connect a vault</div>} />
        <Route path="/add-vault" element={<div>Add-vault chooser</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Welcome (the post-sign-in dispatcher)", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
    vi.mocked(listVaults).mockReset();
    vi.mocked(getDoorDescriptor).mockReset().mockResolvedValue(null);
    vi.mocked(createHostedVault).mockReset().mockResolvedValue("v1");
    vi.mocked(openHostedVault).mockReset().mockResolvedValue("v1");
  });

  it("redirects to the front door when the session isn't signed in", async () => {
    vi.mocked(getSession).mockResolvedValue({ signed_in: false, csrf: "c" });
    renderWelcome();
    await waitFor(() => expect(screen.getByText("Home surface")).toBeInTheDocument());
    expect(listVaults).not.toHaveBeenCalled();
  });

  it("preserves ?link=expired through the signed-out redirect (front-door recovery)", async () => {
    // Cloud 302s a dead/used link to /welcome?link=expired; the recovery cue
    // lives on the front door, so the param must survive the redirect.
    vi.mocked(getSession).mockResolvedValue({ signed_in: false, csrf: "c" });
    renderWelcome("/welcome?link=expired");
    await waitFor(() => expect(screen.getByText(/home surface/i)).toBeInTheDocument());
    expect(screen.getByText(/\?link=expired/)).toBeInTheDocument();
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

    // HUB-PARITY P4: once a door advertises `vault_url_template`, the naming
    // echo substitutes the typed name into it — preview-only (the real,
    // post-creation address still comes from create/list responses).
    it("echoes the real address from vault_url_template when the door advertises one", async () => {
      vi.mocked(getDoorDescriptor).mockResolvedValue({
        vault_url_template: "https://hub.example/vault/{name}",
      });
      renderWelcome();
      await waitFor(() => expect(screen.getByText(/let's make your first/i)).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "moss" } });
      await waitFor(() =>
        expect(screen.getByText("https://hub.example/vault/moss")).toBeInTheDocument(),
      );
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

      // The account bearer is sourced inside the client now — no csrf threaded.
      await waitFor(() => expect(createHostedVault).toHaveBeenCalledWith("moss"));
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
      // Cloud's real GET /account/vaults shape: { vaults: [{ name, url, usage }] }
      // — `url` (not `address`), usage in BYTES only.
      vi.mocked(listVaults).mockResolvedValue({
        vaults: [
          {
            name: "moss",
            url: "https://u.parachute.computer/vault/moss",
            usage: { notes_bytes: 68_000_000, attachment_bytes: 3_000_000 },
          },
          { name: "journal", url: "https://u.parachute.computer/vault/journal" },
          { name: "atlas", url: "https://u.parachute.computer/vault/atlas" },
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
      // Door-provided `url` renders; usage is size-only (cloud gives bytes, no
      // note count) — 68M + 3M attachment bytes ⇒ "68 MB", never "· N notes".
      expect(screen.getByText("u.parachute.computer/vault/moss")).toBeInTheDocument();
      expect(screen.getByText("68 MB")).toBeInTheDocument();
      expect(screen.queryByText(/\bnotes?\b/i)).not.toBeInTheDocument();

      fireEvent.click(opens[1] as HTMLElement);
      await waitFor(() => expect(openHostedVault).toHaveBeenCalledWith("journal"));
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
      await waitFor(() => expect(openHostedVault).toHaveBeenCalledWith("moss"));
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

  describe("?pick=1 — force the picker (F13, AddVaultChooser's Open card)", () => {
    it("shows the picker instead of auto-opening, even with exactly one vault", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "csrf-6",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [{ name: "moss" }] });
      renderWelcome("/welcome?pick=1");
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /which vault today/i })).toBeInTheDocument(),
      );
      // The welcome-back auto-open beat must NOT have run — that's the F13
      // bug (silently reopening the only vault instead of showing the picker).
      expect(openHostedVault).not.toHaveBeenCalled();
    });

    it("falls through to first-vault naming when the account has zero vaults", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "csrf-7",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      renderWelcome("/welcome?pick=1");
      await waitFor(() => expect(screen.getByText(/let's make your first/i)).toBeInTheDocument());
    });
  });

  describe("naming form — the Back link (F6)", () => {
    it("onboarding (first vault) backs up to / (no other vault exists yet)", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "csrf-8",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      renderWelcome();
      await waitFor(() => expect(screen.getByText(/let's make your first/i)).toBeInTheDocument());
      fireEvent.click(screen.getByRole("link", { name: /back/i }));
      await waitFor(() => expect(screen.getByText("Home surface")).toBeInTheDocument());
    });

    it("addvault naming backs up to /add-vault (the chooser)", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "csrf-9",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [{ name: "moss" }] });
      renderWelcome("/welcome?new=1");
      await waitFor(() => expect(screen.getByText(/adding a vault/i)).toBeInTheDocument());
      fireEvent.click(screen.getByRole("link", { name: /back/i }));
      await waitFor(() => expect(screen.getByText("Add-vault chooser")).toBeInTheDocument());
    });
  });

  describe("a creation failure — friendly copy (F12) + the naming form's Back stays available (F6)", () => {
    it("maps a bare wire code to human copy instead of showing it raw", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "csrf-10",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      vi.mocked(createHostedVault).mockRejectedValue(new Error("vault_limit_reached"));
      renderWelcome();
      await waitFor(() => expect(screen.getByText(/let's make your first/i)).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "moss" } });
      fireEvent.click(screen.getByRole("button", { name: /create moss →/i }));

      await waitFor(() =>
        expect(screen.getByText(/reached your plan's vault limit/i)).toBeInTheDocument(),
      );
      expect(screen.queryByText("vault_limit_reached")).not.toBeInTheDocument();
    });

    it("a failure returns to the SAME naming form (typed name preserved), Back still bails to /add-vault", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "csrf-11",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [{ name: "moss" }] });
      vi.mocked(createHostedVault).mockRejectedValue(new Error("vault_taken"));
      renderWelcome("/welcome?new=1");
      await waitFor(() => expect(screen.getByText(/adding a vault/i)).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "moss" } });
      fireEvent.click(screen.getByRole("button", { name: /create moss →/i }));

      await waitFor(() => expect(screen.getByText(/already taken/i)).toBeInTheDocument());
      // Still the addvault naming form (not a separate error screen) — the
      // Back link (F6) is the escape hatch, and it's already on this screen.
      fireEvent.click(screen.getByRole("link", { name: /back/i }));
      await waitFor(() => expect(screen.getByText("Add-vault chooser")).toBeInTheDocument());
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
