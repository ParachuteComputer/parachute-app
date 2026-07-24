import { CalendarView } from "@/components/views/CalendarView";
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

// Desktop drag on the calendar (views train E) — drag a day chip onto another
// in-month day; the drop writes the view's date field as a bare `YYYY-MM-DD`
// (exactly what the field chip's date picker commits). Board-harness pattern:
// a real QueryClient over the cache key the write targets, PATCH stubbed at
// fetch, DataTransfer/matchMedia synthesized (src/test/dnd.ts).
//
// Fixtures sit in July 2026 (the most recent dated note picks the opening
// month), giving the grid in-month cells 2026-07-01..31 and out-month
// neighbors (2026-06-28.., 2026-08-01..).

const VIEW_KEY = ["viewResults", "dev", "v1", "tag=meeting"] as const;

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

// A calendar reading from the SAME cache key the drop writes — the production
// wiring (ViewSurface → useViewResults → CalendarView), in miniature.
function Calendar({ initial }: { initial: Note[] }) {
  const { data } = useQuery<Note[]>({
    queryKey: VIEW_KEY as unknown as string[],
    queryFn: async () => initial,
    initialData: initial,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <CalendarView
      notes={data ?? []}
      dateField="meeting_date"
      roles={DEFAULT_TAG_ROLES}
      viewResultsKey={VIEW_KEY as unknown as string[]}
    />
  );
}

function renderCalendar(initial: Note[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Calendar initial={initial} />
      </BrowserRouter>
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

function note(id: string, meetingDate: string): Note {
  return {
    id,
    path: `mtg-${id}`,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-10T00:00:00Z",
    metadata: { meeting_date: meetingDate },
  } as Note;
}

function dayCell(container: HTMLElement, dayKey: string): HTMLElement {
  const el = container.querySelector(`[data-day="${dayKey}"]`);
  if (!el) throw new Error(`no day cell for ${dayKey}`);
  return el as HTMLElement;
}

function chipFor(title: string): HTMLElement {
  // The chip is the draggable span carrying the flash target attribute.
  const el = screen.getByText(title).closest("[data-note-id]");
  if (!el) throw new Error(`no chip for "${title}"`);
  return el as HTMLElement;
}

function patchCalls(fetchImpl: ReturnType<typeof installFetch>) {
  return fetchImpl.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PATCH");
}

/** Drag `title`'s chip and drop it on `cell` — the full event sequence. */
function dragChipToCell(title: string, cell: HTMLElement) {
  const dt = makeDataTransfer();
  const chip = chipFor(title);
  fireEvent.dragStart(chip, { dataTransfer: dt });
  fireEvent.dragEnter(cell, { dataTransfer: dt });
  fireEvent.dragOver(cell, { dataTransfer: dt });
  fireEvent.drop(cell, { dataTransfer: dt });
  fireEvent.dragEnd(chip, { dataTransfer: dt });
  return dt;
}

describe("CalendarView desktop drag", () => {
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

  it("drops a chip on another in-month day: PATCH writes a bare YYYY-MM-DD + chip moves", async () => {
    const fetchImpl = installFetch(true);
    const { container } = renderCalendar([note("a", "2026-07-10"), note("b", "2026-07-15")]);

    expect(within(dayCell(container, "2026-07-10")).getByText("mtg-a")).toBeInTheDocument();

    const dt = dragChipToCell("mtg-a", dayCell(container, "2026-07-20"));
    expect(dt.getData(NOTE_DRAG_MIME)).toBe("a");

    // Optimistic: the chip now sits on July 20 (and July 10 is empty).
    await waitFor(() => {
      expect(within(dayCell(container, "2026-07-20")).getByText("mtg-a")).toBeInTheDocument();
    });
    expect(within(dayCell(container, "2026-07-10")).queryByText("mtg-a")).toBeNull();

    // The wire write: the date field as a BARE local day key — identical to
    // what the shipped date chip commits. No time component.
    const patches = patchCalls(fetchImpl);
    expect(patches).toHaveLength(1);
    const body = JSON.parse(((patches[0]![1] as RequestInit).body as string) ?? "{}");
    expect(body.metadata).toEqual({ meeting_date: "2026-07-20" });
    expect(body.if_updated_at).toBe("2026-07-10T00:00:00Z");

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(
        toasts.some((t) => t.tone === "success" && t.message === "✓ meeting_date → 2026-07-20"),
      ).toBe(true);
    });
  });

  it("dropping a chip on its OWN day is a no-op — no write, no toast", async () => {
    const fetchImpl = installFetch(true);
    const { container } = renderCalendar([note("a", "2026-07-10"), note("b", "2026-07-15")]);

    dragChipToCell("mtg-a", dayCell(container, "2026-07-10"));

    await new Promise((r) => setTimeout(r, 25));
    expect(patchCalls(fetchImpl)).toHaveLength(0);
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(within(dayCell(container, "2026-07-10")).getByText("mtg-a")).toBeInTheDocument();
  });

  it("out-month cells are NOT drop zones — dropping on a neighbor month's day does nothing", async () => {
    const fetchImpl = installFetch(true);
    const { container } = renderCalendar([note("a", "2026-07-10"), note("b", "2026-07-15")]);

    // June 28 renders in July's grid but belongs to June.
    const outCell = dayCell(container, "2026-06-28");
    const dt = makeDataTransfer();
    fireEvent.dragStart(chipFor("mtg-a"), { dataTransfer: dt });
    fireEvent.dragEnter(outCell, { dataTransfer: dt });
    expect(outCell.className).not.toContain("outline-accent/60");
    // No preventDefault — the cell never accepts the drop.
    expect(fireEvent.dragOver(outCell, { dataTransfer: dt })).toBe(true);
    fireEvent.drop(outCell, { dataTransfer: dt });

    await new Promise((r) => setTimeout(r, 25));
    expect(patchCalls(fetchImpl)).toHaveLength(0);
    expect(within(dayCell(container, "2026-07-10")).getByText("mtg-a")).toBeInTheDocument();
  });

  it("shows the drop affordance on the hovered in-month cell, ignores foreign drags", async () => {
    const fetchImpl = installFetch(true);
    const { container } = renderCalendar([note("a", "2026-07-10"), note("b", "2026-07-15")]);

    const cell = dayCell(container, "2026-07-20");

    // A note drag lights the cell up…
    const dt = makeDataTransfer();
    fireEvent.dragStart(chipFor("mtg-a"), { dataTransfer: dt });
    fireEvent.dragEnter(cell, { dataTransfer: dt });
    expect(cell.className).toContain("outline-accent/60");
    fireEvent.dragLeave(cell, { dataTransfer: dt });
    expect(cell.className).not.toContain("outline-accent/60");

    // …a foreign drag doesn't, and its drop writes nothing.
    const foreign = makeDataTransfer();
    foreign.setData("text/plain", "not a note");
    fireEvent.dragEnter(cell, { dataTransfer: foreign });
    expect(cell.className).not.toContain("outline-accent/60");
    fireEvent.drop(cell, { dataTransfer: foreign });

    await new Promise((r) => setTimeout(r, 25));
    expect(patchCalls(fetchImpl)).toHaveLength(0);
  });

  it("suppresses the residue click after a drag — a drop never opens the day panel", async () => {
    installFetch(true);
    renderCalendar([note("a", "2026-07-10"), note("b", "2026-07-15")]);

    const chip = chipFor("mtg-a");
    const dt = makeDataTransfer();
    fireEvent.dragStart(chip, { dataTransfer: dt });
    fireEvent.dragEnd(chip, { dataTransfer: dt });

    // The residue click lands on the chip inside the day button — swallowed.
    fireEvent.click(chip);
    expect(screen.queryByRole("region", { name: /notes on/i })).toBeNull();

    // A real click (after the suppression window) opens the panel as always.
    await new Promise((r) => setTimeout(r, 25));
    fireEvent.click(chipFor("mtg-a"));
    expect(screen.getByRole("region", { name: /notes on/i })).toBeInTheDocument();
  });

  it("renders NO drag affordance on a touch device — chips aren't draggable", () => {
    restorePointer();
    restorePointer = stubPointer("coarse");
    installFetch(true);
    renderCalendar([note("a", "2026-07-10"), note("b", "2026-07-15")]);

    const chip = chipFor("mtg-a");
    expect(chip.getAttribute("draggable")).toBeNull();
    expect(chip.className).not.toContain("cursor-grab");
  });
});
