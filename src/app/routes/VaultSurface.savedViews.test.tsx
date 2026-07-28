import { VaultSurface } from "@/app/routes/VaultSurface";
import { NavBandsProvider } from "@/lib/nav/model";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FetchState {
  notes: unknown[];
  tags: unknown[];
  views: unknown[];
}

function installFetch(state: FetchState) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PATCH" || method === "DELETE") {
      const id = url.match(/\/api\/notes\/([^?]+)/)?.[1] ?? "x";
      return {
        ok: true,
        status: 200,
        json: async () => ({ id, path: `UI/Views/${id}`, createdAt: "2026-04-26T00:00:00Z" }),
        text: async () => "",
      } as Response;
    }
    if (url.includes("/api/tags")) {
      return {
        ok: true,
        status: 200,
        json: async () => state.tags,
        text: async () => "",
      } as Response;
    }
    // Saved-views are filtered by `path_prefix=UI%2FViews%2F` on the request.
    const isViewsQuery = url.includes("path_prefix=UI%2FViews%2F");
    const body = isViewsQuery ? state.views : state.notes;
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => "",
    } as Response;
  });
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

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

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <NavBandsProvider>{children}</NavBandsProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

const viewNote = {
  id: "view-1",
  path: "UI/Views/Daily",
  createdAt: "2026-04-25T00:00:00Z",
  updatedAt: "2026-04-25T10:00:00Z",
  metadata: { kind: "saved-view", filters: { tags: ["journal"] } },
};

// A vault with at least one note — W2-11 hides the Filters disclosure (and
// with it the saved-views block) on a genuinely empty vault, so these tests
// need something in the list.
const plainNote = {
  id: "n1",
  path: "Journal/morning",
  tags: [],
  createdAt: "2026-04-25T09:00:00Z",
  updatedAt: "2026-04-25T09:00:00Z",
};

// The saved-views block lives inside the W2-11 "Filters" disclosure — open it
// the way a user would before reaching for the management menu.
async function openFilters() {
  fireEvent.click(await screen.findByRole("button", { name: /filters/i }));
  await screen.findByRole("region", { name: /^filters$/i });
}

// PR-B retired the per-row management menu (rename/update/delete) from this
// surface entirely — Aaron: "a Filters panel shouldn't also be a view
// manager." What's left is a quiet, apply-only "Saved filters" disclosure:
// closed by default, a plain link per view, absent completely when there's
// nothing to show. These tests replace the old "SavedViewsSidebar management
// menu" suite (each of whose five cases exercised a control that no longer
// exists on this surface).
describe("Saved filters disclosure (apply-only, PR-B)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    seedStore();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders a closed 'Saved filters' disclosure with no management menu anywhere", async () => {
    installFetch({ notes: [plainNote], tags: [], views: [viewNote] });

    render(<VaultSurface />, { wrapper: Wrapper });
    await openFilters();

    const summary = await screen.findByText("Saved filters");
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);

    // The retired affordances are gone, not just hidden-until-clicked.
    expect(screen.queryByRole("button", { name: /manage saved view/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /rename/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^delete$/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /update with current filters/i }),
    ).not.toBeInTheDocument();
  });

  it("opening the disclosure reveals the view as a plain link that loads it", async () => {
    installFetch({ notes: [plainNote], tags: [], views: [viewNote] });

    render(<VaultSurface />, { wrapper: Wrapper });
    await openFilters();

    const details = (await screen.findByText("Saved filters")).closest(
      "details",
    ) as HTMLDetailsElement;
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });

    const link = await screen.findByRole("link", { name: "Daily" });
    expect(link).toHaveAttribute("href", "/notes?tag=journal");
  });

  it("is absent entirely when there are no saved views — no persistent 'None yet' footer", async () => {
    installFetch({ notes: [plainNote], tags: [], views: [] });

    render(<VaultSurface />, { wrapper: Wrapper });
    await openFilters();

    // Give the saved-views query a tick to resolve before asserting absence.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Saved filters")).not.toBeInTheDocument();
  });

  it("clicking the saved-view link never issues a PATCH or DELETE — apply-only", async () => {
    const fetchImpl = installFetch({ notes: [plainNote], tags: [], views: [viewNote] });

    render(<VaultSurface />, { wrapper: Wrapper });
    await openFilters();
    const details = (await screen.findByText("Saved filters")).closest(
      "details",
    ) as HTMLDetailsElement;
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await screen.findByRole("link", { name: "Daily" });

    const mutating = fetchImpl.mock.calls.find(([, init]) =>
      ["PATCH", "DELETE"].includes((init as RequestInit | undefined)?.method ?? "GET"),
    );
    expect(mutating).toBeUndefined();
  });
});
