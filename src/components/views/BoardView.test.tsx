import { BoardView } from "@/components/views/BoardView";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { DEFAULT_TAG_ROLES } from "@/lib/vault/tag-roles";
import type { Note } from "@/lib/vault/types";
import type { ResolvedField } from "@/lib/views/fields";
import { stubPointer } from "@/test/dnd";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Editable kanban — tap-to-move (view-experience wave, slice 1). Drives the
// board through a real QueryClient so the optimistic `["viewResults", …]` write
// re-lanes the card the same way it does in the app: a small `useQuery` stands
// in for `useViewResults`, feeding BoardView from the very cache key the move
// writes. The vault PATCH is stubbed at `fetch` (VaultClient uses global fetch),
// so we can read the exact wire payload and drive the success / failure paths.

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
// client → the move rolls back). A GET for a tag-identity row serves
// `tagRecord` when provided (the declared-enum path, polish V4); any other
// GET returns [] so no stray fetch 500s.
function installFetch(patchOk: boolean, tagRecord?: Record<string, unknown>) {
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
    if (tagRecord && url.includes("/tags/")) {
      return {
        ok: true,
        status: 200,
        json: async () => tagRecord,
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
function Board({
  initial,
  laneBy,
  subjectTag,
  fields,
}: {
  initial: Note[];
  laneBy: string;
  subjectTag?: string;
  fields?: ResolvedField[];
}) {
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
      subjectTag={subjectTag}
      roles={DEFAULT_TAG_ROLES}
      viewResultsKey={VIEW_KEY as unknown as string[]}
      fields={fields}
    />
  );
}

function renderBoard(
  initial: Note[],
  laneBy: string,
  subjectTag?: string,
  fields?: ResolvedField[],
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Board initial={initial} laneBy={laneBy} subjectTag={subjectTag} fields={fields} />
      </BrowserRouter>
    </QueryClientProvider>,
  );
  return qc;
}

// The `.relative` wrapper NoteCard puts around a board card + its Move overlay.
function cardFor(title: string): HTMLElement {
  const el = screen.getByText(title).closest("div.relative");
  if (!el) throw new Error(`no card wrapper for "${title}"`);
  return el as HTMLElement;
}

function openMoveMenu(title: string): HTMLElement {
  const card = cardFor(title);
  fireEvent.click(within(card).getByRole("button", { name: /move to another/i }));
  return card;
}

function laneSection(label: string): HTMLElement {
  return screen.getByRole("region", { name: label });
}

describe("BoardView tap-to-move", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.getState().clear();
    seedStore();
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("moves a card to the chosen lane optimistically and PATCHes { [laneBy]: value }", async () => {
    const fetchImpl = installFetch(true);
    renderBoard(
      [
        {
          id: "a",
          path: "proj-a",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-10T00:00:00Z",
          metadata: { status: "active" },
        },
        {
          id: "b",
          path: "proj-b",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-10T00:00:00Z",
          metadata: { status: "done" },
        },
      ],
      "status",
    );

    // Card "proj-a" starts in the active lane.
    expect(within(laneSection("active")).getByText("proj-a")).toBeInTheDocument();

    const card = openMoveMenu("proj-a");
    fireEvent.click(within(card).getByRole("menuitem", { name: "done" }));

    // Optimistic: proj-a is now in the done lane (and active lane emptied away).
    await waitFor(() => {
      expect(within(laneSection("done")).getByText("proj-a")).toBeInTheDocument();
    });
    expect(screen.queryByRole("region", { name: "active" })).toBeNull();

    // The wire write moved exactly one field with the string value.
    const patch = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === "PATCH",
    );
    expect(patch).toBeDefined();
    const body = JSON.parse(((patch![1] as RequestInit).body as string) ?? "{}");
    expect(body.metadata).toEqual({ status: "done" });
    expect(body.if_updated_at).toBe("2026-07-10T00:00:00Z");
  });

  it("preserves the value TYPE — moving between integer lanes writes a number, not '3'", async () => {
    const fetchImpl = installFetch(true);
    renderBoard(
      [
        {
          id: "a",
          path: "proj-a",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-10T00:00:00Z",
          metadata: { priority: 1 },
        },
        {
          id: "b",
          path: "proj-b",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-10T00:00:00Z",
          metadata: { priority: 3 },
        },
      ],
      "priority",
    );

    const card = openMoveMenu("proj-a");
    fireEvent.click(within(card).getByRole("menuitem", { name: "3" }));

    await waitFor(() => {
      expect(within(laneSection("3")).getByText("proj-a")).toBeInTheDocument();
    });
    const patch = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === "PATCH",
    );
    const body = JSON.parse(((patch![1] as RequestInit).body as string) ?? "{}");
    expect(body.metadata).toEqual({ priority: 3 });
    expect(typeof body.metadata.priority).toBe("number");
  });

  it("moving to the 'No status' lane writes null (null-as-delete)", async () => {
    const fetchImpl = installFetch(true);
    renderBoard(
      [
        {
          id: "a",
          path: "proj-a",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-10T00:00:00Z",
          metadata: { status: "active" },
        },
        {
          id: "b",
          path: "proj-b",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-10T00:00:00Z",
          metadata: {},
        },
      ],
      "status",
    );

    const card = openMoveMenu("proj-a");
    fireEvent.click(within(card).getByRole("menuitem", { name: "No status" }));

    await waitFor(() => {
      expect(within(laneSection("No status")).getByText("proj-a")).toBeInTheDocument();
    });
    const patch = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === "PATCH",
    );
    const body = JSON.parse(((patch![1] as RequestInit).body as string) ?? "{}");
    expect(body.metadata).toEqual({ status: null });
  });

  it("lane heads carry the lane value's stable hue swatch; the uncategorized lane stays dotless (polish V2)", () => {
    installFetch(true);
    renderBoard(
      [
        {
          id: "a",
          path: "proj-a",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-10T00:00:00Z",
          metadata: { status: "active" },
        },
        {
          id: "b",
          path: "proj-b",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-10T00:00:00Z",
          metadata: { status: "done" },
        },
        {
          id: "c",
          path: "proj-c",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-10T00:00:00Z",
          metadata: {},
        },
      ],
      "status",
    );

    // Hand-assigned hues ride the lane heads: active → sun, done → grass.
    expect(laneSection("active").querySelector("header .tint-dot")).toHaveClass("tint-sun");
    expect(laneSection("done").querySelector("header .tint-dot")).toHaveClass("tint-grass");
    // The uncategorized lane has no value — no swatch.
    expect(laneSection("No status").querySelector("header .tint-dot")).toBeNull();
  });

  it("rolls back to the original lane and toasts when the write fails", async () => {
    installFetch(false); // PATCH → 500 → client throws
    renderBoard(
      [
        {
          id: "a",
          path: "proj-a",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-10T00:00:00Z",
          metadata: { status: "active" },
        },
        {
          id: "b",
          path: "proj-b",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-10T00:00:00Z",
          metadata: { status: "done" },
        },
      ],
      "status",
    );

    const card = openMoveMenu("proj-a");
    fireEvent.click(within(card).getByRole("menuitem", { name: "done" }));

    // After the failed write, the card is back in its original lane…
    await waitFor(() => {
      expect(within(laneSection("active")).getByText("proj-a")).toBeInTheDocument();
    });
    // …and an error toast explains why.
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.some((t) => t.tone === "error" && /couldn't move/i.test(t.message))).toBe(true);
    });
  });
});

// Polish V4: a schema-declared enum value renders a lane even with ZERO notes
// — the visible drop target an emptied column used to lose — and the empty
// body's affordance text follows the pointer class ("Drop here" invites a
// drag on desktop; touch has no drag, so it just states "No notes").
describe("BoardView empty declared lanes (polish V4)", () => {
  const TASK_TAG = {
    name: "task",
    fields: { status: { type: "string", enum: ["todo", "doing", "done"] } },
  };
  const NOTES: Note[] = [
    {
      id: "a",
      path: "task-a",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-10T00:00:00Z",
      metadata: { status: "todo" },
    },
  ];

  let restorePointer: (() => void) | null = null;

  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.getState().clear();
    seedStore();
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    restorePointer?.();
    restorePointer = null;
    vi.unstubAllGlobals();
  });

  it("renders declared-but-empty lanes, count 0, reading 'Drop here' on a fine pointer", async () => {
    restorePointer = stubPointer("fine");
    installFetch(true, TASK_TAG);
    renderBoard(NOTES, "status", "task");

    // The declared lanes appear once the tag schema resolves — including the
    // two values no note carries, in the authored enum order.
    const doing = await screen.findByRole("region", { name: "doing" });
    const done = laneSection("done");
    expect(within(doing).getByText("Drop here")).toBeInTheDocument();
    expect(within(done).getByText("Drop here")).toBeInTheDocument();
    expect(within(doing).getByText("0")).toBeInTheDocument();
    // The populated lane keeps its card — no affordance text.
    expect(within(laneSection("todo")).getByText("task-a")).toBeInTheDocument();
    expect(within(laneSection("todo")).queryByText("Drop here")).toBeNull();
  });

  it("reads 'No notes' on a coarse pointer (no drag there — just the fact)", async () => {
    restorePointer = stubPointer("coarse");
    installFetch(true, TASK_TAG);
    renderBoard(NOTES, "status", "task");

    const done = await screen.findByRole("region", { name: "done" });
    expect(within(done).getByText("No notes")).toBeInTheDocument();
    expect(within(done).queryByText("Drop here")).toBeNull();
  });
});

// The lane field's own chip (the on-ramp's companion fix). A board normally
// OMITS the lane field from the card's chip band because the Move control
// already owns it — but Move renders only when there's somewhere to move TO.
// With a lane field whose schema declares no enum, on a board where no note
// carries a value yet, there is exactly one (uncategorized) lane: no Move, and
// omitting the chip too left the card with no way to set that field's first
// value from the board at all. Reachable through the on-ramp's "Something
// else…" escape, which can mint a plain string lane field.
describe("BoardView lane-field chip fallback", () => {
  const LANE_FIELD: ResolvedField[] = [{ name: "stage", schema: { type: "string" } }];
  const UNSET: Note[] = [
    {
      id: "a",
      path: "task-a",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-10T00:00:00Z",
      metadata: {},
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.getState().clear();
    seedStore();
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("nowhere to move to → the lane field keeps its chip, so the first value is still settable", async () => {
    installFetch(true);
    renderBoard(UNSET, "stage", "task", LANE_FIELD);

    const card = cardFor("task-a");
    // Positive control: the dead-end condition really is in force.
    expect(within(card).queryByRole("button", { name: /move to another/i })).toBeNull();
    // …so the chip is the affordance that remains.
    expect(within(card).getByText("stage")).toBeInTheDocument();
  });

  it("with real lanes to move to, the chip stays omitted — Move owns the field (unchanged)", async () => {
    installFetch(true, {
      name: "task",
      fields: { stage: { type: "string", enum: ["one", "two"] } },
    });
    renderBoard(UNSET, "stage", "task", LANE_FIELD);

    await screen.findByRole("region", { name: "one" });
    const card = cardFor("task-a");
    expect(within(card).getByRole("button", { name: /move to another/i })).toBeInTheDocument();
    expect(within(card).queryByText("stage")).toBeNull();
  });
});
