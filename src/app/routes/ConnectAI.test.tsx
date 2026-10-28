import { ConnectAI } from "@/app/routes/ConnectAI";
import { HOSTED_CLIENT_ID } from "@/lib/account/hosted-vault";
import { advertisedMcpUrl } from "@/lib/home/mcp-address";
import { useVaultStore } from "@/lib/vault/store";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function seedStore() {
  useVaultStore.setState({
    vaults: {
      v1: {
        id: "v1",
        url: "https://u.parachute.computer/vault/aaron",
        name: "Aaron's Vault",
        issuer: "https://u.parachute.computer",
        clientId: "c",
        scope: "full",
        addedAt: "2026-07-01T00:00:00.000Z",
        lastUsedAt: "2026-07-01T00:00:00.000Z",
      },
    },
    activeVaultId: "v1",
  });
}

function LocationSpy() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderConnect() {
  return render(
    <MemoryRouter initialEntries={["/connect"]}>
      <Routes>
        <Route path="/connect" element={<ConnectAI />} />
        <Route path="/" element={<LocationSpy />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ConnectAI", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  it("shows the vault MCP URL and the Claude + ChatGPT walkthroughs", () => {
    renderConnect();
    expect(screen.getByRole("heading", { level: 1, name: /connect your ai/i })).toBeInTheDocument();
    // The load-bearing MCP endpoint (bare vault URL + /mcp).
    expect(screen.getByText("https://u.parachute.computer/vault/aaron/mcp")).toBeInTheDocument();
    // Claude's current menu names (T-318), never the stale "Settings → Connectors".
    expect(screen.getByText(/customize → connectors/i)).toBeInTheDocument();
    expect(screen.queryByText(/settings → connectors/i)).not.toBeInTheDocument();
    expect(screen.getByText(/add custom connector/i)).toBeInTheDocument();
    expect(
      screen.getByText(/on claude's free plan you can add one custom connector/i),
    ).toBeInTheDocument();
    // Both assistants get a card.
    expect(screen.getByRole("region", { name: /connect claude/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /connect chatgpt/i })).toBeInTheDocument();
  });

  it("copies the MCP URL to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderConnect();
    fireEvent.click(screen.getByRole("button", { name: /copy vault mcp url/i }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://u.parachute.computer/vault/aaron/mcp"),
    );
  });

  it("W3: has no manual 'connected' tick — a plain way back home instead", async () => {
    renderConnect();
    // The old per-device "I've connected my AI" tick is gone (checklist.ts's
    // docstring: no client-detectable, cross-device signal exists for this),
    // so there's nothing here to mark done and nothing to write to storage.
    expect(screen.queryByRole("button", { name: /connected/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /done.*back to your vault/i }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/"));
    expect(localStorage.getItem("notes:home-checklist:v1")).toBeNull();
  });

  describe("the one MCP address (T-318)", () => {
    const MY_MCP = "https://my.parachute.computer/vault/aaron/mcp";

    function seedHosted() {
      useVaultStore.setState((st) => ({
        vaults: { v1: { ...st.vaults.v1!, clientId: HOSTED_CLIENT_ID } },
      }));
      // A cached account bearer, so the list call goes straight to /account/vaults.
      sessionStorage.setItem(
        "lens:account_token",
        JSON.stringify({ token: "acct", identity: null }),
      );
    }

    function stubVaultsList(vaults: unknown[]) {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = typeof input === "string" ? input : input.toString();
        if (path === "/account/vaults") {
          return new Response(JSON.stringify({ vaults }), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    afterEach(() => sessionStorage.clear());

    it("a home-door vault shows the door's advertised address, and the Claude Code command uses it", async () => {
      seedHosted();
      stubVaultsList([
        {
          name: "Aaron's Vault",
          url: "https://my.parachute.computer/vault/aaron",
          mcp_url: MY_MCP,
        },
      ]);
      renderConnect();
      expect(await screen.findByText(MY_MCP)).toBeInTheDocument();
      // Never the machine (u.) address — not even as a flash before the answer.
      expect(
        screen.queryByText("https://u.parachute.computer/vault/aaron/mcp"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(`claude mcp add --transport http parachute-aaron-s-vault ${MY_MCP}`),
      ).toBeInTheDocument();
    });

    it("falls back to the derived address when the door publishes no mcp_url (a hub)", async () => {
      seedHosted();
      stubVaultsList([{ name: "Aaron's Vault", url: "https://hub.example/vault/aaron" }]);
      renderConnect();
      expect(
        await screen.findByText("https://u.parachute.computer/vault/aaron/mcp"),
      ).toBeInTheDocument();
    });

    it("falls back when the lookup fails", async () => {
      seedHosted();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("nope", { status: 500 })),
      );
      renderConnect();
      expect(
        await screen.findByText("https://u.parachute.computer/vault/aaron/mcp"),
      ).toBeInTheDocument();
    });

    it("a vault connected from another door never asks this door — derived address at once", () => {
      const fetchMock = stubVaultsList([{ name: "Aaron's Vault", mcp_url: MY_MCP }]);
      renderConnect();
      expect(screen.getByText("https://u.parachute.computer/vault/aaron/mcp")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("ignores an mcp_url that isn't an http(s) URL", () => {
      expect(advertisedMcpUrl([{ name: "a", mcp_url: "javascript:alert(1)" }], "a")).toBeNull();
      expect(advertisedMcpUrl([{ name: "a", mcp_url: "not a url" }], "a")).toBeNull();
      expect(advertisedMcpUrl([{ name: "b", mcp_url: MY_MCP }], "a")).toBeNull();
      expect(advertisedMcpUrl([{ name: "a", mcp_url: MY_MCP }], "a")).toBe(MY_MCP);
    });
  });

  it("redirects to the index when no vault is connected", () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    renderConnect();
    expect(screen.getByTestId("location")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /connect your ai/i })).not.toBeInTheDocument();
  });
});
