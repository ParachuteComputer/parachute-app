import { AddVaultChooser } from "@/app/routes/AddVaultChooser";
import { listVaults } from "@/lib/account/client";
import { saveLastSigninEmail } from "@/lib/account/store";
import type { AccountVaultsResponse } from "@/lib/account/types";
import { useVaultStore } from "@/lib/vault/store";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The in-app "add a vault" chooser (SYNTHESIS #10) — three explicit verbs,
// one meaning each. `listVaults` is mocked so the plan-slots foot line is
// deterministic and no real network call runs (matches Welcome.test.tsx's
// pattern for the same module).
vi.mock("@/lib/account/client", () => ({
  listVaults: vi.fn(),
}));

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
      </Routes>
    </MemoryRouter>,
  );
}

describe("AddVaultChooser", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    vi.mocked(listVaults).mockResolvedValue({ vaults: [] } satisfies AccountVaultsResponse);
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

  it("Open navigates to /welcome (the dispatcher shows the picker)", async () => {
    renderChooser();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(screen.getByTestId("location-echo")).toHaveTextContent("/welcome");
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

  it("shows the quiet plan-slots foot line once listVaults resolves it", async () => {
    vi.mocked(listVaults).mockResolvedValue({
      vaults: [],
      plan: { vault_limit: 3, vaults_used: 2 },
    });
    renderChooser();
    expect(await screen.findByText("2 of 3 plan slots used")).toBeInTheDocument();
  });

  it("stays quiet (no foot line) when the plan fetch fails or omits slot counts", async () => {
    vi.mocked(listVaults).mockRejectedValue(new Error("network down"));
    renderChooser();
    await waitFor(() => expect(listVaults).toHaveBeenCalled());
    expect(screen.queryByText(/plan slots used/i)).not.toBeInTheDocument();
  });
});
