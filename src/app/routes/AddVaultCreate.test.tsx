import { AddVaultCreate, AddVaultReady } from "@/app/routes/AddVaultCreate";
import { getDoorDescriptor } from "@/lib/account/descriptor";
import { createHostedVault, openHostedVault } from "@/lib/account/hosted-vault";
import { saveLastSigninEmail } from "@/lib/account/store";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { type NavLogEntry, NavTypeLog } from "@/test/nav-probe";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The creation ceremony's stepped URLs (W2-6, DESIGN-SPEC §4.2): naming +
// the in-shell creating beat at /add-vault/create, the ready beat at
// /add-vault/ready?vault=<name>. The activation-honesty contract rides these
// tests: creating MINTS ONLY (no active-vault change, no toast); "Open
// {name} →" is where the switch actually happens.

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

// Defaults to null (no descriptor / no template) — the naming echo's
// documented fallback.
vi.mock("@/lib/account/descriptor", () => ({
  getDoorDescriptor: vi.fn().mockResolvedValue(null),
  peekDoorDescriptor: vi.fn().mockReturnValue(null),
  retryDoorDescriptorIfCold: vi.fn(),
}));

function LocationEcho({ label }: { label: string }) {
  const location = useLocation();
  return (
    <div>
      {label}
      {location.search}
    </div>
  );
}

function renderCeremony(initial: string, navLog?: NavLogEntry[]) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      {navLog ? <NavTypeLog log={navLog} /> : null}
      <Routes>
        <Route path="/add-vault/create" element={<AddVaultCreate />} />
        <Route path="/add-vault/ready" element={<AddVaultReady />} />
        <Route path="/add-vault" element={<div>Add-vault chooser</div>} />
        <Route path="/" element={<LocationEcho label="Home surface" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const MOSS_RECORD = {
  id: "moss-id",
  url: "https://u.parachute.computer/vault/moss",
  name: "moss",
  issuer: "https://cloud.parachute.computer",
  clientId: "home-door",
  scope: "vault:moss:read vault:moss:write",
  addedAt: "2026-07-01T00:00:00.000Z",
  lastUsedAt: "2026-07-01T00:00:00.000Z",
};

describe("AddVaultCreate (naming + the in-shell creating beat)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(createHostedVault).mockReset().mockResolvedValue("moss");
    vi.mocked(openHostedVault).mockReset().mockResolvedValue("v1");
    vi.mocked(getDoorDescriptor).mockReset().mockResolvedValue(null);
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    // Unmount BEFORE resetting the store (inner afterEach runs before
    // testing-library's auto-cleanup) so the reset never notifies a
    // still-mounted subscriber outside act().
    cleanup();
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("renders the add-vault copy, the signed-in chip, and the live name echo + button label", async () => {
    saveLastSigninEmail("ag@unforced.org");
    useVaultStore.setState({ vaults: { "moss-id": MOSS_RECORD }, activeVaultId: "moss-id" });
    renderCeremony("/add-vault/create");
    expect(screen.getByText(/adding a vault/i)).toBeInTheDocument();
    expect(screen.getByText(/let's make your new/i)).toBeInTheDocument();
    // The "separate from X" referent is the ACTIVE vault on this device.
    expect(screen.getByText(/separate from/i)).toBeInTheDocument();
    expect(screen.getByText("moss")).toBeInTheDocument();
    expect(screen.getByText(/signed in as ag@unforced\.org/i)).toBeInTheDocument();

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

  it("?first=1 renders the onboarding copy (account created, first vault)", () => {
    renderCeremony("/add-vault/create?first=1");
    expect(screen.getByText(/account created/i)).toBeInTheDocument();
    expect(screen.getByText(/let's make your first/i)).toBeInTheDocument();
    expect(screen.queryByText(/separate from/i)).not.toBeInTheDocument();
  });

  // HUB-PARITY P4: once a door advertises `vault_url_template`, the naming
  // echo substitutes the typed name into it — preview-only (the real,
  // post-creation address still comes from create/list responses).
  it("echoes the real address from vault_url_template when the door advertises one", async () => {
    vi.mocked(getDoorDescriptor).mockResolvedValue({
      vault_url_template: "https://hub.example/vault/{name}",
    });
    renderCeremony("/add-vault/create");
    fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "moss" } });
    await waitFor(() =>
      expect(screen.getByText("https://hub.example/vault/moss")).toBeInTheDocument(),
    );
  });

  it("has NO skip affordance and NO 'change it later' copy (the name is the immutable slug)", () => {
    renderCeremony("/add-vault/create");
    expect(screen.queryByText(/skip/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/change it later/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/change later/i)).not.toBeInTheDocument();
  });

  // §4.1 rules 1–3: wordmark-link + escape + the 3-segment progress bar
  // (Name · Making it · Ready) — the creation ceremony is the ONLY bar-holder.
  it("renders the wizard chrome: linked wordmark, Back escape, 3-segment progress at 'Name'", () => {
    renderCeremony("/add-vault/create");
    expect(screen.getByRole("link", { name: /parachute/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^← back$/i })).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Making it")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    const current = document.querySelector('[aria-current="step"]');
    expect(current?.textContent).toBe("Name");
  });

  it("the Back escape falls back to the chooser (add-vault ctx)", async () => {
    renderCeremony("/add-vault/create");
    fireEvent.click(screen.getByRole("button", { name: /^← back$/i }));
    await waitFor(() => expect(screen.getByText("Add-vault chooser")).toBeInTheDocument());
  });

  it("the Back escape falls back to / in first-run onboarding (no chooser exists yet)", async () => {
    renderCeremony("/add-vault/create?first=1");
    fireEvent.click(screen.getByRole("button", { name: /^← back$/i }));
    await waitFor(() => expect(screen.getByText(/home surface/i)).toBeInTheDocument());
  });

  describe("submit → the creating beat (same URL — a process, not a place)", () => {
    it("shows the calm creating tick at 'Making it', with NO escape (auto-advancing beat)", async () => {
      // Hold the create in flight so the beat is observable.
      let release: (v: string) => void = () => {};
      vi.mocked(createHostedVault).mockImplementation(
        () =>
          new Promise<string>((r) => {
            release = r;
          }),
      );
      renderCeremony("/add-vault/create");
      fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "moss" } });
      fireEvent.click(screen.getByRole("button", { name: /create moss →/i }));

      await waitFor(() =>
        expect(
          screen.getByRole("heading", { name: /making a place for moss/i }),
        ).toBeInTheDocument(),
      );
      // The ticking status copy (no spinner — §4.1 rule 4).
      expect(screen.getByText(/setting up your vault…/i)).toBeInTheDocument();
      // §4.1 rule 2: escape "none" is legal here — and only here.
      expect(screen.queryByRole("button", { name: /back/i })).not.toBeInTheDocument();
      // Progress advanced to the middle segment.
      expect(document.querySelector('[aria-current="step"]')?.textContent).toBe("Making it");
      // The wordmark-link stays (rule 1).
      expect(screen.getByRole("link", { name: /parachute/i })).toBeInTheDocument();
      // Release the held create and let the beat finish (also keeps the
      // resolution inside the test — no act() stragglers).
      release("moss");
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /moss is ready/i })).toBeInTheDocument(),
      );
    });

    it("success REPLACEs to /add-vault/ready?vault=<canonical name> (NAVIGATION.md: consumes the form)", async () => {
      const navLog: NavLogEntry[] = [];
      // The door echoes its canonical name — the ready URL must carry IT.
      vi.mocked(createHostedVault).mockResolvedValue("moss");
      renderCeremony("/add-vault/create", navLog);
      fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "moss" } });
      fireEvent.click(screen.getByRole("button", { name: /create moss →/i }));

      await waitFor(() => expect(createHostedVault).toHaveBeenCalledWith("moss"));
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /moss is ready/i })).toBeInTheDocument(),
      );
      expect(navLog.at(-1)).toEqual({ type: "REPLACE", pathname: "/add-vault/ready?vault=moss" });
    });

    it("?first=1 rides through to the ready beat (onboarding keeps its shape)", async () => {
      const navLog: NavLogEntry[] = [];
      renderCeremony("/add-vault/create?first=1", navLog);
      fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "moss" } });
      fireEvent.click(screen.getByRole("button", { name: /create moss →/i }));
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /moss is ready/i })).toBeInTheDocument(),
      );
      expect(navLog.at(-1)).toEqual({
        type: "REPLACE",
        pathname: "/add-vault/ready?vault=moss&first=1",
      });
    });

    // THE CORRECTNESS FIX (WALK-manager #2 / §4.2): creating no longer
    // switches the active vault — the rail identity, and every page behind,
    // stay truthful until the person explicitly opens the new vault.
    it("creating MINTS ONLY: the active vault is unchanged and nothing toasts", async () => {
      useVaultStore.setState({ vaults: { "moss-id": MOSS_RECORD }, activeVaultId: "moss-id" });
      renderCeremony("/add-vault/create");
      fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "fieldnotes" } });
      vi.mocked(createHostedVault).mockResolvedValue("fieldnotes");
      fireEvent.click(screen.getByRole("button", { name: /create fieldnotes →/i }));
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /fieldnotes is ready/i })).toBeInTheDocument(),
      );
      // No switch, no activation, no announcement — mints only.
      expect(useVaultStore.getState().activeVaultId).toBe("moss-id");
      expect(openHostedVault).not.toHaveBeenCalled();
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });
  });

  describe("a creation failure — friendly copy (F12), form preserved, escape intact (F6)", () => {
    it("maps a bare wire code to human copy instead of showing it raw", async () => {
      vi.mocked(createHostedVault).mockRejectedValue(new Error("vault_limit_reached"));
      renderCeremony("/add-vault/create");
      fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "moss" } });
      fireEvent.click(screen.getByRole("button", { name: /create moss →/i }));

      await waitFor(() =>
        expect(screen.getByText(/reached your plan's vault limit/i)).toBeInTheDocument(),
      );
      expect(screen.queryByText("vault_limit_reached")).not.toBeInTheDocument();
    });

    it("returns to the SAME naming form (typed name preserved), Back still bails to the chooser", async () => {
      vi.mocked(createHostedVault).mockRejectedValue(new Error("vault_taken"));
      renderCeremony("/add-vault/create");
      fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "moss" } });
      fireEvent.click(screen.getByRole("button", { name: /create moss →/i }));

      await waitFor(() => expect(screen.getByText(/already taken/i)).toBeInTheDocument());
      // Still the naming form, same URL, typed name intact.
      expect((screen.getByLabelText(/vault name/i) as HTMLInputElement).value).toBe("moss");
      fireEvent.click(screen.getByRole("button", { name: /^← back$/i }));
      await waitFor(() => expect(screen.getByText("Add-vault chooser")).toBeInTheDocument());
    });

    it("a failed name can be edited and resubmitted (the retry actually re-fires)", async () => {
      vi.mocked(createHostedVault)
        .mockRejectedValueOnce(new Error("vault_taken"))
        .mockResolvedValueOnce("moss2");
      renderCeremony("/add-vault/create");
      fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "moss" } });
      fireEvent.click(screen.getByRole("button", { name: /create moss →/i }));
      await waitFor(() => expect(screen.getByText(/already taken/i)).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "moss2" } });
      fireEvent.click(screen.getByRole("button", { name: /create moss2 →/i }));
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /moss2 is ready/i })).toBeInTheDocument(),
      );
      expect(createHostedVault).toHaveBeenLastCalledWith("moss2");
    });
  });
});

describe("AddVaultReady (the ready beat — where activation actually happens)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(createHostedVault).mockReset().mockResolvedValue("moss");
    vi.mocked(openHostedVault).mockReset().mockResolvedValue("v1");
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("renders the ready copy, 'Open {name} →', 'Maybe later', and the progress bar at 'Ready'", () => {
    renderCeremony("/add-vault/ready?vault=moss");
    expect(screen.getByRole("heading", { name: /moss is ready/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open moss →/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /maybe later/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /parachute/i })).toBeInTheDocument();
    expect(document.querySelector('[aria-current="step"]')?.textContent).toBe("Ready");
  });

  it("?first=1 hides 'Maybe later' (no prior vault worth staying in — §4.2)", () => {
    renderCeremony("/add-vault/ready?vault=moss&first=1");
    expect(screen.getByRole("button", { name: /open moss →/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /maybe later/i })).not.toBeInTheDocument();
  });

  it("'Open {name} →' NOW activates: openHostedVault + 'Now in {name}' toast + PUSH to /", async () => {
    const navLog: NavLogEntry[] = [];
    renderCeremony("/add-vault/ready?vault=moss", navLog);
    expect(useToastStore.getState().toasts).toHaveLength(0); // nothing before Open
    fireEvent.click(screen.getByRole("button", { name: /open moss →/i }));
    await waitFor(() => expect(openHostedVault).toHaveBeenCalledWith("moss"));
    await waitFor(() => expect(screen.getByText(/home surface/i)).toBeInTheDocument());
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain("Now in moss");
    // NAVIGATION.md: "Ready 'Open {name} →' → /" — user-initiated, push.
    expect(navLog.at(-1)).toEqual({ type: "PUSH", pathname: "/" });
  });

  it("an Open failure shows friendly copy inline — no toast, no navigation", async () => {
    vi.mocked(openHostedVault).mockRejectedValue(new Error("invalid_scope"));
    renderCeremony("/add-vault/ready?vault=moss");
    fireEvent.click(screen.getByRole("button", { name: /open moss →/i }));
    await waitFor(() => expect(screen.getByText(/couldn't open that vault/i)).toBeInTheDocument());
    expect(screen.queryByText("invalid_scope")).not.toBeInTheDocument();
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(screen.getByRole("heading", { name: /moss is ready/i })).toBeInTheDocument();
  });

  it("'Maybe later' leaves the active vault untouched — no switch, no toast (§4.2)", async () => {
    useVaultStore.setState({ vaults: { "moss-id": MOSS_RECORD }, activeVaultId: "moss-id" });
    renderCeremony("/add-vault/ready?vault=fieldnotes");
    fireEvent.click(screen.getByRole("button", { name: /maybe later/i }));
    // History-aware escape: MemoryRouter leaves window.history untouched, so
    // this exercises the "/" fallback (the deep-link case).
    await waitFor(() => expect(screen.getByText(/home surface/i)).toBeInTheDocument());
    expect(openHostedVault).not.toHaveBeenCalled();
    expect(useVaultStore.getState().activeVaultId).toBe("moss-id");
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("a ready URL without ?vault= shims to the chooser (nothing honest to offer)", async () => {
    renderCeremony("/add-vault/ready");
    await waitFor(() => expect(screen.getByText("Add-vault chooser")).toBeInTheDocument());
  });
});
