import { Welcome } from "@/app/routes/Welcome";
import { useVaultStore } from "@/lib/vault/store";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function seed(name: string) {
  useVaultStore.setState({
    vaults: {
      v1: {
        id: "v1",
        url: "https://u.parachute.computer/vault/v1",
        name,
        issuer: "https://cloud.parachute.computer",
        clientId: "c",
        scope: "vault:read vault:write",
        addedAt: "2026-07-01T00:00:00.000Z",
        lastUsedAt: "2026-07-01T00:00:00.000Z",
      },
    },
    activeVaultId: "v1",
  });
}

function renderWelcome() {
  return render(
    <MemoryRouter initialEntries={["/welcome"]}>
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/" element={<div>Home surface</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Welcome (first-run vault naming)", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });
  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  it("redirects to the arrival when there is no connected vault", () => {
    renderWelcome();
    expect(screen.getByText("Home surface")).toBeInTheDocument();
  });

  it("starts empty for a machine-default vault name (a fresh account)", () => {
    seed("cloud.parachute.computer"); // host-like → treated as default
    renderWelcome();
    const field = screen.getByLabelText(/vault name/i) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(screen.getByText(/name your vault/i)).toBeInTheDocument();
  });

  it("pre-fills a vault that already carries a chosen name (returning user confirms)", () => {
    seed("gardening");
    renderWelcome();
    expect((screen.getByLabelText(/vault name/i) as HTMLInputElement).value).toBe("gardening");
  });

  it("names the vault and lands home (the delight now in the right place)", () => {
    seed("cloud.parachute.computer");
    renderWelcome();
    fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "moss" } });
    fireEvent.click(screen.getByRole("button", { name: /open my vault/i }));
    // The chosen name threads through the app via the vault record.
    expect(useVaultStore.getState().vaults.v1?.name).toBe("moss");
    expect(screen.getByText("Home surface")).toBeInTheDocument();
  });

  it("lets a user skip without changing the name", () => {
    seed("gardening");
    renderWelcome();
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(useVaultStore.getState().vaults.v1?.name).toBe("gardening");
    expect(screen.getByText("Home surface")).toBeInTheDocument();
  });
});
