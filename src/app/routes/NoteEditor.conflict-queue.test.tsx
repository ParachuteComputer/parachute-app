import { NoteEditor } from "@/app/routes/NoteEditor";
import { createIdbBlobStore } from "@/lib/sync/blob-store";
import { type LensDB, openLensDB } from "@/lib/sync/db";
import { recordIdMap } from "@/lib/sync/id-map";
import { drain, enqueue, listPending } from "@/lib/sync/queue";
import { useToastStore } from "@/lib/toast/store";
import { VaultClient } from "@/lib/vault/client";
import { useUpdateNote } from "@/lib/vault/queries";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The editor's conflict guard with the sync DB open, as it is in the app. The
// route tests run without a SyncProvider (db null), so a 409 reaches the
// editor there. In the app `useUpdateNote` falls back to the offline queue on a
// rejected PATCH; a 409 is a refusal, not a lost connection, and must not be
// queued: the drain re-sends it on a fresh baseline and overwrites the other
// edit, while the editor says "Saved".

const holder = vi.hoisted(() => ({ db: null as LensDB | null }));
vi.mock("@/providers/SyncProvider", () => ({
  useSync: () => ({ db: holder.db, isOnline: true, mirror: { state: "off" } }),
}));

vi.mock("@/components/CodeMirrorEditor", async () => {
  const React = await import("react");
  return {
    CodeMirrorEditor: React.forwardRef(function MockCodeMirrorEditor(
      props: { value: string; onChange(next: string): void; onSave?(): void },
      _ref: React.Ref<unknown>,
    ) {
      return (
        <>
          <textarea
            data-testid="cm-editor"
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
          />
          <button type="button" data-testid="cm-save" onClick={() => props.onSave?.()}>
            mock keyboard commit
          </button>
        </>
      );
    }),
  };
});

const note = {
  id: "abc-123",
  path: "Canon/Aaron",
  createdAt: "2026-04-16T00:00:00Z",
  updatedAt: "2026-04-17T00:00:00Z",
  content: "# hi\n\nbody",
  tags: ["canon"],
  links: [],
  attachments: [],
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
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={["/n/abc-123/edit"]}>
      <Routes>
        <Route path="/n/:id/edit" element={<NoteEditor />} />
        <Route path="/n/:id" element={<div>NoteViewPage</div>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: Wrapper },
  );
}

describe("NoteEditor — a 409 with the sync queue open", () => {
  beforeEach(async () => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    seedStore();
    indexedDB.deleteDatabase("parachute-lens");
    holder.db = await openLensDB();
  });
  afterEach(() => {
    holder.db?.close();
    holder.db = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the conflict banner and queues nothing", async () => {
    const json = (status: number, body: unknown) =>
      ({ ok: status < 400, status, json: async () => body, text: async () => "" }) as Response;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (init?.method === "PATCH") {
          return json(409, {
            message: "Note was modified",
            current_updated_at: "2026-04-18T10:00:00Z",
            expected_updated_at: note.updatedAt,
          });
        }
        if (url.includes("/api/notes")) return json(200, note);
        return json(404, null);
      }),
    );

    renderEditor();
    const cm = (await screen.findByTestId("cm-editor")) as HTMLTextAreaElement;
    fireEvent.change(cm, { target: { value: "my edit" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      await new Promise((r) => setTimeout(r, 100));
    });

    // Nothing was queued for a later re-send, and the editor didn't claim a save.
    expect(await listPending(holder.db!, "dev")).toHaveLength(0);
    expect(screen.queryByText("NoteViewPage")).not.toBeInTheDocument();
    expect(await screen.findByText(/edited elsewhere/i)).toBeInTheDocument();
  });

  it("a save of a note whose earlier edit was queued under its local id waits behind it", async () => {
    // Created offline as local-1, edited offline, then the create drained and
    // mapped local-1 → abc-123; the edit is still queued under local-1.
    await recordIdMap(holder.db!, "local-1", "abc-123", "dev");
    await enqueue(
      holder.db!,
      { kind: "update-note", targetId: "local-1", payload: { content: "older" } },
      { vaultId: "dev" },
    );
    const fetchMock = vi.fn(
      async () =>
        ({ ok: true, status: 200, json: async () => note, text: async () => "" }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useUpdateNote("abc-123"), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ content: "newer", if_updated_at: note.updatedAt });
    });
    // Not sent ahead of the older queued edit: queued behind it.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await listPending(holder.db!, "dev")).toHaveLength(2);
  });

  it("an offline save's stand-in note carries its tag change", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    try {
      const { result } = renderHook(() => useUpdateNote("abc-123"), { wrapper: Wrapper });
      let saved: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
      await act(async () => {
        saved = await result.current.mutateAsync({ tags: { add: ["todo"], remove: ["x"] } });
      });
      expect(saved?.tags).toEqual(["todo"]);
    } finally {
      Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    }
  });

  // Pin/Archive PATCH tags with no if_updated_at; the vault answers 428 (same
  // error class as a 409) and the drain fetches a baseline and re-sends. That
  // path must keep working.
  it("a 428 (no baseline sent) still goes to the queue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 428,
            json: async () => ({ error_type: "precondition_required", note_id: "abc-123" }),
            text: async () => "",
          }) as Response,
      ),
    );
    const { result } = renderHook(() => useUpdateNote("abc-123"), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ tags: { add: ["pinned"] } });
    });
    expect(await listPending(holder.db!, "dev")).toHaveLength(1);
  });
});

// One editor session: a ⌘S that lands in the offline queue, then later ones.
// The queued save's optimistic note carries a local timestamp, so a later
// online save must not be refused as a conflict with the user's own write.
describe("NoteEditor — saves after an offline save in the same session", () => {
  beforeEach(async () => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    seedStore();
    indexedDB.deleteDatabase("parachute-lens");
    holder.db = await openLensDB();
  });
  afterEach(() => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    holder.db?.close();
    holder.db = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function installVault() {
    const server = { note: { ...note } };
    let stamp = 0;
    const json = (status: number, body: unknown) =>
      ({ ok: status < 400, status, json: async () => body, text: async () => "" }) as Response;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as {
            content?: string;
            if_updated_at?: string;
            force?: boolean;
          };
          if (!body.force && body.if_updated_at !== server.note.updatedAt) {
            return json(409, {
              error_type: "conflict",
              current_updated_at: server.note.updatedAt,
              expected_updated_at: body.if_updated_at,
            });
          }
          stamp += 1;
          server.note = {
            ...server.note,
            ...(body.content !== undefined && { content: body.content }),
            updatedAt: `2026-04-18T0${stamp}:00:00Z`,
          };
          return json(200, server.note);
        }
        if (url.includes("/api/notes")) return json(200, server.note);
        return json(404, null);
      }),
    );
    return server;
  }

  async function drainNow() {
    await drain({
      db: holder.db!,
      client: new VaultClient({ vaultUrl: "http://localhost:1940", accessToken: "pvt_abc" }),
      vaultId: "dev",
      blobStore: createIdbBlobStore(holder.db!),
    });
  }

  async function checkpoint(cm: HTMLTextAreaElement, value: string) {
    fireEvent.change(cm, { target: { value } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("cm-save"));
      await new Promise((r) => setTimeout(r, 100));
    });
  }

  it("the queue drains, then the next online save lands", async () => {
    const server = installVault();
    renderEditor();
    const cm = (await screen.findByTestId("cm-editor")) as HTMLTextAreaElement;

    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    await checkpoint(cm, "written offline");
    expect(await listPending(holder.db!, "dev")).toHaveLength(1);

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    await drainNow();
    expect(server.note.content).toBe("written offline");

    await checkpoint(cm, "written offline, then online");
    expect(screen.queryByText(/edited elsewhere/i)).not.toBeInTheDocument();
    await drainNow();
    expect(server.note.content).toBe("written offline, then online");
  });

  it("back online before the drain: the next save doesn't jump ahead of the queued one", async () => {
    const server = installVault();
    renderEditor();
    const cm = (await screen.findByTestId("cm-editor")) as HTMLTextAreaElement;

    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    await checkpoint(cm, "written offline");
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });

    await checkpoint(cm, "written offline, then online");
    expect(screen.queryByText(/edited elsewhere/i)).not.toBeInTheDocument();
    await drainNow();
    expect(server.note.content).toBe("written offline, then online");
  });
});
