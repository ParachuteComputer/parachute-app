import { BoardView } from "@/components/views/BoardView";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { DEFAULT_TAG_ROLES } from "@/lib/vault/tag-roles";
import type { Note } from "@/lib/vault/types";
import { NOTE_DRAG_MIME } from "@/lib/views/dnd";
import { makeDataTransfer, stubPointer } from "@/test/dnd";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Desktop drag on the board (views train E) — drag a card between lanes with a
// real pointer, same write as tap-to-move. Same harness as BoardView.test.tsx
// (a real QueryClient over the exact cache key the move writes, vault PATCH
// stubbed at fetch); jsdom has no DataTransfer/matchMedia, so both are
// synthesized (src/test/dnd.ts). The shipped Move-menu path has its own suite
// (BoardView.test.tsx, untouched) — this file only covers the drag gesture.

const VIEW_KEY = ["viewResults", "dev", "v1", "tag=project"] as const;

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
        addedAt: "2026-07-01T00:00:00.000Z",
        lastUsedAt: "2026-07-01T00:00:00.000Z",
      },
    },
    activeVaultId: "dev",
  });
  localStorage.setItem(
    "lens:token:dev",
    JSON.stringify({ accessToken: "pvt_abc", scope: "full", vault: "default" }),
  );
}

// A PATCH stub echoing the merged note (ok), or a failing PATCH (throws in the
// client → the move rolls back). Any GET returns [] so no stray fetch 500s.
function installFetch(patchOk: boolean) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PATCH") {
      const body = JSON.parse((init?.body as string) ?? "{}");
      return {
        ok: patchOk,
        status: patchOk ? 200 : 500,
        json: async () => ({
          id: url.split("/").pop(),
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-22T12:00:00Z",
          ...body,
        }),
        text: async () => "",
      } as Response;
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "" } as Response;
  });
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

// A board that reads its notes from the SAME cache key the move writes — the
// production wiring (ViewSurface → useViewResults → BoardView), in miniature.
function Board({ initial, laneBy }: { initial: Note[]; laneBy: string }) {
  const { data } = useQuery<Note[]>({
    queryKey: VIEW_KEY as unknown as string[],
    queryFn: async () => initial,
    initialData: initial,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <BoardView
      notes={data ?? []}
      laneBy={laneBy}
      roles={DEFAULT_TAG_ROLES}
      viewResultsKey={VIEW_KEY as unknown as string[]}
    />
  );
}

function renderBoard(initial: Note[], laneBy: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Board initial={initial} laneBy={laneBy} />
      </BrowserRouter>
    </QueryClientProvider>,
  );
  return qc;
}

function note(id: string, metadata: Record<string, unknown>): Note {
  return {
    id,
    path: `proj-${id}`,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-10T00:00:00Z",
    metadata,
  } as Note;
}

// The `.relative` wrapper NoteCard puts around a board card — with drag
// active it is the drag SOURCE (draggable, carries the handlers).
function cardWrapper(title: string): HTMLElement {
  const el = screen.getByText(title).closest("div.relative");
  if (!el) throw new Error(`no card wrapper for "${title}"`);
  return el as HTMLElement;
}

function laneSection(label: string): HTMLElement {
  return screen.getByRole("region", { name: label });
}

function patchCalls(fetchImpl: ReturnType<typeof installFetch>) {
  return fetchImpl.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PATCH");
}

/** Drag `title`'s card and drop it on `lane` — the full event sequence. */
function dragCardToLane(title: string, lane: HTMLElement) {
  const dt = makeDataTransfer();
  const wrapper = cardWrapper(title);
  fireEvent.dragStart(wrapper, { dataTransfer: dt });
  fireEvent.dragEnter(lane, { dataTransfer: dt });
  fireEvent.dragOver(lane, { dataTransfer: dt });
  fireEvent.drop(lane, { dataTransfer: dt });
  fireEvent.dragEnd(wrapper, { dataTransfer: dt });
  return dt;
}

describe("BoardView desktop drag", () => {
  let restorePointer: () => void;

  beforeEach(() => {
    restorePointer = stubPointer("fine");
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.getState().clear();
    seedStore();
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    restorePointer();
    vi.unstubAllGlobals();
  });

  it("drags a card to another lane: optimistic re-lane + PATCH { [laneBy]: value } + toast", async () => {
    const fetchImpl = installFetch(true);
    renderBoard([note("a", { status: "active" }), note("b", { status: "done" })], "status");

    expect(within(laneSection("active")).getByText("proj-a")).toBeInTheDocument();

    const dt = dragCardToLane("proj-a", laneSection("done"));
    // The drag carried the note id under the custom MIME type.
    expect(dt.getData(NOTE_DRAG_MIME)).toBe("a");

    await waitFor(() => {
      expect(within(laneSection("done")).getByText("proj-a")).toBeInTheDocument();
    });
    expect(screen.queryByRole("region", { name: "active" })).toBeNull();

    const patches = patchCalls(fetchImpl);
    expect(patches).toHaveLength(1);
    const body = JSON.parse(((patches[0]![1] as RequestInit).body as string) ?? "{}");
    expect(body.metadata).toEqual({ status: "done" });
    expect(body.if_updated_at).toBe("2026-07-10T00:00:00Z");

    // The microconfirmation — same toast the Move menu produces.
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.some((t) => t.tone === "success" && t.message === "✓ status → done")).toBe(
        true,
      );
    });
  });

  it("preserves the lane value's TYPE — dropping on an integer lane writes a number", async () => {
    const fetchImpl = installFetch(true);
    renderBoard([note("a", { priority: 1 }), note("b", { priority: 3 })], "priority");

    dragCardToLane("proj-a", laneSection("3"));

    await waitFor(() => {
      expect(within(laneSection("3")).getByText("proj-a")).toBeInTheDocument();
    });
    const body = JSON.parse(((patchCalls(fetchImpl)[0]![1] as RequestInit).body as string) ?? "{}");
    expect(body.metadata).toEqual({ priority: 3 });
    expect(typeof body.metadata.priority).toBe("number");
  });

  it("dropping on the 'No status' lane writes null (null-as-delete)", async () => {
    const fetchImpl = installFetch(true);
    renderBoard([note("a", { status: "active" }), note("b", {})], "status");

    dragCardToLane("proj-a", laneSection("No status"));

    await waitFor(() => {
      expect(within(laneSection("No status")).getByText("proj-a")).toBeInTheDocument();
    });
    const body = JSON.parse(((patchCalls(fetchImpl)[0]![1] as RequestInit).body as string) ?? "{}");
    expect(body.metadata).toEqual({ status: null });
  });

  it("dropping a card on its OWN lane is a no-op — no write, no toast", async () => {
    const fetchImpl = installFetch(true);
    renderBoard([note("a", { status: "active" }), note("b", { status: "done" })], "status");

    dragCardToLane("proj-a", laneSection("active"));

    await new Promise((r) => setTimeout(r, 25));
    expect(patchCalls(fetchImpl)).toHaveLength(0);
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(within(laneSection("active")).getByText("proj-a")).toBeInTheDocument();
  });

  it("shows the drop affordance while a note drag hovers a lane, and clears it on leave", () => {
    installFetch(true);
    renderBoard([note("a", { status: "active" }), note("b", { status: "done" })], "status");

    const dt = makeDataTransfer();
    fireEvent.dragStart(cardWrapper("proj-a"), { dataTransfer: dt });

    const lane = laneSection("done");
    expect(lane.className).not.toContain("outline-accent/50");
    fireEvent.dragEnter(lane, { dataTransfer: dt });
    expect(lane.className).toContain("outline-accent/50");
    // dragover on a valid target is preventDefault'ed (that's what permits the
    // drop) — fireEvent returns false when the default was prevented.
    expect(fireEvent.dragOver(lane, { dataTransfer: dt })).toBe(false);
    fireEvent.dragLeave(lane, { dataTransfer: dt });
    expect(lane.className).not.toContain("outline-accent/50");
  });

  it("ignores a foreign drag (no note MIME): no affordance, no write", async () => {
    const fetchImpl = installFetch(true);
    renderBoard([note("a", { status: "active" }), note("b", { status: "done" })], "status");

    const dt = makeDataTransfer();
    dt.setData("text/plain", "just some text");

    const lane = laneSection("done");
    fireEvent.dragEnter(lane, { dataTransfer: dt });
    expect(lane.className).not.toContain("outline-accent/50");
    // Not preventDefault'ed — the lane never becomes a drop target for it.
    expect(fireEvent.dragOver(lane, { dataTransfer: dt })).toBe(true);
    fireEvent.drop(lane, { dataTransfer: dt });

    await new Promise((r) => setTimeout(r, 25));
    expect(patchCalls(fetchImpl)).toHaveLength(0);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("suppresses the residue click after a drag — a drop never navigates", async () => {
    installFetch(true);
    renderBoard([note("a", { status: "active" }), note("b", { status: "done" })], "status");

    const dt = makeDataTransfer();
    const wrapper = cardWrapper("proj-a");
    fireEvent.dragStart(wrapper, { dataTransfer: dt });
    fireEvent.dragEnd(wrapper, { dataTransfer: dt });

    // The residue click browsers fire right after dragend, before timers run.
    fireEvent.click(within(wrapper).getByRole("link"));
    expect(window.location.pathname).toBe("/");

    // …but the NEXT real click (after the suppression window) navigates.
    await new Promise((r) => setTimeout(r, 25));
    fireEvent.click(within(cardWrapper("proj-a")).getByRole("link"));
    expect(window.location.pathname).toBe("/n/a");
  });

  it("renders NO drag affordance on a touch device — the tap path is untouched", () => {
    restorePointer();
    restorePointer = stubPointer("coarse");
    installFetch(true);
    renderBoard([note("a", { status: "active" }), note("b", { status: "done" })], "status");

    const wrapper = cardWrapper("proj-a");
    expect(wrapper.getAttribute("draggable")).toBeNull();
    expect(wrapper.className).not.toContain("cursor-grab");
    // The anchor keeps its default draggability attribute state (none).
    expect(within(wrapper).getByRole("link").getAttribute("draggable")).toBeNull();
    // Tap-to-move is still there.
    expect(within(wrapper).getByRole("button", { name: /move to another/i })).toBeInTheDocument();
  });
});
