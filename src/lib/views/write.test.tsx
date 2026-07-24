import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import type { Note } from "@/lib/vault/types";
import {
  CARD_FLASH_CLASS,
  MICROCONFIRM_TOAST_MS,
  formatFieldValue,
  useViewFieldWrite,
} from "@/lib/views/write";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The shared field-write hook (views train A) — `useViewFieldMutation` plus
// the microconfirmation. Driven hook-level through a real QueryClient (same
// wiring as the chips/board tests): the success path must fire the short
// success toast + flash the `[data-note-id]` card ON RESOLVE, and the error
// path must keep the shipped rollback + error toast with NO confirmation.

const VIEW_KEY = ["viewResults", "dev", "v1", "tag=project"] as const;

const NOTE: Note = {
  id: "a",
  path: "proj-a",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-10T00:00:00Z",
  metadata: { status: "active", priority: 2 },
};

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

/** A stand-in card in the document, carrying the flash target attribute. */
function mountCard(noteId: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-note-id", noteId);
  document.body.appendChild(el);
  return el;
}

function setup(patchOk: boolean) {
  const fetchImpl = installFetch(patchOk);
  // gcTime Infinity: no query observer on VIEW_KEY here, so zero gcTime would
  // garbage-collect the optimistic cache before assertions read it.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  });
  qc.setQueryData(VIEW_KEY as unknown as string[], [NOTE]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useViewFieldWrite(NOTE, VIEW_KEY as unknown as string[]), {
    wrapper,
  });
  return { fetchImpl, qc, result };
}

describe("formatFieldValue", () => {
  it("reads booleans as Yes/No (matching FieldValueControl), stringifies the rest, null → null", () => {
    expect(formatFieldValue(true)).toBe("Yes");
    expect(formatFieldValue(false)).toBe("No");
    expect(formatFieldValue(3)).toBe("3");
    expect(formatFieldValue("done")).toBe("done");
    expect(formatFieldValue(null)).toBeNull();
  });
});

describe("useViewFieldWrite", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.getState().clear();
    seedStore();
  });
  afterEach(() => {
    for (const el of document.querySelectorAll("[data-note-id]")) el.remove();
    vi.unstubAllGlobals();
  });

  it("success: writes through the mutation, then confirms — short success toast + card flash", async () => {
    const card = mountCard(NOTE.id);
    const { fetchImpl, qc, result } = setup(true);

    await act(() => result.current.write("status", "done"));

    // The underlying mutation did its job: one-field PATCH with the baseline…
    const patch = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === "PATCH",
    );
    const body = JSON.parse(((patch![1] as RequestInit).body as string) ?? "{}");
    expect(body.metadata).toEqual({ status: "done" });
    expect(body.if_updated_at).toBe("2026-07-10T00:00:00Z");
    // …and the view cache carries the new value + the fresh server stamp.
    const cached = qc.getQueryData<Note[]>(VIEW_KEY as unknown as string[]);
    expect(cached?.[0].metadata).toEqual({ status: "done", priority: 2 });
    expect(cached?.[0].updatedAt).toBe("2026-07-22T12:00:00Z");

    // The microconfirmation: field label + new display value, microduration.
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("✓ status → done");
    expect(toasts[0].tone).toBe("success");
    expect(toasts[0].durationMs).toBe(MICROCONFIRM_TOAST_MS);
    // …and the card carrying the note flashed.
    expect(card.classList.contains(CARD_FLASH_CLASS)).toBe(true);
  });

  it("labels: booleans confirm as Yes/No, null as 'cleared', valueLabel overrides (the board's lane label)", async () => {
    const { result } = setup(true);

    await act(() => result.current.write("done", true));
    await act(() => result.current.write("status", null));
    await act(() => result.current.write("status", "done", { valueLabel: "Done!" }));

    const messages = useToastStore.getState().toasts.map((t) => t.message);
    expect(messages).toEqual(["✓ done → Yes", "✓ status cleared", "✓ status → Done!"]);
  });

  it("error: rollback (from the mutation) + error toast — no success toast, no flash", async () => {
    const card = mountCard(NOTE.id);
    const { qc, result } = setup(false);

    await act(() => result.current.write("status", "done"));

    // Rolled back to the pre-write cache…
    const cached = qc.getQueryData<Note[]>(VIEW_KEY as unknown as string[]);
    expect(cached?.[0].metadata?.status).toBe("active");
    // …one error toast in the shipped phrasing, and nothing confirming.
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].tone).toBe("error");
    expect(toasts[0].message).toMatch(/^Couldn't update status on "proj-a": /);
    expect(card.classList.contains(CARD_FLASH_CLASS)).toBe(false);
  });

  it("error: errorPrefix overrides the lead-in (the board's 'Couldn't move' phrasing)", async () => {
    const { result } = setup(false);

    await act(() =>
      result.current.write("status", "done", { errorPrefix: 'Couldn\'t move "proj-a"' }),
    );

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].tone).toBe("error");
    expect(toasts[0].message).toMatch(/^Couldn't move "proj-a": /);
  });
});
