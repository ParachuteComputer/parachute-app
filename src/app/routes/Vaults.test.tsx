import { Vaults } from "@/app/routes/Vaults";
import { HOSTED_CLIENT_ID } from "@/lib/account";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault";
import type { VaultRecord } from "@/lib/vault/types";
import { fireEvent, render, screen } from "@testing-library/react";
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

beforeEach(() => {
  useVaultStore.setState({ vaults: {}, activeVaultId: null });
  useToastStore.setState({ toasts: [] });
});
afterEach(() => {
  useVaultStore.setState({ vaults: {}, activeVaultId: null });
  useToastStore.setState({ toasts: [] });
});

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

// §4.4 switch-confirmation (WALK-manager #2) — Make active is a switch path,
// so it announces "Now in {vault}" like every other one.
describe("Vaults — Make active confirms the switch", () => {
  it("switches the active vault and toasts 'Now in {vault}'", () => {
    useVaultStore.setState({
      vaults: {
        "1": vaultRecord({}),
        "2": vaultRecord({
          id: "2",
          name: "fieldnotes",
          url: "https://u.parachute.computer/vault/fieldnotes",
        }),
      },
      activeVaultId: "1",
    });
    renderVaults();
    fireEvent.click(screen.getByRole("button", { name: /make active/i }));
    expect(useVaultStore.getState().activeVaultId).toBe("2");
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain("Now in fieldnotes");
  });
});

// F2 — "Add vault" used to point at /add (the self-hosted connect URL form, a
// dead-end for a cloud user with no path to "create"). Both entries now open
// the purpose-built Open/Create/Connect chooser instead.
describe("Vaults — 'Add vault' opens the chooser (F2)", () => {
  it("the header button links to /add-vault, not /add", () => {
    useVaultStore.setState({ vaults: { "1": vaultRecord({}) }, activeVaultId: "1" });
    renderVaults();
    expect(screen.getByRole("link", { name: /^add vault$/i })).toHaveAttribute(
      "href",
      "/add-vault",
    );
  });

  it("the empty-state button also links to /add-vault (both the header and empty-state CTAs)", () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    renderVaults();
    const links = screen.getAllByRole("link", { name: /^add vault$/i });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/add-vault");
    }
  });
});
