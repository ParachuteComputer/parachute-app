import { Account } from "@/app/routes/Account";
import { __resetDoorDescriptorCacheForTests } from "@/lib/account/descriptor";
import { HOSTED_CLIENT_ID } from "@/lib/account/hosted-vault";
import { loadAccountToken, useAccountSessionStore } from "@/lib/account/store";
import { useVaultStore } from "@/lib/vault";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-318 "Delete account", exercised through the REAL Account screen and the
// REAL account client: only the network is faked (a tiny same-origin door that
// answers the routes Account touches). So these tests cover the capability
// gate on the live descriptor, the bearer the client attaches, the wire body,
// and the Account screen's own sign-out — not a mock of any of them.

const EMAIL = "person@example.com";
const ACCOUNT_TOKEN_KEY = "lens:account_token";

type Handler = (init: RequestInit | undefined) => Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let deleteHandler: Handler;
/** What `GET /account/vaults` lists for the signed-in account. */
let accountVaults: { name: string }[] = [];
/** Flips once the door has closed the account: every session check says signed out. */
let closed = false;
let descriptor: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function door(): typeof fetch {
  fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path === "/.well-known/parachute-account") return json(descriptor);
    if (path === "/account/session")
      return json(
        closed ? { signed_in: false } : { signed_in: true, csrf: "csrf-1", email: EMAIL },
      );
    if (path === "/account/token" && method === "POST") return json({ token: "acct-tok" });
    if (path === "/account/vaults" && method === "GET") return json({ vaults: accountVaults });
    if (path === "/account/summary") return json({ error: "not_found" }, 404);
    if (path === "/account/delete" && method === "POST") {
      const res = await deleteHandler(init);
      if (res.ok) closed = true;
      return res;
    }
    if (path === "/logout" && method === "POST") return new Response("", { status: 200 });
    return json({ error: "unexpected", path }, 500);
  });
  return fetchMock;
}

function deleteCalls() {
  return fetchMock.mock.calls.filter(([p]) => String(p) === "/account/delete");
}

function renderAccount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <MemoryRouter initialEntries={["/account"]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/account" element={<Account />} />
          <Route path="/" element={<div>Home surface</div>} />
          <Route path="/export" element={<div>Export surface</div>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Wait until the manager view has read the descriptor (the vault list and the
 *  descriptor load in the same effect), so "absent" means absent, not "not yet". */
async function settled() {
  await screen.findByText(EMAIL);
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([p]) => String(p) === "/.well-known/parachute-account")).toBe(
      true,
    ),
  );
  await screen.findByText("No vaults yet.");
}

function confirmInput() {
  return screen.getByLabelText("Type your account email to confirm");
}

function deleteButton() {
  return screen.getByRole("button", { name: "Delete my account" });
}

beforeEach(() => {
  accountVaults = [];
  closed = false;
  localStorage.clear();
  sessionStorage.clear();
  __resetDoorDescriptorCacheForTests();
  sessionStorage.setItem(ACCOUNT_TOKEN_KEY, JSON.stringify({ token: "acct-tok", identity: EMAIL }));
  useVaultStore.setState({ vaults: {}, activeVaultId: null });
  useAccountSessionStore.setState({ expired: false, gate: null, identityEpoch: 0 });
  descriptor = {
    door: "cloud",
    auth: { methods: ["magic_link"], signin_path: "/login" },
    capabilities: { vault_create: true, vault_delete: true, account_delete: true },
  };
  deleteHandler = () =>
    json({
      deleted: true,
      deleted_at: "2026-10-28T12:00:00.000Z",
      undo_expires_at: "2026-10-29T12:00:00.000Z",
      undo_token: "u",
      undo_url: "https://example.com/undo",
      notice_sent: true,
    });
  vi.stubGlobal("fetch", door());
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetDoorDescriptorCacheForTests();
  sessionStorage.clear();
  localStorage.clear();
});

describe("Delete account — capability gate", () => {
  it("is hidden when the door advertises no capabilities (a self-hosted hub)", async () => {
    descriptor = { door: "hub", auth: { methods: ["password"], signin_path: "/login" } };
    renderAccount();
    await settled();
    expect(screen.queryByRole("heading", { name: "Delete account" })).not.toBeInTheDocument();
  });

  it("is hidden when account_delete is false", async () => {
    descriptor = { ...descriptor, capabilities: { vault_delete: true, account_delete: false } };
    renderAccount();
    await settled();
    expect(screen.queryByRole("heading", { name: "Delete account" })).not.toBeInTheDocument();
  });

  it("is shown when account_delete is true, with the export link", async () => {
    renderAccount();
    expect(await screen.findByRole("heading", { name: "Delete account" })).toBeInTheDocument();
    const section = screen.getByRole("region", { name: "Delete account" });
    expect(section).toHaveTextContent(
      "Your account closes now and you're signed out everywhere. Everything is erased after 24 hours: your vaults, notes, files, snapshots and exports. Until then the email we send has an undo link. Export first if you want a copy.",
    );
    fireEvent.click(within(section).getByRole("link", { name: "Export first" }));
    expect(await screen.findByText("Export surface")).toBeInTheDocument();
  });
});

describe("Delete account — confirmation", () => {
  it("keeps the button disabled until the typed email matches (trimmed, any case)", async () => {
    renderAccount();
    await screen.findByRole("heading", { name: "Delete account" });
    expect(deleteButton()).toBeDisabled();

    fireEvent.change(confirmInput(), { target: { value: "person@example.co" } });
    expect(deleteButton()).toBeDisabled();
    fireEvent.change(confirmInput(), { target: { value: "other@example.com" } });
    expect(deleteButton()).toBeDisabled();

    fireEvent.change(confirmInput(), { target: { value: "  Person@Example.COM " } });
    expect(deleteButton()).toBeEnabled();
  });

  it("success: posts { confirm } with the account bearer, shows the undo deadline, then Done signs out", async () => {
    // One hosted vault of THIS account, one of another account on the same door
    // (still on this device), one connected over OAuth to another parachute:
    // account deletion forgets only the first.
    accountVaults = [{ name: "moss" }];
    useVaultStore.setState({
      vaults: {
        moss: {
          id: "moss",
          url: "https://vault.example.com/vault/moss",
          name: "moss",
          issuer: window.location.origin,
          clientId: HOSTED_CLIENT_ID,
          scope: "vault:moss:read vault:moss:write",
          addedAt: "2026-10-01T00:00:00.000Z",
          lastUsedAt: "2026-10-01T00:00:00.000Z",
        },
        pine: {
          id: "pine",
          url: "https://vault.example.com/vault/pine",
          name: "pine",
          issuer: window.location.origin,
          clientId: HOSTED_CLIENT_ID,
          scope: "vault:pine:read vault:pine:write",
          addedAt: "2026-10-01T00:00:00.000Z",
          lastUsedAt: "2026-10-01T00:00:00.000Z",
        },
        home: {
          id: "home",
          url: "https://hub.example.com/vault/home",
          name: "home",
          issuer: "https://hub.example.com",
          clientId: "client-oauth",
          scope: "vault:home:read",
          addedAt: "2026-10-01T00:00:00.000Z",
          lastUsedAt: "2026-10-01T00:00:00.000Z",
        },
      },
      activeVaultId: "moss",
    });
    const view = renderAccount();
    await screen.findByRole("heading", { name: "Delete account" });
    fireEvent.change(confirmInput(), { target: { value: EMAIL } });
    fireEvent.click(deleteButton());

    const outcome = await screen.findByText(/Your account is closed\./);
    const deadline = new Date("2026-10-29T12:00:00.000Z").toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    expect(outcome).toHaveTextContent(
      `Your account is closed. We sent an email with an undo link; it works for 24 hours, until ${deadline}.`,
    );

    expect(deleteCalls()).toHaveLength(1);
    const [, init] = deleteCalls()[0]!;
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer acct-tok");
    expect(JSON.parse(init?.body as string)).toEqual({ confirm: EMAIL });
    // The session is dead server-side — the cached bearer and this account's
    // hosted vaults are dropped at once; another account's vault on the same
    // door and the other door's vault stay.
    expect(loadAccountToken()).toBeNull();
    expect(Object.keys(useVaultStore.getState().vaults).sort()).toEqual(["home", "pine"]);

    // On staging the Account page re-mounted as signed out within a second
    // (T-318 walk) and the outcome vanished. Re-mount it against the now
    // signed-out door: the outcome must still be there.
    view.unmount();
    renderAccount();
    expect(await screen.findByText(/Your account is closed\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("Home surface")).toBeInTheDocument();
  });
});

describe("Delete account — errors", () => {
  it("shows the door's message on a failure and stays signed in", async () => {
    deleteHandler = () =>
      json({ error: "storage_unavailable", message: "Storage is busy right now. Try again." }, 503);
    renderAccount();
    await screen.findByRole("heading", { name: "Delete account" });
    fireEvent.change(confirmInput(), { target: { value: EMAIL } });
    fireEvent.click(deleteButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Storage is busy right now. Try again.",
    );
    expect(screen.queryByText(/Your account is closed/)).not.toBeInTheDocument();
    expect(loadAccountToken()).toBe("acct-tok");
    expect(fetchMock.mock.calls.some(([p]) => String(p) === "/logout")).toBe(false);
  });

  it("explains a mismatch in plain words, not the door's API-client message", async () => {
    deleteHandler = () =>
      json(
        {
          error: "confirm_mismatch",
          message: `deleting an account requires the body {"confirm": "${EMAIL}"}`,
        },
        400,
      );
    renderAccount();
    await screen.findByRole("heading", { name: "Delete account" });
    fireEvent.change(confirmInput(), { target: { value: EMAIL } });
    fireEvent.click(deleteButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That doesn't match your account email.");
    expect(alert).not.toHaveTextContent("requires the body");
  });

  it("explains an already-pending deletion instead of showing the wire code", async () => {
    deleteHandler = () =>
      json(
        { error: "already_deleting", message: "This account is already scheduled for deletion." },
        409,
      );
    renderAccount();
    await screen.findByRole("heading", { name: "Delete account" });
    fireEvent.change(confirmInput(), { target: { value: EMAIL } });
    fireEvent.click(deleteButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "This account is already being deleted. Check your email for the undo link.",
    );
    expect(alert).not.toHaveTextContent("already_deleting");
  });

  it("shows the undo link on screen when the door couldn't send the email", async () => {
    deleteHandler = () =>
      json({
        deleted: true,
        deleted_at: "2026-10-28T12:00:00.000Z",
        undo_expires_at: "2026-10-29T12:00:00.000Z",
        undo_token: "u",
        undo_url: "https://example.com/account/delete/undo?token=u",
        notice_sent: false,
      });
    renderAccount();
    await screen.findByRole("heading", { name: "Delete account" });
    fireEvent.change(confirmInput(), { target: { value: EMAIL } });
    fireEvent.click(deleteButton());

    const outcome = await screen.findByText(/Your account is closed\./);
    expect(outcome).toHaveTextContent("We couldn't send the email with the undo link");
    expect(within(outcome).getByRole("link", { name: "undo the deletion" })).toHaveAttribute(
      "href",
      "https://example.com/account/delete/undo?token=u",
    );
  });
});
