import { MIRROR_FLAG_KEY } from "@/lib/mirror/flag";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

// app#186 — `/v/<vault>/n/<id>`: a note link that names its own vault.
//
// The mount base is detected from `window.location.pathname` at render time
// (`detectMountBase`), so this file exercises BOTH deploy shapes without a
// module mock: a path under `/notes/` lands the router on basename `/notes`,
// and a bare `/v/...` path lands it on the root mount (basename ""). Each test
// says which one it is standing in.

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response("{}", { status: 404 })),
  );
}

function vault(id: string, name: string): VaultRecord {
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

/** Two connected vaults, `alpha` active — the cross-vault link case. */
function seedTwoVaults() {
  useVaultStore.setState({
    vaults: { "v-alpha": vault("v-alpha", "alpha"), "v-beta": vault("v-beta", "beta") },
    activeVaultId: "v-alpha",
  });
}

describe("App — vault-scoped deep links (app#186)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // Same posture as App.test.tsx: this is a routing test, not a mirror test —
    // the background hydration engine would only add re-renders to race.
    localStorage.setItem(MIRROR_FLAG_KEY, "false");
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    window.history.replaceState({}, "", "/notes/");
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("under the /notes mount", () => {
    it("switches to the named vault and hands off to the canonical /n/<id>", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n/abc123");
      render(<App />);

      // The vault named in the URL becomes the active one…
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
      });
      // …and the note resolves at its canonical address under the mount. The
      // `/v/...` shim has said everything it has to say once the context is
      // switched, so it doesn't linger in the address bar.
      await waitFor(() => {
        expect(window.location.pathname).toBe("/notes/n/abc123");
      });
      // Never double-prefixed (the /notes/notes class of bug).
      expect(window.location.pathname.startsWith("/notes/notes")).toBe(false);
    });

    it("confirms the switch with the standard 'Now in {vault}' toast (DESIGN-SPEC §4.4)", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n/abc123");
      render(<App />);
      expect(await screen.findByText(/now in beta/i)).toBeInTheDocument();
    });

    it("does NOT announce a switch when the link names the vault you're already in", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/alpha/n/abc123");
      render(<App />);
      await waitFor(() => {
        expect(window.location.pathname).toBe("/notes/n/abc123");
      });
      expect(useVaultStore.getState().activeVaultId).toBe("v-alpha");
      expect(screen.queryByText(/now in/i)).not.toBeInTheDocument();
    });

    it("carries the /edit tail through to the canonical editor route", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n/abc123/edit");
      render(<App />);
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
        expect(window.location.pathname).toBe("/notes/n/abc123/edit");
      });
    });

    it("resolves the vault name case-insensitively", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/BETA/n/abc123");
      render(<App />);
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
        expect(window.location.pathname).toBe("/notes/n/abc123");
      });
    });

    it("percent-decodes the note id and re-encodes it on the canonical address", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n/Projects%2FREADME");
      render(<App />);
      await waitFor(() => {
        expect(window.location.pathname).toBe("/notes/n/Projects%2FREADME");
      });
    });

    it("a vault-scoped link to a ceremony-word note id still resolves (no denylist false-bail)", async () => {
      // `/v/aaron/n/login` matches nothing in the navigation denylist — the
      // prefixes are anchored at the start of the pathname. The bare-path shim's
      // ceremony guard must not leak into this route.
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n/login");
      render(<App />);
      await waitFor(() => {
        expect(window.location.pathname).toBe("/notes/n/login");
      });
    });
  });

  describe("at the root mount", () => {
    it("switches and hands off with an empty basename", async () => {
      seedTwoVaults();
      // No recognised sub-mount in this pathname → detectMountBase returns "".
      window.history.replaceState({}, "", "/v/beta/n/abc123");
      render(<App />);
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
        expect(window.location.pathname).toBe("/n/abc123");
      });
    });
  });

  describe("unknown vault", () => {
    it("shows a real in-app state naming the vault, at the address the reader landed on", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/gamma/n/abc123");
      render(<App />);

      expect(await screen.findByText(/is not connected here/i)).toBeInTheDocument();
      expect(screen.getByText("gamma")).toBeInTheDocument();
      // Not a blank screen, not the generic 404, and no silent teleport — the
      // URL stays put so the reader can see (and re-copy) the link that failed.
      expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
      expect(window.location.pathname).toBe("/notes/v/gamma/n/abc123");
    });

    it("offers the existing connect affordance", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/gamma/n/abc123");
      render(<App />);
      await screen.findByText(/is not connected here/i);
      expect(screen.getByRole("link", { name: /connect a vault/i })).toHaveAttribute(
        "href",
        "/notes/add",
      );
      expect(screen.getByRole("link", { name: /your vaults/i })).toHaveAttribute(
        "href",
        "/notes/vaults",
      );
    });

    it("never resolves the note against the vault that happens to be active", async () => {
      // The whole point of the route: an unresolvable vault name is a dead end,
      // NOT a fallback to current-vault semantics (which would silently show the
      // wrong note, or the right id in the wrong vault).
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/gamma/n/abc123");
      render(<App />);
      await screen.findByText(/is not connected here/i);
      expect(useVaultStore.getState().activeVaultId).toBe("v-alpha");
    });

    it("shows the same state when no vault is connected at all", async () => {
      window.history.replaceState({}, "", "/notes/v/beta/n/abc123");
      render(<App />);
      expect(await screen.findByText(/is not connected here/i)).toBeInTheDocument();
    });
  });

  describe("the canonical /n/<id> is unchanged", () => {
    it("keeps current-vault semantics and does not touch the active vault", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/n/abc123");
      render(<App />);
      // The control for the switch assertions above: a bare `/n/<id>` neither
      // switches the vault nor announces anything.
      await waitFor(() => {
        expect(window.location.pathname).toBe("/notes/n/abc123");
      });
      expect(useVaultStore.getState().activeVaultId).toBe("v-alpha");
      expect(screen.queryByText(/now in/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/is not connected here/i)).not.toBeInTheDocument();
    });
  });
});
