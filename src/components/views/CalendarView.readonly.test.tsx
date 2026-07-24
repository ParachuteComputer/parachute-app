import { CalendarView } from "@/components/views/CalendarView";
import { formatLongMonth } from "@/lib/dates";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { DEFAULT_TAG_ROLES } from "@/lib/vault/tag-roles";
import type { Note } from "@/lib/vault/types";
import { NOTE_DRAG_MIME } from "@/lib/views/dnd";
import type { ResolvedField } from "@/lib/views/fields";
import { makeDataTransfer, stubPointer } from "@/test/dnd";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The read-only createdAt fallback (views train F, D8): a `null` dateField
// plots notes by the local day of their `createdAt` — no date field exists,
// so the ENTIRE date-write surface must be unreachable. These tests pin the
// PR-E advisory: train E's drop machinery (DayCell dropProps, DayChip's
// drag + `useViewFieldWrite`) was safe only because ViewSurface never
// mounted CalendarView without a real dateField; this mode changes that
// mount condition, so the gate must hold under a fine pointer with a
// note-shaped drag payload. Field CHIPS on the day panel stay editable —
// they write OTHER fields through the shared hook (ratified).
//
// Fixtures use local-time Date constructions serialized to ISO, so the
// expected day keys (the viewer-local day of the instant) hold in any TZ.

const VIEW_KEY = ["viewResults", "dev", "v1", "tag=meeting"] as const;

const FIELDS: ResolvedField[] = [
  { name: "status", schema: { type: "string", enum: ["active", "done"] } },
];

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

function installFetch() {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PATCH") {
      const body = JSON.parse((init?.body as string) ?? "{}");
      return {
        ok: true,
        status: 200,
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

// The production wiring in miniature (mirrors CalendarView.dnd.test.tsx),
// with `dateField={null}` — the read-only mount ViewSurface now performs for
// a calendar with no date field.
function ReadOnlyCalendar({ initial }: { initial: Note[] }) {
  const { data } = useQuery<Note[]>({
    queryKey: VIEW_KEY as unknown as string[],
    queryFn: async () => initial,
    initialData: initial,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <CalendarView
      notes={data ?? []}
      dateField={null}
      roles={DEFAULT_TAG_ROLES}
      viewResultsKey={VIEW_KEY as unknown as string[]}
      fields={FIELDS}
    />
  );
}

function renderReadOnly(initial: Note[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <ReadOnlyCalendar initial={initial} />
      </BrowserRouter>
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

// Local-time createdAt fixtures — July 2026 days, TZ-robust by construction.
const CREATED_A = new Date(2026, 6, 10, 12, 0).toISOString();
const CREATED_B = new Date(2026, 6, 15, 9, 30).toISOString();

function note(id: string, createdAt: string, metadata: Record<string, unknown> = {}): Note {
  return {
    id,
    path: `day-${id}`,
    createdAt,
    updatedAt: "2026-07-10T00:00:00Z",
    metadata,
  } as Note;
}

function dayCell(container: HTMLElement, dayKey: string): HTMLElement {
  const el = container.querySelector(`[data-day="${dayKey}"]`);
  if (!el) throw new Error(`no day cell for ${dayKey}`);
  return el as HTMLElement;
}

function chipFor(title: string): HTMLElement {
  const el = screen.getByText(title).closest("[data-note-id]");
  if (!el) throw new Error(`no chip for "${title}"`);
  return el as HTMLElement;
}

function patchCalls(fetchImpl: ReturnType<typeof installFetch>) {
  return fetchImpl.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PATCH");
}

describe("CalendarView read-only createdAt mode (train F)", () => {
  let restorePointer: () => void;

  beforeEach(() => {
    // Fine pointer THROUGHOUT — the gate must hold on exactly the devices
    // train E's drag machinery serves, not only on touch.
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

  it("plots notes on their createdAt local day, with the quiet hint and NO undated footnote", () => {
    installFetch();
    const { container } = renderReadOnly([note("a", CREATED_A), note("b", CREATED_B)]);

    // Right days: each note's chip sits on the local day of its instant.
    expect(within(dayCell(container, "2026-07-10")).getByText("day-a")).toBeInTheDocument();
    expect(within(dayCell(container, "2026-07-15")).getByText("day-b")).toBeInTheDocument();
    // Opens on the most recent note's month (locale-safe via the formatter).
    expect(screen.getByRole("heading", { name: formatLongMonth(2026, 7) })).toBeInTheDocument();

    // The hint, quietly; the undated footnote never (every note has createdAt).
    expect(
      screen.getByText("Showing by created date — set a date field to schedule."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/aren't shown|isn't shown/)).toBeNull();
  });

  it("renders ZERO drag sources — chips aren't draggable even on a fine pointer", () => {
    installFetch();
    renderReadOnly([note("a", CREATED_A), note("b", CREATED_B)]);

    for (const title of ["day-a", "day-b"]) {
      const chip = chipFor(title);
      expect(chip.getAttribute("draggable")).toBeNull();
      expect(chip.className).not.toContain("cursor-grab");
    }
  });

  it("renders ZERO drop zones — a note-payload drag over any cell shows no affordance and is never accepted", () => {
    const fetchImpl = installFetch();
    const { container } = renderReadOnly([note("a", CREATED_A), note("b", CREATED_B)]);

    // A drag stamped with OUR note MIME (the strongest intruder: as if a
    // chip drag existed) — over an occupied in-month cell and an empty one.
    const dt = makeDataTransfer();
    dt.setData(NOTE_DRAG_MIME, "a");
    for (const key of ["2026-07-15", "2026-07-20"]) {
      const cell = dayCell(container, key);
      fireEvent.dragEnter(cell, { dataTransfer: dt });
      expect(cell.className).not.toContain("outline-accent/60");
      // Not preventDefault'd — the cell never marks itself a drop target.
      expect(fireEvent.dragOver(cell, { dataTransfer: dt })).toBe(true);
    }
    // Nothing anywhere lit up.
    expect(container.querySelector('[class*="outline-accent"]')).toBeNull();

    // And the drop writes nothing.
    fireEvent.drop(dayCell(container, "2026-07-20"), { dataTransfer: dt });
    expect(patchCalls(fetchImpl)).toHaveLength(0);
  });

  it("a full drag sequence writes no date — chips stay on their createdAt days, no PATCH, no toast", async () => {
    const fetchImpl = installFetch();
    const { container } = renderReadOnly([note("a", CREATED_A), note("b", CREATED_B)]);

    const dt = makeDataTransfer();
    dt.setData(NOTE_DRAG_MIME, "a");
    const chip = chipFor("day-a");
    const target = dayCell(container, "2026-07-20");
    fireEvent.dragStart(chip, { dataTransfer: dt });
    fireEvent.dragEnter(target, { dataTransfer: dt });
    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });
    fireEvent.dragEnd(chip, { dataTransfer: dt });

    await new Promise((r) => setTimeout(r, 25));
    expect(patchCalls(fetchImpl)).toHaveLength(0);
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(within(dayCell(container, "2026-07-10")).getByText("day-a")).toBeInTheDocument();
    expect(within(dayCell(container, "2026-07-20")).queryByText("day-a")).toBeNull();
  });

  it("field chips on the day panel STAY editable — a non-date write goes through, touching no date", async () => {
    const fetchImpl = installFetch();
    renderReadOnly([note("a", CREATED_A, { status: "active" }), note("b", CREATED_B)]);

    // Open the day panel (clicking the chip bubbles to the day button —
    // read-only chips carry no click-capture suppression).
    fireEvent.click(chipFor("day-a"));
    const panel = screen.getByRole("region", { name: /notes on/i });

    // Edit the status field from its chip.
    fireEvent.click(within(panel).getByRole("button", { name: /edit status/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "done" }));

    await waitFor(() => {
      expect(patchCalls(fetchImpl)).toHaveLength(1);
    });
    const body = JSON.parse(((patchCalls(fetchImpl)[0]![1] as RequestInit).body as string) ?? "{}");
    // Exactly the edited field — no date key of any kind.
    expect(body.metadata).toEqual({ status: "done" });
  });
});
