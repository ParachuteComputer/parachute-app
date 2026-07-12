import { Export } from "@/app/routes/Export";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function seedStore() {
  useVaultStore.setState({
    vaults: {
      dev: {
        id: "dev",
        url: "http://localhost:1940",
        name: "dev",
        issuer: "http://localhost:1940",
        clientId: "client-test",
        scope: "full",
        addedAt: "2026-04-18T00:00:00.000Z",
        lastUsedAt: "2026-04-18T00:00:00.000Z",
      },
    },
    activeVaultId: "dev",
  });
  localStorage.setItem(
    "lens:token:dev",
    JSON.stringify({ accessToken: "pvt_abc", scope: "full", vault: "default" }),
  );
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/export"]}>
      <Routes>
        <Route path="/export" element={<Export />} />
        <Route path="/" element={<div>HomePage</div>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: Wrapper },
  );
}

describe("Export route", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    seedStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the export page with the active vault name and the primary action", () => {
    renderRoute();
    expect(screen.getByText(/Export notes from/i)).toBeInTheDocument();
    expect(screen.getByText("dev")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export my vault/i })).toBeInTheDocument();
  });

  it("redirects home when no vault is active", () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    renderRoute();
    expect(screen.getByText("HomePage")).toBeInTheDocument();
  });

  it("GETs /api/export with the vault's bearer token and triggers a browser download", async () => {
    const tarBlob = new Blob(["tar-bytes"], { type: "application/x-tar" });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toBe("http://localhost:1940/api/export");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer pvt_abc");
      return {
        ok: true,
        status: 200,
        blob: async () => tarBlob,
        text: async () => "",
        headers: new Headers(),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchImpl);

    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") el.click = clickSpy;
      return el;
    });

    renderRoute();
    fireEvent.click(screen.getByRole("button", { name: /export my vault/i }));

    // Honest loading state — no fake progress, just the one label.
    expect(await screen.findByText(/preparing your export/i)).toBeInTheDocument();

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(tarBlob);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    // Back to the idle label once the download fires.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /export my vault/i })).toBeInTheDocument(),
    );
  });

  // The self-hosted bun vault has no HTTP export route today (CLI-only) —
  // it answers a plain 404. This must render distinctly from a network
  // failure, with the CLI pointer, not a blanket "try again."
  it("shows the self-host CLI note on a 404, not a generic error", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: false,
          status: 404,
          blob: async () => new Blob([]),
          text: async () => JSON.stringify({ error: "Not found" }),
          headers: new Headers(),
        }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchImpl);

    renderRoute();
    fireEvent.click(screen.getByRole("button", { name: /export my vault/i }));

    expect(
      await screen.findByText(/export over the web isn't available on this vault yet/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/parachute-vault export/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't reach your vault/i)).not.toBeInTheDocument();
  });

  it("shows the honest network-error state on an unreachable vault", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchImpl);

    renderRoute();
    fireEvent.click(screen.getByRole("button", { name: /export my vault/i }));

    expect(await screen.findByText(/couldn't reach your vault — try again/i)).toBeInTheDocument();
  });
});
