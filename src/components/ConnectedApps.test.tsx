import { ConnectedApps } from "@/components/ConnectedApps";
import { __resetDoorDescriptorCacheForTests } from "@/lib/account/descriptor";
import { HOSTED_CLIENT_ID } from "@/lib/account/hosted-vault";
import { useToastStore } from "@/lib/toast/store";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Drives the component against a fake DOOR (descriptor + the cloud
// connections API wire, as workers/identity/src/oauth-connections.ts serves
// it). The door is outside this repo, so it is the one thing faked; the
// account client, bearer handling and component are all real.

interface Conn {
  client_id: string;
  client_name: string | null;
  connected_at: string;
  last_used_at: string | null;
  access: "read" | "write" | "admin";
  covers: "vault" | "account";
  scopes: string[];
}

const CLAUDE: Conn = {
  client_id: "client-claude",
  client_name: "Claude",
  connected_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  last_used_at: new Date(Date.now() - 3_600_000).toISOString(),
  access: "write",
  covers: "vault",
  scopes: ["vault:notes:read", "vault:notes:write"],
};

function fakeDoor(opts: { connections?: boolean; list?: Conn[] } = {}) {
  let list = [...(opts.list ?? [])];
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path}`);
    if (path === "/.well-known/parachute-account") {
      return Response.json({
        door: "cloud",
        auth: { methods: ["magic_link"], signin_path: "/login" },
        capabilities: {
          vault_create: true,
          vault_delete: true,
          ...(opts.connections === undefined ? {} : { connections: opts.connections }),
        },
      });
    }
    const m = /^\/account\/vaults\/([^/]+)\/connections(?:\/([^/]+))?$/.exec(path);
    if (m) {
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (auth !== "Bearer acct") return new Response("{}", { status: 401 });
      if (method === "GET")
        return Response.json({ vault: decodeURIComponent(m[1]!), connections: list });
      if (method === "DELETE") {
        const id = decodeURIComponent(m[2]!);
        if (!list.some((c) => c.client_id === id)) return new Response("{}", { status: 404 });
        list = list.filter((c) => c.client_id !== id);
        return Response.json({ disconnected: true, client_id: id });
      }
    }
    return new Response("{}", { status: 404 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function renderApps(fetchImpl: typeof fetch, clientId = HOSTED_CLIENT_ID) {
  return render(
    <MemoryRouter>
      <ConnectedApps vault={{ name: "notes", clientId }} fetchImpl={fetchImpl} />
    </MemoryRouter>,
  );
}

describe("ConnectedApps (vault settings)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    __resetDoorDescriptorCacheForTests();
    // A cached account bearer (the client sends it as Authorization: Bearer).
    sessionStorage.setItem("lens:account_token", JSON.stringify({ token: "acct", identity: null }));
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it("lists each connected app with what it can do and when it was last used", async () => {
    const door = fakeDoor({ connections: true, list: [CLAUDE] });
    renderApps(door.fetchImpl);
    expect(await screen.findByRole("heading", { name: /connected apps/i })).toBeInTheDocument();
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(
      screen.getByText(/can read and write notes · connected 3d ago · last used 1h ago/i),
    ).toBeInTheDocument();
    expect(door.calls).toContain("GET /account/vaults/notes/connections");
  });

  it("uses the server slug from the vault URL, not a renamed local label", async () => {
    const door = fakeDoor({ connections: true, list: [CLAUDE] });
    render(
      <MemoryRouter>
        <ConnectedApps
          vault={{
            name: "My renamed notes",
            clientId: HOSTED_CLIENT_ID,
            url: "https://u.parachute.computer/vault/notes",
          }}
          fetchImpl={door.fetchImpl}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(door.calls).toContain("GET /account/vaults/notes/connections");
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, disconnect Claude" }));
    await waitFor(() =>
      expect(door.calls.some((c) => c.startsWith("DELETE /account/vaults/notes/"))).toBe(true),
    );
  });

  it("a local rename keeps the list (never stuck on Loading…)", async () => {
    const door = fakeDoor({ connections: true, list: [CLAUDE] });
    const url = "https://u.parachute.computer/vault/notes";
    const view = render(
      <MemoryRouter>
        <ConnectedApps
          vault={{ name: "notes", clientId: HOSTED_CLIENT_ID, url }}
          fetchImpl={door.fetchImpl}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    view.rerender(
      <MemoryRouter>
        <ConnectedApps
          vault={{ name: "Renamed", clientId: HOSTED_CLIENT_ID, url }}
          fetchImpl={door.fetchImpl}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it("Disconnect asks first, then DELETEs, refreshes the list and says so", async () => {
    const door = fakeDoor({ connections: true, list: [CLAUDE] });
    renderApps(door.fetchImpl);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    // Nothing happens until confirmed.
    expect(door.calls.some((c) => c.startsWith("DELETE"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Yes, disconnect Claude" }));
    await waitFor(() =>
      expect(door.calls).toContain("DELETE /account/vaults/notes/connections/client-claude"),
    );
    // The list is re-read and is now empty → the empty state.
    expect(await screen.findByText(/nothing is connected yet/i)).toBeInTheDocument();
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
      "Claude is disconnected.",
    );
  });

  it("Cancel leaves the app connected", async () => {
    const door = fakeDoor({ connections: true, list: [CLAUDE] });
    renderApps(door.fetchImpl);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(door.calls.some((c) => c.startsWith("DELETE"))).toBe(false);
  });

  it("empty state points to Connect AI", async () => {
    const door = fakeDoor({ connections: true, list: [] });
    renderApps(door.fetchImpl);
    const link = await screen.findByRole("link", { name: /connect an ai/i });
    expect(link).toHaveAttribute("href", "/connect");
  });

  it("an account-wide connection says disconnecting removes it from every vault", async () => {
    const door = fakeDoor({ connections: true, list: [{ ...CLAUDE, covers: "account" }] });
    renderApps(door.fetchImpl);
    expect(await screen.findByText(/reaches every vault in your account/i)).toBeInTheDocument();
  });

  it("hidden on a door that doesn't advertise connections — and never calls the API", async () => {
    const door = fakeDoor({ list: [CLAUDE] }); // capabilities without `connections`
    const { container } = renderApps(door.fetchImpl);
    await waitFor(() => expect(door.calls).toContain("GET /.well-known/parachute-account"));
    expect(container).toBeEmptyDOMElement();
    expect(door.calls.some((c) => c.includes("/connections"))).toBe(false);
  });

  it("switching vaults never shows the previous vault's apps, even when its answer arrives last", async () => {
    let releaseA: (r: Response) => void = () => {};
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input.toString();
      if (path === "/.well-known/parachute-account") {
        return Response.json({ door: "cloud", capabilities: { connections: true } });
      }
      if (path === "/account/vaults/a/connections") {
        return new Promise<Response>((r) => {
          releaseA = r;
        });
      }
      if (path === "/account/vaults/b/connections")
        return Response.json({ vault: "b", connections: [] });
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const view = render(
      <MemoryRouter>
        <ConnectedApps vault={{ name: "a", clientId: HOSTED_CLIENT_ID }} fetchImpl={fetchImpl} />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith("/account/vaults/a/connections", expect.anything()),
    );
    view.rerender(
      <MemoryRouter>
        <ConnectedApps vault={{ name: "b", clientId: HOSTED_CLIENT_ID }} fetchImpl={fetchImpl} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/nothing is connected yet/i)).toBeInTheDocument();
    releaseA(Response.json({ vault: "a", connections: [CLAUDE] }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Claude")).not.toBeInTheDocument();
  });

  it("hidden for a vault connected from another door (not a home-door vault)", async () => {
    const door = fakeDoor({ connections: true, list: [CLAUDE] });
    const { container } = renderApps(door.fetchImpl, "some-oauth-client");
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(door.calls).toEqual([]);
  });
});
