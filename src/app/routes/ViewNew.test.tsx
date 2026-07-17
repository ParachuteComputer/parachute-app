import { ViewNew } from "@/app/routes/ViewNew";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The human creation path (VIEWS-RENDER-SPEC §6): "New view" creates a
// `#view` note at `Views/<name>` (kind list, empty query) and redirects
// into it as a view.

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
        addedAt: "2026-04-25T00:00:00.000Z",
        lastUsedAt: "2026-04-25T00:00:00.000Z",
      },
    },
    activeVaultId: "dev",
  });
  localStorage.setItem(
    "lens:token:dev",
    JSON.stringify({ accessToken: "pvt_abc", scope: "full", vault: "default" }),
  );
}

function LandedOnView() {
  const location = useLocation();
  return <div>landed on view {location.pathname}</div>;
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/views/new"]}>
        <Routes>
          <Route path="/views/new" element={children} />
          <Route path="/views/:id" element={<LandedOnView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ViewNew", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates a #view note at Views/<name> with kind list + empty query, then redirects into it", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if ((init?.method ?? "GET").toUpperCase() === "POST" && url.includes("/api/notes")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "new-id-123", createdAt: "2026-07-17T00:00:00Z", ...body }),
          text: async () => "",
        } as Response;
      }
      return { ok: true, status: 200, json: async () => [], text: async () => "" } as Response;
    });
    vi.stubGlobal("fetch", fetchImpl);

    render(<ViewNew />, { wrapper: ({ children }) => (<Wrapper>{children}</Wrapper>) as never });

    const input = await screen.findByLabelText(/^name$/i);
    fireEvent.change(input, { target: { value: "Active projects" } });
    fireEvent.click(screen.getByRole("button", { name: /create view/i }));

    await waitFor(() => {
      const post = fetchImpl.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST",
      );
      expect(post).toBeDefined();
      const body = JSON.parse((post?.[1] as RequestInit).body as string);
      expect(body.path).toBe("Views/Active projects");
      expect(body.tags).toEqual(["view"]);
      expect(body.metadata).toEqual({ kind: "list", query: "{}" });
    });

    await screen.findByText(/landed on view \/views\/new-id-123/);
  });
});
