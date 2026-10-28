import { Settings } from "@/app/routes/Settings";
import { Toaster } from "@/components/Toaster";
import { __resetDoorDescriptorCacheForTests } from "@/lib/account/descriptor";
import { HOSTED_CLIENT_ID } from "@/lib/account/hosted-vault";
import { useAccountSessionStore } from "@/lib/account/store";
import type { MirrorSlice } from "@/lib/mirror/types";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-318 "Delete this vault", exercised through the REAL Settings screen, the
// REAL account client and the REAL vault store: only the network is faked.
// Settings' Offline section reads the sync provider, which needs IndexedDB
// plumbing this test doesn't care about — stub it OFF as Settings.test does.
vi.mock("@/providers/SyncProvider", () => ({
  useSync: () => ({
    db: null,
    mirror: {
      enabled: false,
      state: "off",
      lastSyncedAt: null,
      syncNow: async () => {},
      clearOffline: async () => {},
    } as MirrorSlice,
  }),
}));

const ACCOUNT_TOKEN_KEY = "lens:account_token";
const EMAIL = "person@example.com";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let descriptor: Record<string, unknown>;
let deleteHandler: (init: RequestInit | undefined) => Response;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function door(): typeof fetch {
  fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path === "/.well-known/parachute-account") return json(descriptor);
    if (path === "/account/session") return json({ signed_in: true, csrf: "csrf-1", email: EMAIL });
    if (path === "/account/token" && method === "POST") return json({ token: "acct-tok" });
    if (path === "/account/vaults/moss" && method === "DELETE") return deleteHandler(init);
    return json({ error: "unexpected", path }, 500);
  });
  return fetchMock;
}

function hostedVault(over: Partial<VaultRecord> = {}): VaultRecord {
  return {
    id: "moss-id",
    url: "https://vault.example.com/vault/moss",
    name: "moss",
    issuer: window.location.origin,
    clientId: HOSTED_CLIENT_ID,
    scope: "vault:moss:read vault:moss:write",
    addedAt: "2026-10-01T00:00:00.000Z",
    lastUsedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

function seed(...records: VaultRecord[]) {
  useVaultStore.setState({
    vaults: Object.fromEntries(records.map((r) => [r.id, r])),
    activeVaultId: records[0]?.id ?? null,
  });
}

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/settings" element={<Settings />} />
          <Route path="/vaults" element={<div>Vaults surface</div>} />
          <Route path="/export" element={<div>Export surface</div>} />
          <Route path="/" element={<div>Home surface</div>} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>,
  );
}

function descriptorRead(): boolean {
  return fetchMock.mock.calls.some(([p]) => String(p) === "/.well-known/parachute-account");
}

function deleteCalls() {
  return fetchMock.mock.calls.filter(([p]) => String(p).startsWith("/account/vaults/"));
}

async function openSection() {
  renderSettings();
  return screen.findByRole("region", { name: "Delete this vault" });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  __resetDoorDescriptorCacheForTests();
  sessionStorage.setItem(ACCOUNT_TOKEN_KEY, JSON.stringify({ token: "acct-tok", identity: EMAIL }));
  useAccountSessionStore.setState({ expired: false, gate: null, identityEpoch: 0 });
  useToastStore.getState().clear();
  descriptor = {
    door: "cloud",
    auth: { methods: ["magic_link"], signin_path: "/login" },
    capabilities: { vault_create: true, vault_delete: true, account_delete: true },
  };
  deleteHandler = () => json({ destroyed: true, r2_objects_deleted: 12, d1: { notes: 40 } });
  vi.stubGlobal("fetch", door());
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetDoorDescriptorCacheForTests();
  useVaultStore.setState({ vaults: {}, activeVaultId: null });
  useToastStore.getState().clear();
  localStorage.clear();
  sessionStorage.clear();
});

describe("Delete this vault — gate", () => {
  it("is shown for a hosted vault when the door advertises vault_delete", async () => {
    seed(hostedVault());
    const section = await openSection();
    expect(within(section).getByRole("heading", { name: "Delete this vault" })).toBeInTheDocument();
    expect(section).toHaveTextContent(
      "This deletes the vault moss now: every note, file, snapshot and export in it. It is immediate and permanent, and there is no undo. Export first if you want a copy.",
    );
    fireEvent.click(within(section).getByRole("link", { name: "Export first" }));
    expect(await screen.findByText("Export surface")).toBeInTheDocument();
  });

  it("is hidden for a hosted vault when the door doesn't advertise vault_delete", async () => {
    descriptor = { ...descriptor, capabilities: { vault_create: true, account_delete: true } };
    seed(hostedVault());
    renderSettings();
    await waitFor(() => expect(descriptorRead()).toBe(true));
    await screen.findByRole("heading", { name: "Settings" });
    // Let the descriptor answer land before asserting absence.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("heading", { name: "Delete this vault" })).not.toBeInTheDocument();
  });

  it("is hidden for a self-hosted (OAuth) vault, without even reading the descriptor", async () => {
    seed(
      hostedVault({
        clientId: "client-oauth",
        issuer: "https://hub.example.com",
        url: "https://hub.example.com/vault/moss",
      }),
    );
    renderSettings();
    await screen.findByRole("heading", { name: "Settings" });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("heading", { name: "Delete this vault" })).not.toBeInTheDocument();
    expect(descriptorRead()).toBe(false);
  });
});

describe("Delete this vault — confirmation and outcome", () => {
  it("keeps the button disabled until the vault name is typed exactly", async () => {
    seed(hostedVault());
    const section = await openSection();
    const input = within(section).getByLabelText("Type the vault name to confirm");
    const button = within(section).getByRole("button", { name: "Delete vault" });
    expect(button).toBeDisabled();
    for (const wrong of ["mos", "Moss", "moss ", "mosses"]) {
      fireEvent.change(input, { target: { value: wrong } });
      expect(button).toBeDisabled();
    }
    fireEvent.change(input, { target: { value: "moss" } });
    expect(button).toBeEnabled();
  });

  it("success: DELETEs with the account bearer, forgets the vault, lands on Vaults with a confirmation", async () => {
    // The ONLY vault on the device — the case where Settings' own no-active-
    // vault redirect would otherwise race the move to the Vaults list.
    seed(hostedVault());
    const section = await openSection();
    fireEvent.change(within(section).getByLabelText("Type the vault name to confirm"), {
      target: { value: "moss" },
    });
    await act(async () => {
      fireEvent.click(within(section).getByRole("button", { name: "Delete vault" }));
    });

    expect(await screen.findByText("Vaults surface")).toBeInTheDocument();
    expect(await screen.findByText("Vault moss deleted.")).toBeInTheDocument();
    expect(useVaultStore.getState().vaults["moss-id"]).toBeUndefined();
    expect(useVaultStore.getState().activeVaultId).toBeNull();

    expect(deleteCalls()).toHaveLength(1);
    const [path, init] = deleteCalls()[0]!;
    expect(String(path)).toBe("/account/vaults/moss");
    expect(init?.method).toBe("DELETE");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer acct-tok");
    expect(JSON.parse(init?.body as string)).toEqual({ confirm: "moss" });
  });

  it("error: shows the door's message and keeps the vault", async () => {
    deleteHandler = () =>
      json(
        {
          error: "d1_cleanup_failed",
          message: "The vault's files are gone but cleanup didn't finish. Try again.",
        },
        500,
      );
    seed(hostedVault());
    const section = await openSection();
    fireEvent.change(within(section).getByLabelText("Type the vault name to confirm"), {
      target: { value: "moss" },
    });
    await act(async () => {
      fireEvent.click(within(section).getByRole("button", { name: "Delete vault" }));
    });

    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "The vault's files are gone but cleanup didn't finish. Try again.",
    );
    expect(screen.queryByText("Vaults surface")).not.toBeInTheDocument();
    expect(useVaultStore.getState().vaults["moss-id"]).toBeDefined();
  });
});
