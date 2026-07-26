import { VaultSurface } from "@/app/routes/VaultSurface";
import { NavBandsProvider } from "@/lib/nav/model";
import { useVaultStore } from "@/lib/vault/store";
import type { Note } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FIX 2 (error-over-data): the phone-first PWA must never blank what you're
// reading because a background refetch failed. When the notes query is in an
// error state but still holds the previously-loaded notes, the Recent lens
// renders them (under a quiet offline ribbon) instead of the error block; the
// error block only shows when there is genuinely no cached data.
//
// This coverage used to live on the Today route's no-param front-door
// timeline; F8/W2-3 folded that timeline into Home, and LZ-4 dissolved Home
// into VaultSurface's Recent lens — the test moved with the behavior it
// exercises both times.
//
// react-query's observer almost never surfaces `isError: true` WITH `data`
// present on its own (a same-key refetch failure stays `status: success`),
// so we assert the RENDERING CONTRACT directly by driving the data hook into
// the exact `{ isError, data }` combinations the lens must handle.
const { mockDateViews } = vi.hoisted(() => ({ mockDateViews: vi.fn() }));

vi.mock("@/lib/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault")>();
  return { ...actual, useNotesForDateViews: () => mockDateViews() };
});

// Stamped RELATIVE to now: the Recent floor (14 days) would age a fixed date
// out of the window and turn the kept-note case into the dormant line.
const KEPT_NOTE: Note = {
  id: "n1",
  path: "journal/kept.md",
  preview: "Saved locally.",
  createdAt: new Date(Date.now() - 3600_000).toISOString(),
  updatedAt: new Date(Date.now() - 3600_000).toISOString(),
};

function seedStore() {
  useVaultStore.setState({
    vaults: {
      v1: {
        id: "v1",
        url: "http://localhost:1940",
        name: "default",
        issuer: "http://localhost:1940",
        clientId: "c",
        scope: "full",
        addedAt: "2026-04-18T00:00:00.000Z",
        lastUsedAt: "2026-04-18T00:00:00.000Z",
      },
    },
    activeVaultId: "v1",
  });
}

function renderRecent() {
  // The notes hook is mocked above, but the lens's trial-ambience summary
  // hook (W2-8) is a real useQuery — it needs a client in context even while
  // disabled (the seed vault's OAuth clientId keeps it disabled here).
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <QueryClientProvider client={qc}>
        <NavBandsProvider>
          <Routes>
            <Route path="/" element={<VaultSurface lens="recent" />} />
          </Routes>
        </NavBandsProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("VaultSurface Recent lens — error-over-data rendering (FIX 2)", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
    mockDateViews.mockReset();
  });
  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("keeps the timeline on screen (under an offline ribbon) when errored but data is cached", () => {
    mockDateViews.mockReturnValue({
      data: [KEPT_NOTE],
      isPending: false,
      isError: true,
      error: new Error("offline"),
    });
    renderRecent();

    expect(screen.getByText("kept")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load recent notes/i)).toBeNull();
    expect(screen.getByText(/showing what's saved/i)).toBeInTheDocument();
  });

  it("shows the error block (no ribbon) when errored with no cached data", () => {
    mockDateViews.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("offline"),
    });
    renderRecent();

    expect(screen.getByText(/couldn't load recent notes/i)).toBeInTheDocument();
    expect(screen.queryByText(/showing what's saved/i)).toBeNull();
  });
});
