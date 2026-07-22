import { NoteFieldChips } from "@/components/views/NoteFieldChips";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import type { Note } from "@/lib/vault/types";
import type { ResolvedField } from "@/lib/views/fields";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The field-chips band (view-experience wave, Part C). Driven through a real
// QueryClient so the optimistic `["viewResults", …]` write repaints the chip
// the same way it does in the app — the same wiring the BoardView test uses.

const VIEW_KEY = ["viewResults", "dev", "v1", "tag=project"] as const;

const FIELDS: ResolvedField[] = [
  { name: "status", schema: { type: "string", enum: ["active", "done"] } },
  { name: "priority", schema: { type: "number" } },
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

// A band that reads its note from the SAME cache key the write targets — the
// production wiring (renderer maps results.data → chips), in miniature.
function Band({
  initial,
  fields,
  omit,
}: {
  initial: Note[];
  fields: ResolvedField[];
  omit?: string[];
}) {
  const { data } = useQuery<Note[]>({
    queryKey: VIEW_KEY as unknown as string[],
    queryFn: async () => initial,
    initialData: initial,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const note = (data ?? [])[0];
  if (!note) return null;
  return (
    <NoteFieldChips
      note={note}
      fields={fields}
      viewResultsKey={VIEW_KEY as unknown as string[]}
      omit={omit}
    />
  );
}

function renderBand(initial: Note[], fields: ResolvedField[], omit?: string[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <Band initial={initial} fields={fields} omit={omit} />
    </QueryClientProvider>,
  );
  return qc;
}

const NOTE: Note = {
  id: "a",
  path: "proj-a",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-10T00:00:00Z",
  metadata: { status: "active", priority: 2 },
};

describe("NoteFieldChips", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.getState().clear();
    seedStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a chip per resolved field, each showing the note's current value", () => {
    renderBand([NOTE], FIELDS);
    expect(screen.getByText("status")).toBeInTheDocument();
    expect(screen.getByText("priority")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit status/i })).toHaveTextContent("active");
    expect(screen.getByRole("button", { name: /edit priority/i })).toHaveTextContent("2");
  });

  it("renders nothing when no fields resolve — the card looks unchanged", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <NoteFieldChips note={NOTE} fields={[]} viewResultsKey={VIEW_KEY as unknown as string[]} />
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("omits named fields (a board leaves out its own lane field)", () => {
    renderBand([NOTE], FIELDS, ["status"]);
    expect(screen.queryByText("status")).toBeNull();
    expect(screen.getByText("priority")).toBeInTheDocument();
  });

  it("tapping a chip edits the field in place — optimistic repaint + one-field PATCH", async () => {
    const fetchImpl = installFetch(true);
    const qc = renderBand([NOTE], FIELDS);

    fireEvent.click(screen.getByRole("button", { name: /edit status/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "done" }));

    // Optimistic: the chip repaints from the updated cache…
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /edit status/i })).toHaveTextContent("done");
    });
    // …and the view cache carries the new value (siblings untouched).
    const cached = qc.getQueryData<Note[]>(VIEW_KEY as unknown as string[]);
    expect(cached?.[0].metadata).toEqual({ status: "done", priority: 2 });

    // The wire write moved exactly one field.
    const patch = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === "PATCH",
    );
    const body = JSON.parse(((patch![1] as RequestInit).body as string) ?? "{}");
    expect(body.metadata).toEqual({ status: "done" });
    expect(body.if_updated_at).toBe("2026-07-10T00:00:00Z");
  });

  it("rolls back and toasts when the write fails", async () => {
    installFetch(false);
    const qc = renderBand([NOTE], FIELDS);

    fireEvent.click(screen.getByRole("button", { name: /edit status/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "done" }));

    // After the failed write the value is back to "active"…
    await waitFor(() => {
      const cached = qc.getQueryData<Note[]>(VIEW_KEY as unknown as string[]);
      expect(cached?.[0].metadata?.status).toBe("active");
    });
    // …and an error toast explains why.
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(
        toasts.some((t) => t.tone === "error" && /couldn't update status/i.test(t.message)),
      ).toBe(true);
    });
  });
});
