import { Home } from "@/app/routes/Home";
import { useVaultStore } from "@/lib/vault/store";
import type { Note } from "@/lib/vault/types";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FIX 2 (error-over-data): the phone-first PWA must never blank what you're
// reading because a background refetch failed. When the notes query is in an
// error state but still holds the previously-loaded notes, Home renders them
// (under a quiet offline ribbon) instead of the error block; the error block
// only shows when there is genuinely no cached data.
//
// This coverage used to live on the Today route's no-param front-door
// timeline; F8/W2-3 folded that timeline into Home (Today's `/today` no-param
// case is now a redirect shim — see DayView.test.tsx), so the test moved with
// the behavior it exercises.
//
// react-query's observer almost never surfaces `isError: true` WITH `data`
// present on its own (a same-key refetch failure stays `status: success`),
// so we assert the RENDERING CONTRACT directly by driving the data hook into
// the exact `{ isError, data }` combinations the route must handle.
const { mockDateViews } = vi.hoisted(() => ({ mockDateViews: vi.fn() }));

vi.mock("@/lib/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault")>();
  return { ...actual, useNotesForDateViews: () => mockDateViews() };
});

const KEPT_NOTE: Note = {
  id: "n1",
  path: "journal/kept.md",
  preview: "Saved locally.",
  createdAt: "2026-04-18T09:00:00Z",
  updatedAt: "2026-04-18T09:00:00Z",
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

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Home — error-over-data rendering (FIX 2)", () => {
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
    renderHome();

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
    renderHome();

    expect(screen.getByText(/couldn't load recent notes/i)).toBeInTheDocument();
    expect(screen.queryByText(/showing what's saved/i)).toBeNull();
  });
});
