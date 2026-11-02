import { NoteEditor } from "@/app/routes/NoteEditor";
import { type LensDB, openLensDB } from "@/lib/sync/db";
import { listPending } from "@/lib/sync/queue";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
      props: { value: string; onChange(next: string): void },
      _ref: React.Ref<unknown>,
    ) {
      return (
        <textarea
          data-testid="cm-editor"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
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

    render(
      <MemoryRouter initialEntries={["/n/abc-123/edit"]}>
        <Routes>
          <Route path="/n/:id/edit" element={<NoteEditor />} />
          <Route path="/n/:id" element={<div>NoteViewPage</div>} />
        </Routes>
      </MemoryRouter>,
      { wrapper: Wrapper },
    );
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
});
