import { Welcome } from "@/app/routes/Welcome";
import { getSession, listVaults } from "@/lib/account/client";
import { openHostedVault } from "@/lib/account/hosted-vault";
import { useToastStore } from "@/lib/toast/store";
import { type NavLogEntry, NavTypeLog } from "@/test/nav-probe";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The post-sign-in dispatcher (SYNTHESIS #4): confirms the session, lists the
// account's vaults, then branches by count — the creation ceremony
// (/add-vault/create?first=1, W2-6), the welcome-back beat (#7), or the
// picker (#8). SLIMMED IN W2-6: the naming/creating/ready beats moved out to
// AddVaultCreate.tsx (their tests moved with them); what's left here is the
// dispatch, the welcome-back auto-open, the picker, and the `?new=1` shim.

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
    openHostedVault: vi.fn(),
  };
});

function FrontDoorEcho() {
  const location = useLocation();
  return <div>Home surface{location.search}</div>;
}

function CreateEcho() {
  const location = useLocation();
  return <div>Create ceremony{location.search}</div>;
}

// A browser-Back stand-in: pops the MemoryRouter's own history stack, exactly
// as the OS/browser Back button would.
function GoBack() {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="test-go-back" onClick={() => navigate(-1)}>
      go-back
    </button>
  );
}

function renderWelcome(initial = "/welcome", navLog?: NavLogEntry[]) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      {navLog ? <NavTypeLog log={navLog} /> : null}
      <GoBack />
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/" element={<FrontDoorEcho />} />
        <Route path="/add" element={<div>Connect a vault</div>} />
        <Route path="/add-vault" element={<div>Add-vault chooser</div>} />
        <Route path="/add-vault/create" element={<CreateEcho />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Welcome (the post-sign-in dispatcher)", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
    vi.mocked(listVaults).mockReset();
    vi.mocked(openHostedVault).mockReset().mockResolvedValue("v1");
    useToastStore.setState({ toasts: [] });
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

  describe("first-vault (0 vaults) — hands off to the creation ceremony (W2-6)", () => {
    beforeEach(() => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "csrf-1",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
    });

    it("REPLACEs to /add-vault/create?first=1 (NAVIGATION.md: the dispatcher is transient)", async () => {
      const navLog: NavLogEntry[] = [];
      renderWelcome("/welcome", navLog);
      await waitFor(() => expect(screen.getByText(/create ceremony/i)).toBeInTheDocument());
      expect(screen.getByText(/\?first=1/)).toBeInTheDocument();
      expect(navLog.at(-1)).toEqual({ type: "REPLACE", pathname: "/add-vault/create?first=1" });
    });
  });

  describe("?new=1 — the pre-W2-6 naming entry, now a shim", () => {
    it("REPLACEs to /add-vault/create without waiting on a session check", async () => {
      // Old bookmarks / stale UI land here; the creation ceremony owns its
      // own URL now (NAVIGATION.md: (a) redirect shims — replace).
      const navLog: NavLogEntry[] = [];
      vi.mocked(getSession).mockResolvedValue({ signed_in: true, csrf: "c" });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [{ name: "moss" }] });
      renderWelcome("/welcome?new=1", navLog);
      await waitFor(() => expect(screen.getByText(/create ceremony/i)).toBeInTheDocument());
      expect(navLog.at(-1)).toEqual({ type: "REPLACE", pathname: "/add-vault/create" });
      // Pure shim: no dispatch ran, nothing auto-opened.
      expect(getSession).not.toHaveBeenCalled();
      expect(openHostedVault).not.toHaveBeenCalled();
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
      // The accent-word <span> splits the headline, so assert via the
      // accessible NAME (which concatenates descendant text).
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

    // NAVIGATION.md: "Picker: user picks a vault → /" — user-initiated, push
    // (F7 offender: this used to be a gratuitous replace, so Back from Home
    // couldn't return to "which vault today?").
    it("opening a picked vault PUSHes / (NAVIGATION.md), so Back can return to the picker", async () => {
      const navLog: NavLogEntry[] = [];
      renderWelcome("/welcome", navLog);
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /which vault today/i })).toBeInTheDocument(),
      );
      const opens = screen.getAllByRole("button", { name: /open →/i });
      fireEvent.click(opens[1] as HTMLElement);
      await waitFor(() => expect(screen.getByText("Home surface")).toBeInTheDocument());
      expect(navLog.at(-1)).toEqual({ type: "PUSH", pathname: "/" });
    });

    // §4.4 switch-confirmation: picking a vault announces "Now in {vault}".
    it("picking a vault toasts 'Now in {vault}'", async () => {
      renderWelcome();
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /which vault today/i })).toBeInTheDocument(),
      );
      const opens = screen.getAllByRole("button", { name: /open →/i });
      fireEvent.click(opens[1] as HTMLElement);
      await waitFor(() =>
        expect(useToastStore.getState().toasts.map((t) => t.message)).toContain("Now in journal"),
      );
    });

    it("offers Create a new vault and Connect a self-hosted vault", async () => {
      renderWelcome();
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /which vault today/i })).toBeInTheDocument(),
      );

      expect(screen.getByRole("link", { name: /connect a self-hosted vault/i })).toHaveAttribute(
        "href",
        "/add",
      );

      fireEvent.click(screen.getByRole("button", { name: /create a new vault/i }));
      await waitFor(() => expect(screen.getByText(/create ceremony/i)).toBeInTheDocument());
    });

    // NAVIGATION.md: "Picker: '＋ Create a new vault' → /add-vault/create" —
    // user-initiated (picker → naming), push. W2-6 made the naming form its
    // own route, so this is a plain cross-route hop.
    it("Create a new vault PUSHes /add-vault/create (NAVIGATION.md)", async () => {
      const navLog: NavLogEntry[] = [];
      renderWelcome("/welcome", navLog);
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /which vault today/i })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: /create a new vault/i }));
      await waitFor(() => expect(screen.getByText(/create ceremony/i)).toBeInTheDocument());
      expect(navLog.at(-1)).toEqual({ type: "PUSH", pathname: "/add-vault/create" });
    });

    // The W2-2 regression this suite has guarded since the picker→naming push
    // landed: Back from the naming step must return the PICKER, never a stale
    // stage. Post-W2-6 the naming form is its own route, so the POP remounts
    // the dispatcher — same visible contract, structurally sturdier.
    it("picker → Create → naming → Back returns to the PICKER (F7)", async () => {
      renderWelcome();
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /which vault today/i })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: /create a new vault/i }));
      await waitFor(() => expect(screen.getByText(/create ceremony/i)).toBeInTheDocument());

      // Back (browser POP `/add-vault/create` → `/welcome`): the picker returns.
      fireEvent.click(screen.getByTestId("test-go-back"));
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /which vault today/i })).toBeInTheDocument(),
      );
      expect(screen.queryByText(/create ceremony/i)).not.toBeInTheDocument();
    });

    // Same shape on the `?pick=1` variant (AddVaultChooser's "Open" card →
    // forced picker even with one vault). Back must return the picker, and
    // the welcome-back auto-open must NOT fire (the ?pick=1 URL still forces
    // the picker on the re-dispatch).
    it("?pick=1 → Create → naming → Back returns to the picker (no welcome-back bounce)", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "csrf-back2",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [{ name: "moss" }] });
      renderWelcome("/welcome?pick=1");
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /which vault today/i })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: /create a new vault/i }));
      await waitFor(() => expect(screen.getByText(/create ceremony/i)).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("test-go-back"));
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /which vault today/i })).toBeInTheDocument(),
      );
      expect(screen.queryByText(/create ceremony/i)).not.toBeInTheDocument();
      expect(openHostedVault).not.toHaveBeenCalled();
    });

    // §4.1 rule 2 — the picker stalls (a decision screen), so it carries the
    // WizardShell escape alongside the linked wordmark.
    it("renders the wizard chrome: linked wordmark + a quiet Back escape", async () => {
      renderWelcome();
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /which vault today/i })).toBeInTheDocument(),
      );
      expect(screen.getByRole("link", { name: /parachute/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^← back$/i })).toBeInTheDocument();
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
      // §4.4: the auto-open is a switch too — it announces after landing.
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain("Now in moss");
    });

    // NAVIGATION.md: "Welcome-back beat → /" — (d) the single post-auth
    // landing, replace. Unlike the picker/ready-open pushes, this beat is
    // auto-advancing (no button, no user decision to push for) — the
    // accepted-limit row names exactly this shape as the residual thin-stack
    // case the wizard-chrome escapes (W2-6), not history surgery, cover.
    it("REPLACEs (not pushes) — this is the deliberate, table-correct exception", async () => {
      const navLog: NavLogEntry[] = [];
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "csrf-3b",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [{ name: "moss" }] });
      renderWelcome("/welcome", navLog);
      await waitFor(() => expect(screen.getByText("Home surface")).toBeInTheDocument());
      expect(navLog.at(-1)).toEqual({ type: "REPLACE", pathname: "/" });
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

    it("falls through to the creation ceremony when the account has zero vaults", async () => {
      vi.mocked(getSession).mockResolvedValue({
        signed_in: true,
        csrf: "csrf-7",
        email: "ag@unforced.org",
      });
      vi.mocked(listVaults).mockResolvedValue({ vaults: [] });
      renderWelcome("/welcome?pick=1");
      await waitFor(() => expect(screen.getByText(/create ceremony/i)).toBeInTheDocument());
      expect(screen.getByText(/\?first=1/)).toBeInTheDocument();
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
      // §4.1 rule 2 — a stalling state carries the quiet escape.
      expect(screen.getByRole("button", { name: /^← back$/i })).toBeInTheDocument();

      vi.mocked(listVaults).mockResolvedValueOnce({ vaults: [] });
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      await waitFor(() => expect(screen.getByText(/create ceremony/i)).toBeInTheDocument());
    });
  });
});
