import { AddVaultChooser } from "@/app/routes/AddVaultChooser";
import { AddVaultCreate, AddVaultReady } from "@/app/routes/AddVaultCreate";
import { getDoorDescriptor } from "@/lib/account/descriptor";
import { createHostedVault, openHostedVault } from "@/lib/account/hosted-vault";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE HISTORY-SHAPE TEST (W2-6 "done when"): the creation ceremony's stepped
// URLs must make browser Back honest — WALK-manager's desktop-33 repro
// ("after Back from ready, the page behind shows stale context because the
// active vault silently switched mid-creating") must be dead. Driven through
// a REAL <BrowserRouter> so react-router's window.history.state.idx behaves
// exactly as in the app (a MemoryRouter keeps a separate stack — see
// src/lib/nav/history.test.tsx).

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

vi.mock("@/lib/account/descriptor", () => ({
  getDoorDescriptor: vi.fn().mockResolvedValue(null),
}));

// A browser-Back stand-in: navigate(-1) drives the same POP the OS/browser
// Back button would.
function GoBack() {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="test-go-back" onClick={() => navigate(-1)}>
      go-back
    </button>
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

function renderCeremonyApp() {
  return render(
    <BrowserRouter>
      <GoBack />
      <Routes>
        <Route path="/add-vault" element={<AddVaultChooser />} />
        <Route path="/add-vault/create" element={<AddVaultCreate />} />
        <Route path="/add-vault/ready" element={<AddVaultReady />} />
        <Route path="/vaults" element={<div>Vaults page</div>} />
        <Route path="/" element={<div>Home surface</div>} />
      </Routes>
    </BrowserRouter>,
  );
}

describe("creation-ceremony history shape (§4.2 — desktop-33 must be dead)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(createHostedVault).mockReset().mockResolvedValue("fieldnotes");
    vi.mocked(openHostedVault).mockReset().mockResolvedValue("v-new");
    vi.mocked(getDoorDescriptor).mockReset().mockResolvedValue(null);
    useVaultStore.setState({ vaults: { "moss-id": MOSS_RECORD }, activeVaultId: "moss-id" });
    useToastStore.setState({ toasts: [] });
    // Reset the shared window.history so BrowserRouter re-initialises at
    // idx 0 on the chooser.
    window.history.replaceState(null, "", "/add-vault");
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  async function driveToReady() {
    renderCeremonyApp();
    // Chooser → Create (push).
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.getByText(/adding a vault/i)).toBeInTheDocument());
    // Name it → creating (same URL) → ready (replace).
    fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "fieldnotes" } });
    fireEvent.click(screen.getByRole("button", { name: /create fieldnotes →/i }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /fieldnotes is ready/i })).toBeInTheDocument(),
    );
    expect(window.location.pathname).toBe("/add-vault/ready");
  }

  it("Back from the NAMING form lands on the chooser (push chain)", async () => {
    renderCeremonyApp();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.getByText(/adding a vault/i)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("test-go-back"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /bring another/i })).toBeInTheDocument(),
    );
    expect(window.location.pathname).toBe("/add-vault");
  });

  it("Back from the READY beat lands on the chooser — the replace consumed the naming form", async () => {
    await driveToReady();
    fireEvent.click(screen.getByTestId("test-go-back"));
    // NOT the naming form (you can't Back into re-creating a vault that now
    // exists), NOT a stale page — the chooser.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /bring another/i })).toBeInTheDocument(),
    );
    expect(window.location.pathname).toBe("/add-vault");
    expect(screen.queryByLabelText(/vault name/i)).not.toBeInTheDocument();
  });

  it("Back from the READY beat is BENIGN: the active vault never switched (desktop-33 dead)", async () => {
    await driveToReady();
    // The desktop-33 bug: by "ready", createHostedVault had already activated
    // the new vault, so Back landed on pages showing stale context. Now the
    // create mints only — moss is still the active vault…
    expect(useVaultStore.getState().activeVaultId).toBe("moss-id");
    expect(openHostedVault).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("test-go-back"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /bring another/i })).toBeInTheDocument(),
    );
    // …and still is after Back: every page behind the ceremony reads true.
    expect(useVaultStore.getState().activeVaultId).toBe("moss-id");
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("'Maybe later' from ready = the history-aware escape: back to the chooser, no switch, no toast", async () => {
    await driveToReady();
    fireEvent.click(screen.getByRole("button", { name: /maybe later/i }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /bring another/i })).toBeInTheDocument(),
    );
    expect(useVaultStore.getState().activeVaultId).toBe("moss-id");
    expect(openHostedVault).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("'Open {name} →' from ready activates, toasts, and PUSHes Home", async () => {
    await driveToReady();
    fireEvent.click(screen.getByRole("button", { name: /open fieldnotes →/i }));
    await waitFor(() => expect(screen.getByText("Home surface")).toBeInTheDocument());
    expect(openHostedVault).toHaveBeenCalledWith("fieldnotes");
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain("Now in fieldnotes");
    // A push, not a replace: Back from Home returns to the ready beat.
    fireEvent.click(screen.getByTestId("test-go-back"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /fieldnotes is ready/i })).toBeInTheDocument(),
    );
  });

  it("the naming form's '← Back' escape walks real history to the chooser", async () => {
    renderCeremonyApp();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.getByText(/adding a vault/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^← back$/i }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /bring another/i })).toBeInTheDocument(),
    );
    // History-aware: it went BACK (idx>0), it didn't push the fallback on top
    // — so Back-from-chooser now leaves the ceremony instead of looping.
    expect(window.location.pathname).toBe("/add-vault");
  });
});
