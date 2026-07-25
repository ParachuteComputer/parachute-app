import { TableView } from "@/components/views/TableView";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { DEFAULT_TAG_ROLES } from "@/lib/vault/tag-roles";
import type { Note } from "@/lib/vault/types";
import type { ResolvedField } from "@/lib/views/fields";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The table lens (views train D) — columns from the resolved field set,
// click-to-edit cells. Same harness shape as BoardView.test.tsx: a real
// QueryClient so the optimistic `["viewResults", …]` write repaints the cell
// the way it does in the app, with the vault PATCH stubbed at `fetch` so we
// can read the exact wire payload.

const VIEW_KEY = ["viewResults", "dev", "v1", "tag=project"] as const;

const STATUS_FIELD: ResolvedField = {
  name: "status",
  schema: { type: "string", enum: ["active", "done"] },
};
const DUE_FIELD: ResolvedField = { name: "due", schema: { type: "date" } };

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

function installFetch(patchOk = true) {
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

// A table reading its notes from the SAME cache key a cell write targets —
// the production wiring (ViewSurface → useViewResults → TableView), in
// miniature.
function Table({ initial, fields }: { initial: Note[]; fields: ResolvedField[] }) {
  const { data } = useQuery<Note[]>({
    queryKey: VIEW_KEY as unknown as string[],
    queryFn: async () => initial,
    initialData: initial,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <TableView
      notes={data ?? []}
      roles={DEFAULT_TAG_ROLES}
      viewResultsKey={VIEW_KEY as unknown as string[]}
      fields={fields}
    />
  );
}

function renderTable(initial: Note[], fields: ResolvedField[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Table initial={initial} fields={fields} />
      </BrowserRouter>
    </QueryClientProvider>,
  );
  const rerenderWith = (nextFields: ResolvedField[]) =>
    utils.rerender(
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <Table initial={initial} fields={nextFields} />
        </BrowserRouter>
      </QueryClientProvider>,
    );
  return { qc, rerenderWith };
}

const NOTES: Note[] = [
  {
    id: "a",
    path: "proj-a",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-10T00:00:00Z",
    metadata: { status: "active", due: "2026-08-01" },
  },
  {
    id: "b",
    path: "proj-b",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-10T00:00:00Z",
    metadata: { status: "done" },
  },
];

function rowFor(title: string): HTMLElement {
  const el = screen.getByText(title).closest("tr");
  if (!el) throw new Error(`no row for "${title}"`);
  return el as HTMLElement;
}

describe("TableView", () => {
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

  it("columns come from the resolved field set, in order, after the title column — and react to a fields change", () => {
    installFetch();
    const { rerenderWith } = renderTable(NOTES, [STATUS_FIELD, DUE_FIELD]);

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Note", "status", "due"]);

    // The fields draft changed (reorder + drop) → the columns follow.
    rerenderWith([DUE_FIELD]);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Note", "due"]);
  });

  it("a cell edit commits through the shared hook: PATCH { [field]: value } + if_updated_at, microconfirm toast, optimistic repaint", async () => {
    const fetchImpl = installFetch(true);
    renderTable(NOTES, [STATUS_FIELD, DUE_FIELD]);

    const row = rowFor("proj-a");
    fireEvent.click(within(row).getByRole("button", { name: "Edit status" }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "done" }));

    // Optimistic: the cell now reads "done" (the viewResults cache repainted).
    await waitFor(() => {
      expect(
        within(rowFor("proj-a")).getByRole("button", { name: "Edit status" }).textContent,
      ).toBe("done");
    });

    // The wire write: exactly one field, with the optimistic-concurrency baseline.
    const patch = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === "PATCH",
    );
    expect(patch).toBeDefined();
    const body = JSON.parse(((patch![1] as RequestInit).body as string) ?? "{}");
    expect(body.metadata).toEqual({ status: "done" });
    expect(body.if_updated_at).toBe("2026-07-10T00:00:00Z");

    // The microconfirmation (views train A): a success toast naming the change.
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.some((t) => t.tone === "success" && t.message === "✓ status → done")).toBe(
        true,
      );
    });
  });

  it("the title cell is a navigating link to the note", () => {
    installFetch();
    renderTable(NOTES, [STATUS_FIELD]);

    const link = within(rowFor("proj-a")).getByRole("link", { name: /proj-a/ });
    expect(link).toHaveAttribute("href", "/n/a");
  });

  it("an empty cell shows the quiet — affordance; clicking it opens the editor", () => {
    installFetch();
    renderTable(NOTES, [STATUS_FIELD, DUE_FIELD]);

    // proj-b has no `due` — its cell trigger reads the dim placeholder.
    const row = rowFor("proj-b");
    const trigger = within(row).getByRole("button", { name: "Edit due" });
    expect(trigger.textContent).toBe("—");

    fireEvent.click(trigger);
    expect(within(row).getByRole("dialog", { name: "Edit due" })).toBeInTheDocument();
  });

  it("the table lives in a horizontal-scroll wrapper (the page body never scrolls sideways)", () => {
    installFetch();
    renderTable(NOTES, [STATUS_FIELD]);

    const table = screen.getByRole("table");
    expect(table.parentElement?.className).toContain("overflow-x-auto");
  });

  // Containment (polish V5) — the card around the scroll container, the soft
  // header band, and the sticky column's OPAQUE card-matched backgrounds.

  it("the scroll container sits inside a rounded card wrapper (border + bg-card + shadow)", () => {
    installFetch();
    renderTable(NOTES, [STATUS_FIELD]);

    const card = screen.getByRole("table").parentElement?.parentElement;
    for (const cls of ["rounded-xl", "border-border", "bg-card", "shadow-sm", "overflow-hidden"]) {
      expect(card?.className).toContain(cls);
    }
  });

  it("header cells read as the soft band — bg-bg-soft, uppercase micro-labels", () => {
    installFetch();
    renderTable(NOTES, [STATUS_FIELD]);

    for (const header of screen.getAllByRole("columnheader")) {
      for (const cls of ["bg-bg-soft", "text-2xs", "uppercase"]) {
        expect(header.className).toContain(cls);
      }
    }
  });

  it("sticky title cells carry backgrounds matching their surface — bg-bg-soft header, bg-card body (no bg-bg seam under horizontal scroll)", () => {
    installFetch();
    renderTable(NOTES, [STATUS_FIELD]);

    const noteHeader = screen.getByRole("columnheader", { name: "Note" });
    expect(noteHeader.className).toContain("sticky");
    expect(noteHeader.className).toContain("bg-bg-soft");

    const titleCell = within(rowFor("proj-a")).getByRole("rowheader");
    expect(titleCell.className).toContain("sticky");
    expect(titleCell.className).toContain("bg-card");
    // The old page background would seam against the card when rows slide
    // under the sticky column.
    expect(titleCell.className).not.toMatch(/(?:^|\s)bg-bg(?:\s|$)/);
  });

  it("rows separate with light hairlines, hover-tint, and the last row runs borderless into the card edge", () => {
    installFetch();
    renderTable(NOTES, [STATUS_FIELD]);

    const row = rowFor("proj-a");
    for (const cls of ["border-border-light", "hover:bg-bg-soft/60", "last:border-b-0"]) {
      expect(row.className).toContain(cls);
    }
  });

  it("rows carry data-note-id — the microconfirmation flash target", () => {
    installFetch();
    renderTable(NOTES, [STATUS_FIELD]);
    expect(rowFor("proj-a").getAttribute("data-note-id")).toBe("a");
  });

  // Typed rendering (polish V1) — the cells funnel through FieldDisplay.

  it("number columns right-align (header + cells) and read tabular, unreformatted digits", () => {
    installFetch();
    const priorityField: ResolvedField = { name: "priority", schema: { type: "number" } };
    renderTable(
      [{ ...NOTES[0], metadata: { status: "active", priority: 1234.5 } }],
      [STATUS_FIELD, priorityField],
    );

    expect(screen.getByRole("columnheader", { name: "priority" }).className).toContain(
      "text-right",
    );
    expect(screen.getByRole("columnheader", { name: "status" }).className).not.toContain(
      "text-right",
    );

    const row = rowFor("proj-a");
    const trigger = within(row).getByRole("button", { name: "Edit priority" });
    expect(trigger.textContent).toBe("1234.5"); // no locale comma
    expect(trigger.querySelector(".tabular-nums")).not.toBeNull();
    expect(trigger.closest("td")?.className).toContain("text-right");
    // Non-number cells stay left-aligned.
    expect(
      within(row).getByRole("button", { name: "Edit status" }).closest("td")?.className,
    ).not.toContain("text-right");
  });

  it("date cells read human — the due date renders month-day, not the raw key", () => {
    // Fake only Date so formatFieldDate's default `now` is deterministic.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 24, 12, 0, 0)); // local Jul 24, 2026
    try {
      installFetch();
      renderTable(NOTES, [DUE_FIELD]);
      const trigger = within(rowFor("proj-a")).getByRole("button", { name: "Edit due" });
      expect(trigger.textContent).toMatch(/Aug/i); // due 2026-08-01, same year
      expect(trigger.textContent).not.toContain("2026-08-01");
    } finally {
      vi.useRealTimers();
    }
  });
});
