import { Vaults } from "@/app/routes/Vaults";
import { HOSTED_CLIENT_ID } from "@/lib/account";
import { useVaultStore } from "@/lib/vault";
import type { VaultRecord } from "@/lib/vault/types";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The device vault list: BOTH provenance kinds appear here (Cloud home-door +
// Self-hosted /add), each with a chip; removal is honest ("from this device").

function vaultRecord(over: Partial<VaultRecord>): VaultRecord {
  return {
    id: "1",
    name: "moss",
    url: "https://u.parachute.computer/vault/moss",
    issuer: "https://app.parachute.computer",
    clientId: HOSTED_CLIENT_ID,
    scope: "vault:moss:read vault:moss:write",
    addedAt: "2026-07-10T00:00:00Z",
    lastUsedAt: "2026-07-10T00:00:00Z",
    ...over,
  };
}

function renderVaults() {
  return render(
    <MemoryRouter>
      <Vaults />
    </MemoryRouter>,
  );
}

beforeEach(() => useVaultStore.setState({ vaults: {}, activeVaultId: null }));
afterEach(() => useVaultStore.setState({ vaults: {}, activeVaultId: null }));

describe("Vaults — provenance chips + honest remove copy", () => {
  it("labels a home-door vault Cloud", () => {
    useVaultStore.setState({ vaults: { "1": vaultRecord({}) }, activeVaultId: "1" });
    renderVaults();
    expect(screen.getByText(/Cloud/)).toBeInTheDocument();
  });

  it("labels an OAuth vault Self-hosted · host (never a dev scope string)", () => {
    useVaultStore.setState({
      vaults: {
        "2": vaultRecord({
          id: "2",
          name: "boulder",
          clientId: "oauth-client-x",
          issuer: "https://hub.example.com",
          url: "https://hub.example.com/vault/boulder",
        }),
      },
      activeVaultId: "2",
    });
    renderVaults();
    const chip = screen.getByText(/Self-hosted/);
    expect(chip.textContent).toContain("hub.example.com");
    // the raw dev scope string is gone from the chip row
    expect(screen.queryByText("vault:boulder:read vault:boulder:write")).not.toBeInTheDocument();
  });

  it("uses honest 'Remove from this device' copy", () => {
    useVaultStore.setState({ vaults: { "1": vaultRecord({}) }, activeVaultId: "1" });
    renderVaults();
    expect(screen.getByRole("button", { name: /remove from this device/i })).toBeInTheDocument();
  });
});
