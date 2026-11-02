/**
 * The settings fetch on every vault page load (snag #20b). A vault that has
 * never written its settings note must not produce a failing request: the
 * single-note `GET /api/notes?id=` form answers 404 for an absent note (that's
 * the vault contract on both doors), and the browser logs every 404 in the
 * console. The fetch asks with the `path=` list filter, which answers `[]`.
 *
 * The fake vault below follows the real contract for both forms, so the test
 * drives the hook's real VaultClient over `fetch`.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_NOTE_PATH, useVaultSettings } from "./settings";
import { saveToken } from "./storage";
import { useVaultStore } from "./store";
import type { VaultRecord } from "./types";

const VAULT_URL = "https://example.test/vault/garden-notes";

function seedVault() {
  const v: VaultRecord = {
    id: "garden-notes",
    url: VAULT_URL,
    name: "garden-notes",
    issuer: "https://example.test",
    clientId: "cid",
    scope: "full",
    addedAt: "2026-01-01T00:00:00Z",
    lastUsedAt: "2026-01-01T00:00:00Z",
  };
  useVaultStore.setState({ vaults: { [v.id]: v }, activeVaultId: v.id });
  saveToken(v.id, { accessToken: "tok", scope: "full", vault: v.url });
}

// GET /api/notes the way the vault answers it: `?id=` is the single-note form
// (404 when absent), `?path=` is an exact-path list filter (`[]` when absent).
function fakeVault(notes: Array<Record<string, unknown>>) {
  const statuses: Array<{ url: string; status: number }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    let status = 200;
    let body: unknown = [];
    if (url.pathname.endsWith("/api/notes")) {
      const id = url.searchParams.get("id");
      const path = url.searchParams.get("path");
      if (id !== null) {
        const hit = notes.find((n) => n.id === id || n.path === id);
        status = hit ? 200 : 404;
        body = hit ?? { error: "Note not found", error_type: "not_found", id };
      } else if (path !== null) {
        body = notes.filter((n) => String(n.path).toLowerCase() === path.toLowerCase());
      }
    }
    statuses.push({ url: url.toString(), status });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetchMock, statuses };
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useVaultSettings fetch (snag #20b)", () => {
  beforeEach(() => {
    localStorage.clear();
    seedVault();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  it("a vault with no settings note loads with defaults and no failing request", async () => {
    const { fetchMock, statuses } = fakeVault([]);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useVaultSettings("garden-notes"), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("synced"));

    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.filter((s) => s.status >= 400)).toEqual([]);
    expect(result.current.settings.tagRoles.pinned).toBe("pinned");
  });

  it("a vault with a settings note still reads it", async () => {
    const { fetchMock, statuses } = fakeVault([
      {
        id: "n-settings",
        path: SETTINGS_NOTE_PATH,
        content: "",
        tags: [],
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-02T00:00:00Z",
        metadata: { notes: { schemaVersion: 1, tagRoles: { pinned: "starred" } } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useVaultSettings("garden-notes"), { wrapper });
    await waitFor(() => expect(result.current.settings.tagRoles.pinned).toBe("starred"));
    expect(result.current.status).toBe("synced");
    expect(statuses.filter((s) => s.status >= 400)).toEqual([]);
  });
});
