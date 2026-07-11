import { Home } from "@/app/routes/Home";
import { HOSTED_CLIENT_ID } from "@/lib/account/hosted-vault";
import { loadChecklistState } from "@/lib/home/checklist";
import { __resetInstallAffordanceForTests } from "@/lib/pwa-install";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  id: string;
  path: string;
  createdAt: string;
  updatedAt?: string;
  tags?: string[];
  preview?: string;
}

function installFetch(notes: Row[]) {
  const impl = vi.fn<typeof fetch>(async () => {
    return { ok: true, status: 200, json: async () => notes, text: async () => "" } as Response;
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

function seedStore() {
  useVaultStore.setState({
    vaults: {
      v1: {
        id: "v1",
        url: "http://localhost:1940",
        name: "default",
        issuer: "http://localhost:1940",
        clientId: "c",
        scope: "full",
        addedAt: "2026-07-01T00:00:00.000Z",
        lastUsedAt: "2026-07-01T00:00:00.000Z",
      },
    },
    activeVaultId: "v1",
  });
  localStorage.setItem(
    "lens:token:v1",
    JSON.stringify({ accessToken: "t", scope: "full", vault: "default" }),
  );
}

function LocationSpy() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <MemoryRouter initialEntries={["/"]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/" element={children} />
          <Route path="/all" element={<LocationSpy />} />
          <Route path="/new" element={<LocationSpy />} />
          <Route path="/connect" element={<LocationSpy />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const SEED_ONLY: Row[] = [
  {
    id: "g1",
    path: "Welcome to your vault 🪂",
    tags: ["guide"],
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-01T09:00:00.000Z",
  },
];

const WITH_USER_NOTE: Row[] = [
  ...SEED_ONLY,
  {
    id: "u1",
    path: "My first thought",
    preview: "Something I wrote.",
    tags: ["capture"],
    createdAt: "2026-07-02T09:00:00.000Z",
    updatedAt: "2026-07-02T09:00:00.000Z",
  },
];

describe("Home — the warm front door", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetInstallAffordanceForTests();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
  });
  afterEach(() => {
    __resetInstallAffordanceForTests();
    vi.unstubAllGlobals();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  it("leads with the vault name as the serif masthead (identity everywhere)", async () => {
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <Home />
      </Wrap>,
    );
    // The H1 is the vault name — not "Home", not "Welcome". The name is the
    // identity threaded through the whole app.
    expect(await screen.findByRole("heading", { level: 1, name: "default" })).toBeInTheDocument();
    expect(screen.getByText(/everything here is yours/i)).toBeInTheDocument();
  });

  it("offers a focused composer that opens the real /new flow", async () => {
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <Home />
      </Wrap>,
    );
    const composer = await screen.findByRole("link", { name: /write a note/i });
    expect(within(composer).getByText(/what's on your mind\?/i)).toBeInTheDocument();
    expect(within(composer).getByText(/autosaves to default/i)).toBeInTheDocument();
    fireEvent.click(composer);
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/new"));
  });

  it("shows warm quick doors + a setup nudge for a fresh vault", async () => {
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <Home />
      </Wrap>,
    );
    await screen.findByRole("heading", { level: 1, name: "default" });
    // Fresh mode is gated on notes settling — await the quick doors appearing.
    const quickNav = await screen.findByRole("navigation", { name: /quick actions/i });
    expect(within(quickNav).getByText(/connect your ai/i)).toBeInTheDocument();
    expect(within(quickNav).getByText(/bring your notes over/i)).toBeInTheDocument();
    // The single quiet sun nudge (not a wall of checkboxes).
    expect(screen.getByText(/finish setting up/i)).toBeInTheDocument();
    // The seed guide note shows in the timeline (it's a real note).
    expect(screen.getByText(/welcome to your vault/i)).toBeInTheDocument();
  });

  it("goes quiet for a returning vault: no quick doors, the note gathers below", async () => {
    installFetch(WITH_USER_NOTE);
    render(
      <Wrap>
        <Home />
      </Wrap>,
    );
    expect(await screen.findByText("My first thought")).toBeInTheDocument();
    // Vault name still leads; the fresh-only quick doors are gone.
    expect(screen.getByRole("heading", { level: 1, name: "default" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /quick actions/i })).not.toBeInTheDocument();
  });

  it("dismisses the setup nudge and remembers it", async () => {
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <Home />
      </Wrap>,
    );
    await screen.findByText(/finish setting up/i);
    fireEvent.click(screen.getByRole("button", { name: /dismiss setup/i }));
    await waitFor(() => expect(screen.queryByText(/finish setting up/i)).not.toBeInTheDocument());
    expect(loadChecklistState("v1").dismissed).toBe(true);
  });

  it("hides the account backlink for a self-host (OAuth) vault", async () => {
    // Default seed vault has clientId "c" (a foreign OAuth client, not the
    // home door) → no account on THIS door → no backlink.
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <Home />
      </Wrap>,
    );
    await screen.findByRole("heading", { level: 1, name: "default" });
    expect(screen.queryByRole("link", { name: /manage your account/i })).not.toBeInTheDocument();
  });

  it("shows an in-app /account backlink for a home-door vault (no cross-origin console hop)", async () => {
    useVaultStore.setState({
      vaults: {
        v1: {
          id: "v1",
          url: "https://u.parachute.computer/vault/aaron",
          name: "aaron",
          issuer: "https://u.parachute.computer",
          clientId: HOSTED_CLIENT_ID, // home-door (account-minted) vault
          scope: "full",
          addedAt: "2026-07-01T00:00:00.000Z",
          lastUsedAt: "2026-07-01T00:00:00.000Z",
        },
      },
      activeVaultId: "v1",
    });
    installFetch(SEED_ONLY);
    render(
      <Wrap>
        <Home />
      </Wrap>,
    );
    await screen.findByRole("heading", { level: 1, name: "aaron" });
    // In-app react-router link (same origin) — never a cross-origin console URL.
    const link = screen.getByRole("link", { name: /manage your account/i });
    expect(link).toHaveAttribute("href", "/account");
    expect(link.getAttribute("href")).not.toContain("cloud.parachute.computer");
  });
});
