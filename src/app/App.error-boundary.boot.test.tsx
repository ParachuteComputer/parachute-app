import { App } from "@/app/App";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/routes/Landing", () => ({
  Landing: () => {
    throw new Error("landing blew up");
  },
}));

vi.mock("@/app/routes/VaultSurface", () => ({
  VaultSurface: () => <div>Notes recovered</div>,
}));

describe("RouteErrorBoundary around the boot front door", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    window.history.replaceState({}, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("{}", { status: 404 })),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("contains a Landing render failure without taking down the surrounding shell", async () => {
    render(<App />);

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText("landing blew up")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reload/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /back to notes/i }));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/notes");
    });
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    expect(screen.getByText("Notes recovered")).toBeInTheDocument();
    expect(screen.getByText(/AGPL-3\.0/)).toBeInTheDocument();
  });
});
