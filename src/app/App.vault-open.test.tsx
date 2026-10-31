import { MIRROR_FLAG_KEY } from "@/lib/mirror/flag";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

// T-318 — `/v/<name>` on a device that hasn't opened that vault yet. Old
// `/vault/<name>` links land here (cloud #350), and the page used to say "not
// connected here" even to the signed-in owner, with no way forward. Now the
// page asks the home door who is signed in:
//   · the owner gets the vault opened in place (the same mint `/welcome` uses);
//   · a signed-in account that doesn't have it gets "isn't yours" — decided from
//     the account's OWN vault list, so it says nothing about whether the vault
//     exists elsewhere;
//   · a signed-out visitor gets the sign-in form, and the sign-in returns to the
//     vault (magic-link `next`, the check-email poll, then `/welcome`).
//
// The real App, account client, vault store and router run; only the network is
// faked — a small stand-in for the home door's `/account/*` + `/auth/*` API.

interface Door {
  signedIn: boolean;
  email: string;
  owned: string[];
  calls: string[];
  magicBodies: Record<string, unknown>[];
}

let door: Door;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeDoor(): Door {
  const d: Door = {
    signedIn: false,
    email: "owner@example.test",
    owned: [],
    calls: [],
    magicBodies: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(
        typeof input === "string" ? input : (input as Request).url,
        "http://localhost",
      );
      const method = (init?.method ?? "GET").toUpperCase();
      d.calls.push(`${method} ${url.pathname}`);
      if (url.pathname === "/.well-known/parachute-account") {
        return json({ door: "cloud", auth: { methods: ["magic_link"] } });
      }
      if (url.pathname === "/account/session") {
        return json(
          d.signedIn
            ? { signed_in: true, csrf: "c", email: d.email }
            : { signed_in: false, csrf: "c" },
        );
      }
      if (url.pathname === "/auth/magic" && method === "POST") {
        d.magicBodies.push(JSON.parse(String(init?.body)));
        return json({ ok: true });
      }
      if (url.pathname === "/account/token" && method === "POST") {
        return d.signedIn ? json({ token: "acct" }) : json({ error: "unauthorized" }, 401);
      }
      if (url.pathname === "/account/vaults" && method === "GET") {
        if (!d.signedIn) return json({ error: "unauthorized" }, 401);
        return json({
          vaults: d.owned.map((name) => ({ name, url: `http://localhost:8788/vault/${name}` })),
        });
      }
      const mint = /^\/account\/vaults\/([^/]+)\/token$/.exec(url.pathname);
      if (mint && method === "POST") {
        const name = decodeURIComponent(mint[1]).toLowerCase();
        // Cloud's mint answers ONE 403 for unowned and unknown alike.
        if (!d.owned.includes(name)) return json({ error: "not_owner" }, 403);
        const vaultUrl = `http://localhost:8788/vault/${name}`;
        return json({
          vault_token: `vt-${name}`,
          expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
          services: { vault: { url: vaultUrl }, [`vault:${name}`]: { url: vaultUrl } },
        });
      }
      // The vault's own API (after a successful open) and anything else.
      return new Response("{}", { status: 404 });
    }),
  );
  return d;
}

function oauthVault(id: string, name: string): VaultRecord {
  return {
    id,
    url: `http://localhost:1940/vault/${name}`,
    name,
    issuer: "http://localhost:1940",
    clientId: "c",
    scope: "full",
    addedAt: "2026-08-30T00:00:00.000Z",
    lastUsedAt: "2026-08-30T00:00:00.000Z",
  };
}

function activeVaultName(): string | undefined {
  const { vaults, activeVaultId } = useVaultStore.getState();
  return activeVaultId ? vaults[activeVaultId]?.name : undefined;
}

describe("App — /v/<name> on a device that hasn't opened that vault (T-318)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(MIRROR_FLAG_KEY, "false");
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    window.history.replaceState({}, "", "/");
    door = fakeDoor();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("signed in as the owner", () => {
    it("opens the vault in place on a fresh device", async () => {
      door.signedIn = true;
      door.owned = ["garden-notes"];
      window.history.replaceState({}, "", "/v/garden-notes");
      render(<App />);

      await waitFor(() => expect(activeVaultName()).toBe("garden-notes"));
      expect(await screen.findByText(/now in garden-notes/i)).toBeInTheDocument();
      expect(window.location.pathname).toBe("/v/garden-notes");
      expect(screen.queryByText(/is not connected here/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/isn't yours/i)).not.toBeInTheDocument();
    });

    it("opens it next to a vault already on the device, keeping the note address", async () => {
      door.signedIn = true;
      door.owned = ["garden-notes"];
      useVaultStore.setState({
        vaults: { "v-alpha": oauthVault("v-alpha", "alpha") },
        activeVaultId: "v-alpha",
      });
      window.history.replaceState({}, "", "/v/garden-notes/n/abc123");
      render(<App />);

      await waitFor(() => expect(activeVaultName()).toBe("garden-notes"));
      expect(Object.keys(useVaultStore.getState().vaults)).toHaveLength(2);
      expect(window.location.pathname).toBe("/v/garden-notes/n/abc123");
    });

    it("opens the account's vault when the link spells the name in another case", async () => {
      door.signedIn = true;
      door.owned = ["garden-notes"];
      window.history.replaceState({}, "", "/v/Garden-Notes");
      render(<App />);

      await waitFor(() => expect(activeVaultName()).toBe("garden-notes"));
      await waitFor(() => expect(window.location.pathname).toBe("/v/garden-notes"));
    });
  });

  describe("signed in, but the account has no vault by that name", () => {
    it("says plainly the vault isn't yours, and never tries to open it", async () => {
      door.signedIn = true;
      door.owned = ["my-own"];
      window.history.replaceState({}, "", "/v/someone-elses");
      render(<App />);

      expect(await screen.findByText(/isn't yours/i)).toBeInTheDocument();
      expect(screen.getByText("someone-elses")).toBeInTheDocument();
      expect(screen.getByText(/owner@example\.test/)).toBeInTheDocument();
      expect(screen.queryByText(/is not connected here/i)).not.toBeInTheDocument();
      // Decided from the account's own list: no per-vault probe goes out.
      expect(door.calls.some((c) => c.startsWith("POST /account/vaults/"))).toBe(false);
      expect(useVaultStore.getState().activeVaultId).toBeNull();
      expect(window.location.pathname).toBe("/v/someone-elses");
    });

    it("leaves the active vault alone", async () => {
      door.signedIn = true;
      door.owned = [];
      useVaultStore.setState({
        vaults: { "v-alpha": oauthVault("v-alpha", "alpha") },
        activeVaultId: "v-alpha",
      });
      window.history.replaceState({}, "", "/v/someone-elses/n/abc123");
      render(<App />);

      expect(await screen.findByText(/isn't yours/i)).toBeInTheDocument();
      expect(useVaultStore.getState().activeVaultId).toBe("v-alpha");
    });
  });

  describe("signed out", () => {
    it("shows the sign-in form, and the link it sends returns to the vault", async () => {
      door.owned = ["garden-notes"];
      window.history.replaceState({}, "", "/v/garden-notes/n/abc123");
      render(<App />);

      const field = await screen.findByLabelText(/email address/i);
      expect(screen.queryByText(/is not connected here/i)).not.toBeInTheDocument();
      fireEvent.change(field, { target: { value: "owner@example.test" } });
      fireEvent.click(screen.getByRole("button", { name: /email me a sign-in link/i }));

      await waitFor(() => expect(door.magicBodies).toHaveLength(1));
      expect(door.magicBodies[0].next).toBe("/welcome?redirect=%2Fv%2Fgarden-notes%2Fn%2Fabc123");
      await waitFor(() => expect(window.location.pathname).toBe("/check-email"));
      expect(new URLSearchParams(window.location.search).get("redirect")).toBe(
        "/v/garden-notes/n/abc123",
      );
    });

    it("the whole round trip: sign in from the vault page, land back in the vault", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        // Two vaults, so only the return target (not welcome-back's auto-open
        // of a lone vault) can bring the reader to this one.
        door.owned = ["other", "garden-notes"];
        window.history.replaceState({}, "", "/v/garden-notes");
        render(<App />);

        fireEvent.change(await screen.findByLabelText(/email address/i), {
          target: { value: "owner@example.test" },
        });
        fireEvent.click(screen.getByRole("button", { name: /email me a sign-in link/i }));
        await waitFor(() => expect(window.location.pathname).toBe("/check-email"));

        // The link is clicked in this browser: the session turns signed-in and
        // check-email's poll moves on, through /welcome, back to the vault.
        door.signedIn = true;
        await vi.advanceTimersByTimeAsync(3100);

        await waitFor(() => expect(activeVaultName()).toBe("garden-notes"), { timeout: 4000 });
        await waitFor(() => expect(window.location.pathname).toBe("/v/garden-notes"));
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("the emailed link's /welcome?redirect= lands on the vault, opened", async () => {
    // The link opened on another device: the door verifies it and 302s to the
    // `next` the vault page asked for.
    door.signedIn = true;
    door.owned = ["garden-notes", "other"];
    window.history.replaceState({}, "", "/welcome?redirect=%2Fv%2Fgarden-notes");
    render(<App />);

    await waitFor(() => expect(activeVaultName()).toBe("garden-notes"));
    await waitFor(() => expect(window.location.pathname).toBe("/v/garden-notes"));
  });

  it("/welcome ignores a redirect that leaves the app", async () => {
    door.signedIn = true;
    door.owned = ["garden-notes", "other"];
    window.history.replaceState({}, "", "/welcome?redirect=%2F%2Fevil.example%2Fv%2Fx");
    render(<App />);

    // Two vaults → the normal picker, not a hop off-site.
    expect(await screen.findByText("garden-notes")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/welcome");
  });

  it("a door without an account API keeps the connect card", async () => {
    // A self-hosted box that serves the app but no `/account/*` (404).
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("{}", { status: 404 })),
    );
    window.history.replaceState({}, "", "/v/garden-notes");
    render(<App />);

    expect(await screen.findByText(/is not connected here/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /connect a vault/i })).toBeInTheDocument();
  });
});
