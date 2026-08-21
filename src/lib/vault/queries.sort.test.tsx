import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAllNotesForSwitcher, useAllNotesWithLinks } from "./queries";
import { saveToken } from "./storage";
import { useVaultStore } from "./store";

// A4-SPEC.md rider R1: useAllNotesForSwitcher (Cmd+K) and useAllNotesWithLinks
// (the graph) both send a hard `limit` with no explicit `sort` — the vault's
// default is created_at ASC, so a vault past VAULT_GRAPH_NOTE_CAP silently
// drops the NEWEST notes instead of the oldest. Asserts the real fetch URL
// (not a mocked queryNotes) carries `sort=desc`, matching the other
// capped-window query (`useNotesForPathTree`).
function wrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  return ({ children }) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("capped-window queries send an explicit sort", () => {
  let fetchedUrls: string[];

  beforeEach(() => {
    localStorage.clear();
    fetchedUrls = [];
    useVaultStore.setState({
      vaults: {
        v1: {
          id: "v1",
          url: "https://example.test",
          name: "Test",
          issuer: "https://example.test",
          clientId: "cid",
          scope: "full",
          addedAt: "2026-01-01T00:00:00Z",
          lastUsedAt: "2026-01-01T00:00:00Z",
        },
      },
      activeVaultId: "v1",
    });
    saveToken("v1", { accessToken: "tok", scope: "full", vault: "https://example.test" });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        fetchedUrls.push(url.toString());
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("useAllNotesForSwitcher requests sort=desc", async () => {
    const { result } = renderHook(() => useAllNotesForSwitcher(true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = fetchedUrls.find((u) => u.includes("/api/notes"));
    expect(url).toBeDefined();
    expect(new URL(url as string).searchParams.get("sort")).toBe("desc");
  });

  it("useAllNotesWithLinks requests sort=desc", async () => {
    const { result } = renderHook(() => useAllNotesWithLinks(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = fetchedUrls.find((u) => u.includes("/api/notes"));
    expect(url).toBeDefined();
    expect(new URL(url as string).searchParams.get("sort")).toBe("desc");
  });
});
