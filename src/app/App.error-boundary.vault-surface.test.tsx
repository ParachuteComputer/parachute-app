import { App } from "@/app/App";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const accountMocks = vi.hoisted(() => ({
  getDoorDescriptor: vi.fn(),
  resolveBoot: vi.fn(),
}));

vi.mock("@/lib/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account")>()),
  getDoorDescriptor: accountMocks.getDoorDescriptor,
  resolveBoot: accountMocks.resolveBoot,
}));

// VaultSurface is eager, so this mock must be hoisted before App.tsx binds
// the import. It exercises the actual /notes route and BootGate wiring rather
// than only proving RouteErrorBoundary in isolation.
vi.mock("@/app/routes/VaultSurface", () => ({
  VaultSurface: () => {
    throw new Error("vault surface blew up");
  },
}));

function seedVault() {
  useVaultStore.setState({
    vaults: {
      v1: {
        id: "v1",
        url: "http://localhost:1940",
        name: "default",
        issuer: "http://localhost:1940",
        clientId: "c",
        scope: "full",
        addedAt: "2026-04-20T00:00:00.000Z",
        lastUsedAt: "2026-04-20T00:00:00.000Z",
      },
    },
    activeVaultId: "v1",
  });
}

function stubFetch404() {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response("{}", { status: 404 })),
  );
}

describe("RouteErrorBoundary around the eager VaultSurface", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    seedVault();
    stubFetch404();
    accountMocks.getDoorDescriptor.mockReset().mockResolvedValue({});
    accountMocks.resolveBoot.mockReset().mockResolvedValue({ kind: "home" });
    useToastStore.setState({ toasts: [] });
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    vi.unstubAllGlobals();
    consoleErrorSpy.mockRestore();
  });

  it.each(["/notes", "/"])(
    "contains a VaultSurface render failure at %s while keeping the app chrome mounted",
    async (path) => {
      window.history.replaceState({}, "", path);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      });
      expect(screen.getByText("vault surface blew up")).toBeInTheDocument();
      expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /back to notes/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /reload/i })).not.toBeInTheDocument();
    },
  );

  it("contains the session-resolved BootGate home branch without a local vault", async () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    window.history.replaceState({}, "", "/");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
    expect(accountMocks.resolveBoot).toHaveBeenCalledWith({ hasLocalActiveVault: false });
    expect(screen.getByText("vault surface blew up")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to notes/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reload/i })).not.toBeInTheDocument();
  });
});
