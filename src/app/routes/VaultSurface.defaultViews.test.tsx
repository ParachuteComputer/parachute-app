// VIEWS-RENDER-SPEC §7, wave 2a: the Pinned/Archive default pages resolve
// their tag filter from a ViewDef (a Views/Pinned or Views/Archive pack
// note, when present and well-formed; the app's built-in def otherwise)
// instead of a hardcoded literal. This file pins the three behaviors that
// matter: no pack note behaves exactly like today (regression pin), a pack
// note's query wins when it's there, and a malformed pack note degrades to
// the built-in rather than blanking a default page. Everything else about
// these presets (search, Filters panel, pagination) is unchanged and stays
// covered by VaultSurface.test.tsx.
import { VaultSurface } from "@/app/routes/VaultSurface";
import { NavBandsProvider } from "@/lib/nav/model";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FetchState {
  notes: unknown[];
  tags: unknown[];
  /** The note (if any) living at the queried default-page path (Views/Pinned or Views/Archive). */
  packNote?: unknown;
}

function installFetch(state: FetchState) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/tags")) {
      return jsonResponse(state.tags);
    }
    // The default-view resolution lookup (`useDefaultViewDef`) queries the
    // pack's canonical EXACT path — distinct from the main list's `tag=`
    // query and from the saved-views sidebar's `path_prefix=UI%2FViews%2F`.
    if (url.includes("path=Views%2FPinned") || url.includes("path=Views%2FArchive")) {
      return jsonResponse(state.packNote ? [state.packNote] : []);
    }
    if (url.includes("path_prefix=UI%2FViews%2F") || url.includes("limit=5000")) {
      return jsonResponse([]);
    }
    return jsonResponse(state.notes);
  });
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => "",
  } as Response;
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
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <NavBandsProvider>{children}</NavBandsProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/**
 * The main list query's outgoing URL — excludes the default-view-pack
 * lookup (`path=Views%2F…`), the saved-views sidebar's own query
 * (`path_prefix=UI%2FViews%2F`, fired unconditionally by `useSavedViews`
 * regardless of preset), the capped path-tree window (`limit=5000`), the nav
 * model's view-list (`tag=view` — gated on tag-roles, so it can land AFTER
 * the list fetch), and the nav model's bounded first-note probe
 * (`exclude_tag=guide`, use-has-user-note.ts). Mirrors `lastNotesUrl` in
 * VaultSurface.test.tsx.
 */
function lastListQueryUrl(fetchImpl: ReturnType<typeof installFetch>): string {
  const calls = fetchImpl.mock.calls.map((c) => String(c[0]));
  const listCalls = calls.filter(
    (u) =>
      u.includes("/api/notes") &&
      !u.includes("path=Views%2F") &&
      !u.includes("path_prefix=UI%2FViews%2F") &&
      !u.includes("limit=5000") &&
      !u.includes("tag=view&") &&
      !u.includes("exclude_tag=guide"),
  );
  return listCalls[listCalls.length - 1] ?? "";
}

describe("VaultSurface default-page cutover (Pinned/Archive resolve a ViewDef)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("no Views/Pinned pack note — resolves the built-in def, byte-equivalent to today's hardcoded tag", async () => {
    const fetchImpl = installFetch({ notes: [], tags: [] });
    render(<VaultSurface preset="pinned" />, { wrapper: Wrapper });

    // The lookup fires (proves the new resolution path runs)...
    await waitFor(() => {
      expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes("path=Views%2FPinned"))).toBe(
        true,
      );
    });
    // ...and the main list query still lands on exactly today's tag filter.
    await waitFor(() => {
      expect(lastListQueryUrl(fetchImpl)).toContain("tag=pinned");
    });
  });

  it("no Views/Archive pack note — resolves the built-in def, byte-equivalent to today's hardcoded tag", async () => {
    const fetchImpl = installFetch({ notes: [], tags: [] });
    render(<VaultSurface preset="archived" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(lastListQueryUrl(fetchImpl)).toContain("tag=archived");
    });
  });

  it("a well-formed Views/Pinned pack note wins — the page queries the pack's tag, not the built-in one", async () => {
    const fetchImpl = installFetch({
      notes: [],
      tags: [],
      packNote: {
        id: "pack-pinned",
        path: "Views/Pinned",
        tags: ["view"],
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
        metadata: { kind: "list", query: JSON.stringify({ tag: "urgent" }) },
      },
    });
    render(<VaultSurface preset="pinned" />, { wrapper: Wrapper });

    await waitFor(() => {
      const url = lastListQueryUrl(fetchImpl);
      expect(url).toContain("tag=urgent");
      expect(url).not.toContain("tag=pinned");
    });
  });

  it("a malformed Views/Archive pack note falls back to the built-in def — no blank page", async () => {
    const fetchImpl = installFetch({
      notes: [
        {
          id: "n1",
          path: "Somewhere/note",
          preview: "still here",
          tags: ["archived"],
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
      tags: [],
      packNote: {
        id: "pack-archive-broken",
        path: "Views/Archive",
        tags: ["view"],
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
        metadata: { kind: "list", query: "{not valid json" },
      },
    });
    render(<VaultSurface preset="archived" />, { wrapper: Wrapper });

    // Falls back to the built-in tag filter...
    await waitFor(() => {
      expect(lastListQueryUrl(fetchImpl)).toContain("tag=archived");
    });
    // ...and the page actually renders the note, not a blank/error state.
    expect(await screen.findByText("Somewhere/note")).toBeInTheDocument();
  });

  it("a pack note at the canonical path that isn't tagged #view is ignored", async () => {
    const fetchImpl = installFetch({
      notes: [],
      tags: [],
      packNote: {
        id: "decoy",
        path: "Views/Pinned",
        tags: ["project"],
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
        metadata: { kind: "list", query: JSON.stringify({ tag: "urgent" }) },
      },
    });
    render(<VaultSurface preset="pinned" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(lastListQueryUrl(fetchImpl)).toContain("tag=pinned");
    });
  });
});
