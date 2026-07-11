import { AddVaultChooser } from "@/app/routes/AddVaultChooser";
import { saveLastSigninEmail } from "@/lib/account/store";
import { useVaultStore } from "@/lib/vault/store";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The in-app "add a vault" chooser (SYNTHESIS #10) — three explicit verbs, one
// meaning each. It makes no network call: the plan/usage summary needed for the
// "N of M plan slots used" foot line is a future account-manager endpoint
// (cloud's GET /account/vaults returns only the vault list), seamed off for now.

function LocationEcho() {
  const location = useLocation();
  return <div data-testid="location-echo">{location.pathname + location.search}</div>;
}

function renderChooser() {
  return render(
    <MemoryRouter initialEntries={["/add-vault"]}>
      <Routes>
        <Route
          path="/add-vault"
          element={
            <>
              <AddVaultChooser />
              <LocationEcho />
            </>
          }
        />
        <Route path="/welcome" element={<LocationEcho />} />
        <Route path="/add" element={<LocationEcho />} />
        <Route path="/vaults" element={<LocationEcho />} />
        <Route path="/" element={<LocationEcho />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AddVaultChooser", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  afterEach(() => {
    // Unmount BEFORE resetting the store: this describe's `afterEach` runs
    // before testing-library's own auto-registered cleanup (inner hooks run
    // before outer/root ones), so resetting `useVaultStore` first would
    // notify a still-mounted subscriber outside of `act()`.
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("renders the signed-in chip and the three verbs", async () => {
    saveLastSigninEmail("ag@unforced.org");
    renderChooser();

    expect(screen.getByText(/signed in as ag@unforced\.org/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("Open navigates to /welcome?pick=1 — forces the picker even with one vault (F13)", async () => {
    renderChooser();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(screen.getByTestId("location-echo")).toHaveTextContent("/welcome?pick=1");
    });
  });

  it("Create navigates to /welcome?new=1 (the add-vault naming variant)", async () => {
    renderChooser();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByTestId("location-echo")).toHaveTextContent("/welcome?new=1");
    });
  });

  it("Connect navigates to /add (the self-hosted connect)", async () => {
    renderChooser();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => {
      expect(screen.getByTestId("location-echo")).toHaveTextContent("/add");
    });
  });

  it("omits the 'separate from X' tail when there's no active vault on this device", async () => {
    renderChooser();
    expect(screen.getByText(/brand-new and empty/i)).toBeInTheDocument();
    expect(screen.queryByText(/separate from/i)).not.toBeInTheDocument();
  });

  it("names the active vault in the Create card's description when one exists", async () => {
    useVaultStore.setState({
      vaults: {
        moss: {
          id: "moss",
          url: "https://u.parachute.computer/vault/moss",
          name: "moss",
          issuer: "https://cloud.parachute.computer",
          clientId: "cloud-account",
          scope: "vault:read vault:write",
          addedAt: "2026-07-01T00:00:00.000Z",
          lastUsedAt: "2026-07-01T00:00:00.000Z",
        },
      },
      activeVaultId: "moss",
    });
    renderChooser();
    expect(screen.getByText(/separate from/i)).toBeInTheDocument();
    expect(screen.getByText("moss")).toBeInTheDocument();
  });

  it("shows no plan-slots foot line (cloud has no plan-summary endpoint yet)", () => {
    renderChooser();
    expect(screen.queryByText(/plan slots used/i)).not.toBeInTheDocument();
  });

  // F6 — the chooser otherwise has zero exits (no active vault means no Rail/
  // Header chrome either); the Back link is the escape hatch.
  describe("Back link (F6)", () => {
    it("points at /vaults when a vault is already active on this device", async () => {
      useVaultStore.setState({
        vaults: {
          moss: {
            id: "moss",
            url: "https://u.parachute.computer/vault/moss",
            name: "moss",
            issuer: "https://cloud.parachute.computer",
            clientId: "cloud-account",
            scope: "vault:read vault:write",
            addedAt: "2026-07-01T00:00:00.000Z",
            lastUsedAt: "2026-07-01T00:00:00.000Z",
          },
        },
        activeVaultId: "moss",
      });
      renderChooser();
      fireEvent.click(screen.getByRole("link", { name: /back/i }));
      await waitFor(() => {
        expect(screen.getByTestId("location-echo")).toHaveTextContent("/vaults");
      });
    });

    it("points at / when there's no active vault on this device", async () => {
      renderChooser();
      fireEvent.click(screen.getByRole("link", { name: /back/i }));
      await waitFor(() => {
        expect(screen.getByTestId("location-echo")).toHaveTextContent("/");
      });
    });
  });
});
