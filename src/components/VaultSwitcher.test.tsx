import { VaultSwitcher, buildVaultSwitcherRows } from "@/components/VaultSwitcher";
import * as accountClient from "@/lib/account/client";
import * as hostedVaultModule from "@/lib/account/hosted-vault";
import { HOSTED_CLIENT_ID } from "@/lib/account/hosted-vault";
import type { AccountSummary, AccountVault } from "@/lib/account/types";
import { useToastStore } from "@/lib/toast/store";
import type { HubVaultEntry } from "@/lib/vault/hub-discovery";
import * as oauthModule from "@/lib/vault/oauth";
import { InsecureContextError } from "@/lib/vault/pkce";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeVault(partial: Partial<VaultRecord> & Pick<VaultRecord, "id" | "url">): VaultRecord {
  return {
    name: "",
    issuer: "http://localhost:1939",
    clientId: "client-test",
    scope: "vault:read",
    addedAt: "2026-05-12T00:00:00.000Z",
    lastUsedAt: "2026-05-12T00:00:00.000Z",
    ...partial,
  };
}

function makeHubVault(name: string, url: string): HubVaultEntry {
  return { name, url, version: "0.1.0" };
}

function accountVault(name: string, url?: string): AccountVault {
  return { name, url };
}

function summaryWith(plan: AccountSummary["plan"]): AccountSummary {
  return {
    email: "ravi@example.com",
    plan,
    billing_enabled: true,
    has_billing_customer: false,
  };
}

describe("buildVaultSwitcherRows", () => {
  it("returns just the device vaults when hub and account are empty", () => {
    const v = makeVault({
      id: "v",
      url: "http://localhost:1939/vault/default",
      name: "default",
    });
    const rows = buildVaultSwitcherRows([v], "v", [], "http://localhost:1939", null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "device", id: "v", isActive: true, hubKnown: false });
  });

  it("marks a device vault as hubKnown when the hub publishes a matching URL", () => {
    const v = makeVault({
      id: "v",
      url: "http://localhost:1939/vault/default",
      name: "default",
    });
    const rows = buildVaultSwitcherRows(
      [v],
      "v",
      [makeHubVault("default", "http://localhost:1939/vault/default")],
      "http://localhost:1939",
      null,
    );
    expect(rows.filter((r) => r.kind === "device")).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "device", hubKnown: true });
    expect(rows.filter((r) => r.kind === "hub")).toHaveLength(0);
  });

  it("splits hub-only vaults into the hub section", () => {
    const v = makeVault({
      id: "v",
      url: "http://localhost:1939/vault/default",
      name: "default",
    });
    const rows = buildVaultSwitcherRows(
      [v],
      "v",
      [
        makeHubVault("default", "http://localhost:1939/vault/default"),
        makeHubVault("techne", "http://localhost:1939/vault/techne"),
        makeHubVault("boulder", "http://localhost:1939/vault/boulder"),
      ],
      "http://localhost:1939",
      null,
    );
    expect(rows.filter((r) => r.kind === "device")).toHaveLength(1);
    const hub = rows.filter((r) => r.kind === "hub");
    expect(hub).toHaveLength(2);
    expect(hub.map((r) => r.kind === "hub" && r.name)).toEqual(["boulder", "techne"]);
  });

  it("returns no hub rows when hub origin is null (standalone-vault case)", () => {
    const v = makeVault({
      id: "v",
      url: "https://vault.example.com",
      name: "default",
      issuer: "https://vault.example.com",
    });
    const rows = buildVaultSwitcherRows(
      [v],
      "v",
      [makeHubVault("other", "https://vault.example.com/vault/other")],
      null,
      null,
    );
    expect(rows.every((r) => r.kind === "device")).toBe(true);
  });

  it("sorts device rows by display label", () => {
    const a = makeVault({
      id: "a",
      url: "http://localhost:1939/vault/charlie",
      name: "charlie",
    });
    const b = makeVault({
      id: "b",
      url: "http://localhost:1939/vault/alpha",
      name: "alpha",
    });
    const rows = buildVaultSwitcherRows([a, b], "a", [], "http://localhost:1939", null);
    expect(rows.map((r) => r.kind === "device" && r.label)).toEqual(["alpha", "charlie"]);
  });

  it("matches device vs hub URLs after trailing-slash normalization", () => {
    const v = makeVault({
      id: "v",
      url: "http://localhost:1939/vault/default",
      name: "default",
    });
    const rows = buildVaultSwitcherRows(
      [v],
      "v",
      [makeHubVault("default", "http://localhost:1939/vault/default/")],
      "http://localhost:1939",
      null,
    );
    expect(rows.filter((r) => r.kind === "hub")).toHaveLength(0);
  });

  // --- the account partition (F13: Open is scoped to NOT-on-this-device) ---

  it("scopes account rows to vaults not on this device (URL match)", () => {
    const onDevice = makeVault({
      id: "v",
      url: "https://u.example.com/vault/moss",
      name: "moss",
      clientId: HOSTED_CLIENT_ID,
    });
    const rows = buildVaultSwitcherRows([onDevice], "v", [], null, [
      accountVault("moss", "https://u.example.com/vault/moss"),
      accountVault("fieldnotes", "https://u.example.com/vault/fieldnotes"),
    ]);
    const account = rows.filter((r) => r.kind === "account");
    expect(account).toHaveLength(1);
    expect(account[0]).toMatchObject({ kind: "account", name: "fieldnotes" });
  });

  it("excludes an account vault matching an on-device HOME-DOOR record by name even when URLs differ", () => {
    // The account list and the mint-time services catalog can disagree on URL
    // shape; the slug is the identity for home-door records.
    const onDevice = makeVault({
      id: "v",
      url: "http://localhost:4700/vault/moss",
      name: "moss",
      clientId: HOSTED_CLIENT_ID,
    });
    const rows = buildVaultSwitcherRows([onDevice], "v", [], null, [
      accountVault("moss", "https://u.example.com/vault/moss"),
    ]);
    expect(rows.filter((r) => r.kind === "account")).toHaveLength(0);
  });

  it("does NOT name-match an account vault against a SELF-HOSTED record (different door, same name)", () => {
    const selfHosted = makeVault({
      id: "v",
      url: "https://hub.example.com/vault/moss",
      name: "moss",
      clientId: "oauth-client-x",
    });
    const rows = buildVaultSwitcherRows([selfHosted], "v", [], null, [
      accountVault("moss", "https://u.example.com/vault/moss"),
    ]);
    const account = rows.filter((r) => r.kind === "account");
    expect(account).toHaveLength(1);
    expect(account[0]).toMatchObject({ kind: "account", name: "moss" });
  });

  it("renders no account rows when the account list is null (signed out / self-host / failed)", () => {
    const v = makeVault({ id: "v", url: "https://u.example.com/vault/moss", name: "moss" });
    const rows = buildVaultSwitcherRows([v], "v", [], null, null);
    expect(rows.filter((r) => r.kind === "account")).toHaveLength(0);
  });

  it("collapses a hub entry sharing an account vault's URL into the account Open row", () => {
    const v = makeVault({
      id: "v",
      url: "http://localhost:1939/vault/default",
      name: "default",
    });
    const rows = buildVaultSwitcherRows(
      [v],
      "v",
      [makeHubVault("techne", "http://localhost:1939/vault/techne")],
      "http://localhost:1939",
      [accountVault("techne", "http://localhost:1939/vault/techne")],
    );
    expect(rows.filter((r) => r.kind === "account")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "hub")).toHaveLength(0);
  });
});

// Probe that records the current location so verb-navigation tests can assert
// where a Link landed without a full route table.
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

describe("VaultSwitcher (component)", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    vi.restoreAllMocks();
    // Default: no door session — summary and account list degrade to null.
    vi.spyOn(accountClient, "getAccountSummary").mockResolvedValue(null);
    vi.spyOn(accountClient, "listVaults").mockRejectedValue(
      new accountClient.SessionExpiredError(),
    );
    // Default: hub returns nothing
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ vaults: [], services: [] }),
        }) as Response,
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    vi.restoreAllMocks();
  });

  // W2-5: the panel belongs to the RAIL variant (desktop trigger + popover);
  // the sheet variant renders the same panel inline, and the header variant
  // owns no panel at all (it delegates to the NavSheet). These tests exercise
  // the panel through its rail trigger.
  function renderSwitcher() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <VaultSwitcher variant="rail" />
          <Routes>
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  function seedDefaultVault() {
    useVaultStore.setState({
      vaults: {
        v: makeVault({ id: "v", url: "http://localhost:1939/vault/default", name: "default" }),
      },
      activeVaultId: "v",
    });
  }

  it("renders the active vault's label on the trigger", () => {
    seedDefaultVault();
    renderSwitcher();
    expect(screen.getByRole("button", { name: /active vault: default/i })).toBeInTheDocument();
  });

  it("opens and closes on trigger click + closes on outside click", async () => {
    seedDefaultVault();
    renderSwitcher();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("switches the active vault on a device-row click, toasts 'Now in {vault}', then closes", async () => {
    useVaultStore.setState({
      vaults: {
        a: makeVault({ id: "a", url: "http://localhost:1939/vault/default", name: "default" }),
        b: makeVault({ id: "b", url: "http://localhost:1939/vault/techne", name: "techne" }),
      },
      activeVaultId: "a",
    });
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    fireEvent.click(await screen.findByRole("button", { name: "techne" }));
    expect(useVaultStore.getState().activeVaultId).toBe("b");
    // WALK-manager #2 — activation honesty: the switch is confirmed.
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain("Now in techne");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("clicking the current vault's row just closes — no toast (nothing switched)", async () => {
    seedDefaultVault();
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    // The row's accessible name is "default ✓ current"; the trigger's is
    // "Active vault: default" — anchor to the row.
    fireEvent.click(await screen.findByRole("button", { name: /^default/ }));
    expect(useVaultStore.getState().activeVaultId).toBe("v");
    expect(useToastStore.getState().toasts).toHaveLength(0);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  // --- the account section (F13) -----------------------------------------

  it("lists account vaults NOT on this device with an Open verb; on-device ones are excluded", async () => {
    useVaultStore.setState({
      vaults: {
        v: makeVault({
          id: "v",
          url: "https://u.example.com/vault/moss",
          name: "moss",
          clientId: HOSTED_CLIENT_ID,
        }),
      },
      activeVaultId: "v",
    });
    vi.spyOn(accountClient, "listVaults").mockResolvedValue({
      vaults: [
        accountVault("moss", "https://u.example.com/vault/moss"),
        accountVault("fieldnotes", "https://u.example.com/vault/fieldnotes"),
      ],
    });
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    await waitFor(() => expect(screen.getByText("In your account")).toBeInTheDocument());
    expect(screen.getByText("fieldnotes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open →/ })).toBeInTheDocument();
    // moss is on this device — exactly one row for it (the device row), no Open row.
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelectorAll("li").length).toBe(2); // moss (device) + fieldnotes (account)
  });

  it("Open on an account row mints + activates the vault and toasts 'Now in {vault}'", async () => {
    useVaultStore.setState({
      vaults: {
        v: makeVault({
          id: "v",
          url: "https://u.example.com/vault/moss",
          name: "moss",
          clientId: HOSTED_CLIENT_ID,
        }),
      },
      activeVaultId: "v",
    });
    vi.spyOn(accountClient, "listVaults").mockResolvedValue({
      vaults: [accountVault("fieldnotes", "https://u.example.com/vault/fieldnotes")],
    });
    const openSpy = vi
      .spyOn(hostedVaultModule, "openHostedVault")
      .mockImplementation(async (name: string) => {
        // Mirror the real behavior: the opened vault becomes active.
        const id = `opened-${name}`;
        useVaultStore.setState((s) => ({
          vaults: {
            ...s.vaults,
            [id]: makeVault({
              id,
              url: `https://u.example.com/vault/${name}`,
              name,
              clientId: HOSTED_CLIENT_ID,
            }),
          },
          activeVaultId: id,
        }));
        return id;
      });

    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    await waitFor(() => expect(screen.getByText("fieldnotes")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open →/ }));
    });

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith("fieldnotes"));
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain("Now in fieldnotes");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows friendly copy when Open fails — never a raw wire code", async () => {
    seedDefaultVault();
    vi.spyOn(accountClient, "listVaults").mockResolvedValue({
      vaults: [accountVault("fieldnotes", "https://u.example.com/vault/fieldnotes")],
    });
    vi.spyOn(hostedVaultModule, "openHostedVault").mockRejectedValue(
      new accountClient.AccountApiError(403, "not_owner"),
    );
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    await waitFor(() => expect(screen.getByText("fieldnotes")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open →/ }));
    });
    await waitFor(() =>
      expect(screen.getByText("That vault isn't linked to this account.")).toBeInTheDocument(),
    );
    expect(screen.queryByText("not_owner")).not.toBeInTheDocument();
  });

  // --- plan-aware create (WALK-manager #3) --------------------------------

  it("renders the upsell instead of Create at the vault limit — the 409 is unreachable", async () => {
    seedDefaultVault();
    vi.spyOn(accountClient, "getAccountSummary").mockResolvedValue(
      summaryWith({ tier: "trial", label: "Free trial", vault_limit: 1, vaults_used: 1 }),
    );
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    await waitFor(() => expect(screen.getByText("1 of 1 vaults on your plan")).toBeInTheDocument());
    const upsell = screen.getByText("1 of 1 vaults on your plan").closest("a");
    expect(upsell).not.toBeNull();
    expect(upsell).toHaveAttribute("href", "/account");
    expect(upsell).toHaveTextContent("Upgrade →");
    expect(screen.queryByText("Create a vault")).not.toBeInTheDocument();
  });

  it("renders the plain Create verb below the limit", async () => {
    seedDefaultVault();
    vi.spyOn(accountClient, "getAccountSummary").mockResolvedValue(
      summaryWith({ tier: "standard", label: "Standard", vault_limit: 3, vaults_used: 1 }),
    );
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    await waitFor(() => expect(screen.getByText("Create a vault")).toBeInTheDocument());
    expect(screen.queryByText(/on your plan/)).not.toBeInTheDocument();
  });

  it("degrades to the plain Create verb with no summary (self-host / fetch failed)", async () => {
    seedDefaultVault();
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    await waitFor(() => expect(screen.getByText("Create a vault")).toBeInTheDocument());
    expect(screen.queryByText(/on your plan/)).not.toBeInTheDocument();
  });

  it("Create verb navigates to the create flow (push door — /add-vault/create, W2-6)", async () => {
    seedDefaultVault();
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    fireEvent.click(await screen.findByText("Create a vault"));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/add-vault/create"),
    );
  });

  it("Connect your own navigates to /add", async () => {
    seedDefaultVault();
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    fireEvent.click(await screen.findByText("Connect your own"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/add"));
  });

  // --- trial ambience (F4, decision b) ------------------------------------

  it("shows the trial foot line only while trialing, linking /account", async () => {
    seedDefaultVault();
    vi.spyOn(accountClient, "getAccountSummary").mockResolvedValue(
      summaryWith({
        tier: "trial",
        label: "Free trial",
        trial_days_left: 5,
        vault_limit: 1,
        vaults_used: 1,
      }),
    );
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    const line = await screen.findByText("Free trial · 5 days left");
    expect(line.closest("a")).toHaveAttribute("href", "/account");
  });

  it("renders 'ends today' at 0 trial days left (not '0 days left')", async () => {
    seedDefaultVault();
    vi.spyOn(accountClient, "getAccountSummary").mockResolvedValue(
      summaryWith({
        tier: "trial",
        label: "Free trial",
        trial_days_left: 0,
        vault_limit: 1,
        vaults_used: 1,
      }),
    );
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    const line = await screen.findByText("Free trial · ends today");
    expect(line.closest("a")).toHaveAttribute("href", "/account");
    expect(screen.queryByText(/0 days left/)).not.toBeInTheDocument();
  });

  it("shows no trial line on a paid plan", async () => {
    seedDefaultVault();
    vi.spyOn(accountClient, "getAccountSummary").mockResolvedValue(
      summaryWith({ tier: "standard", label: "Standard", vault_limit: 3, vaults_used: 1 }),
    );
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    await waitFor(() => expect(screen.getByText("Create a vault")).toBeInTheDocument());
    expect(screen.queryByText(/Free trial/)).not.toBeInTheDocument();
  });

  // --- the hub section (unchanged behavior) -------------------------------

  it("renders hub rows when the hub publishes additional vaults", async () => {
    seedDefaultVault();
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            vaults: [
              { name: "default", url: "http://localhost:1939/vault/default", version: "0.1.0" },
              { name: "techne", url: "http://localhost:1939/vault/techne", version: "0.1.0" },
            ],
            services: [],
          }),
        }) as Response,
    ) as unknown as typeof fetch;
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    await waitFor(() => expect(screen.getByText("From your hub")).toBeInTheDocument());
    expect(screen.getByText("techne")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Connect$/ })).toBeInTheDocument();
  });

  it("kicks beginOAuth with the vault hint when Connect is clicked", async () => {
    seedDefaultVault();
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            vaults: [
              { name: "default", url: "http://localhost:1939/vault/default", version: "0.1.0" },
              { name: "techne", url: "http://localhost:1939/vault/techne", version: "0.1.0" },
            ],
            services: [],
          }),
        }) as Response,
    ) as unknown as typeof fetch;
    const beginSpy = vi.spyOn(oauthModule, "beginOAuth").mockResolvedValue({
      authorizeUrl: "http://localhost:1939/oauth/authorize?test",
      pending: {
        issuerUrl: "http://localhost:1939",
        issuer: "http://localhost:1939",
        tokenEndpoint: "http://localhost:1939/oauth/token",
        clientId: "x",
        codeVerifier: "v",
        state: "s",
        redirectUri: "r",
        scope: "vault:read",
        startedAt: "now",
      },
    });
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign: assignSpy },
    });

    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    await waitFor(() => expect(screen.getByText("techne")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Connect$/ }));
    });

    await waitFor(() => expect(beginSpy).toHaveBeenCalled());
    expect(beginSpy.mock.calls[0]?.[0]).toBe("http://localhost:1939");
    expect(beginSpy.mock.calls[0]?.[3]).toEqual({ params: { vault: "techne" } });
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith("http://localhost:1939/oauth/authorize?test"),
    );
  });

  // notes#143 follow-up: a refactor of the Connect handler could silently
  // drop the InsecureContextError branch and the user would be back to the
  // cryptic generic-error one-liner. Pin the wiring with a component-level
  // test that doesn't depend on AddVault.
  it("renders the InsecureContextBanner when beginOAuth throws InsecureContextError", async () => {
    seedDefaultVault();
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            vaults: [
              { name: "techne", url: "http://localhost:1939/vault/techne", version: "0.1.0" },
            ],
            services: [],
          }),
        }) as Response,
    ) as unknown as typeof fetch;
    vi.spyOn(oauthModule, "beginOAuth").mockRejectedValue(
      new InsecureContextError("insecure context"),
    );

    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    await waitFor(() => expect(screen.getByText("techne")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Connect$/ }));
    });

    const banner = await screen.findByTestId("insecure-context-banner");
    expect(banner).toHaveTextContent(/Insecure context/i);
    expect(banner).toHaveTextContent(/HTTPS or accessed at/i);
  });

  it("does not render the InsecureContextBanner on a generic beginOAuth error", async () => {
    seedDefaultVault();
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            vaults: [
              { name: "techne", url: "http://localhost:1939/vault/techne", version: "0.1.0" },
            ],
            services: [],
          }),
        }) as Response,
    ) as unknown as typeof fetch;
    vi.spyOn(oauthModule, "beginOAuth").mockRejectedValue(new Error("hub returned 502"));

    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    await waitFor(() => expect(screen.getByText("techne")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Connect$/ }));
    });

    // The dedicated banner stays hidden; the generic error line surfaces instead.
    await waitFor(() => expect(screen.getByText(/hub returned 502/i)).toBeInTheDocument());
    expect(screen.queryByTestId("insecure-context-banner")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // W2-5 variants — the sheet's inline band and the header's delegate pill.
  // -------------------------------------------------------------------------

  it("sheet variant renders the panel INLINE (no trigger, no popover dialog)", async () => {
    useVaultStore.setState({
      vaults: {
        a: makeVault({ id: "a", url: "http://localhost:1939/vault/default", name: "default" }),
        b: makeVault({ id: "b", url: "http://localhost:1939/vault/techne", name: "techne" }),
      },
      activeVaultId: "a",
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <VaultSwitcher variant="sheet" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // Rows are present without any trigger click…
    expect(await screen.findByText("default")).toBeInTheDocument();
    expect(screen.getByText("techne")).toBeInTheDocument();
    expect(screen.getByText(/✓ current/i)).toBeInTheDocument();
    // …and there is no floating dialog and no trigger button.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /active vault/i })).not.toBeInTheDocument();
  });

  it("sheet variant fires onAction after a switch (so the NavSheet can close)", async () => {
    useVaultStore.setState({
      vaults: {
        a: makeVault({ id: "a", url: "http://localhost:1939/vault/default", name: "default" }),
        b: makeVault({ id: "b", url: "http://localhost:1939/vault/techne", name: "techne" }),
      },
      activeVaultId: "a",
    });
    const onAction = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <VaultSwitcher variant="sheet" onAction={onAction} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByText("techne"));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(useVaultStore.getState().activeVaultId).toBe("b");
  });

  it("header variant owns no panel — the pill delegates to the NavSheet", () => {
    seedDefaultVault();
    const onOpenNavSheet = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <VaultSwitcher variant="header" onOpenNavSheet={onOpenNavSheet} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /active vault: default/i }));
    expect(onOpenNavSheet).toHaveBeenCalledTimes(1);
    // No popover of its own — one menu vocabulary on mobile (the sheet).
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
