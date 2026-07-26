import { VaultSurface } from "@/app/routes/VaultSurface";
import { saveToken } from "@/lib/vault/storage";
import { useVaultStore } from "@/lib/vault/store";
import type { Note } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// app#109: the All-notes window must stay BOUNDED regardless of vault size.
//
// A live subscription's snapshot is always the COMPLETE matching set — the
// vault streams every match and ignores `limit` on the stream. Before the
// fix, `useNotes` opened that subscription for the list's own (windowed)
// query and mirrored the snapshot into the list's cache key: on a 2,606-note
// vault the 50-row page was clobbered into 2,606 rows in a 330,339px page,
// and `hasNext` (`length === 50`) died, disabling the pager entirely.
//
// This suite drives the REAL data path — real useNotes / live-query / fetch
// URL grammar — against a stubbed HTTP layer that honors `limit`/`offset`
// like the vault does, and a fake WebSocket that behaves like the vault's
// subscribe: it answers ANY subscription with the FULL fixture as one
// snapshot. If anything ever re-subscribes the list's windowed query, the
// clobber re-materializes and the row-count assertion here fails.

const PAGE = 50;
const BIG = 3000; // "vault size" — anything ≫ PAGE proves the bound

function makeFixture(n: number): Note[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    path: `Seed/pile/${String(i).padStart(4, "0")}.md`,
    preview: `note ${i}`,
    createdAt: new Date(Date.UTC(2026, 0, 1) - i * 60_000).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1) - i * 60_000).toISOString(),
  }));
}

/** Every WebSocket the app opened, by URL — the pin that the list never subscribes. */
let openedSockets: string[] = [];
let fixture: Note[] = [];

// Minimal double for the slice of the WebSocket API ws-transport uses
// (onopen/onmessage/onclose/onerror properties, send/close, readyState).
// Mimics the vault's subscribe contract: after open, deliver the COMPLETE
// fixture as a single done snapshot — `limit` in the URL is ignored, exactly
// like the real stream.
class FakeVaultSocket {
  static OPEN = 1;
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    openedSockets.push(url);
    queueMicrotask(() => {
      if (this.readyState === 3) return;
      this.readyState = 1;
      this.onopen?.();
      this.onmessage?.({
        data: JSON.stringify({ type: "snapshot", notes: fixture, done: true }),
      });
    });
  }
  send(_data: string): void {}
  close(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
}

function stubNetwork(): void {
  vi.stubGlobal("WebSocket", FakeVaultSocket as unknown as typeof WebSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      let body: unknown = [];
      if (url.pathname.endsWith("/api/notes")) {
        // The vault's REST list honors limit/offset — the window is real on
        // the poll. Only the LIST query (limit=PAGE) gets the fixture; the
        // ambient windows (saved views tag=view, date views limit=5000) get
        // empties so this suite isolates the list surface.
        if (url.searchParams.get("limit") === String(PAGE)) {
          const offset = Number(url.searchParams.get("offset") ?? "0");
          body = fixture.slice(offset, offset + PAGE);
        }
      }
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
}

function seedStore(): void {
  useVaultStore.setState({
    vaults: {
      v1: {
        id: "v1",
        url: "https://example.test",
        name: "Test",
        issuer: "https://example.test",
        clientId: "cid",
        scope: "full",
        addedAt: "2026-01-01T00:00:00Z",
        lastUsedAt: "2026-01-01T00:00:00Z",
      },
    },
    activeVaultId: "v1",
  });
  saveToken("v1", { accessToken: "tok", scope: "full", vault: "https://example.test" });
}

function renderAllNotes() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <MemoryRouter initialEntries={["/notes"]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/notes" element={<VaultSurface />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const listRows = (container: HTMLElement) =>
  container.querySelectorAll('ol[aria-label="Notes"] > li');

describe("All-notes window stays bounded regardless of vault size (app#109)", () => {
  beforeEach(() => {
    localStorage.clear();
    openedSockets = [];
    seedStore();
    stubNetwork();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it(`renders exactly ${PAGE} rows of a ${BIG}-note vault, with a working pager`, async () => {
    fixture = makeFixture(BIG);
    const { container } = renderAllNotes();

    // Page 1 arrives from the poll… (lenient match so that on UNfixed code
    // this test reaches the row-count assertion and fails THERE — the catch.)
    await screen.findByText(new RegExp(`^Showing 1–${PAGE}`));
    // …and stays the page even after every opened socket has delivered its
    // full-fixture snapshot (flushed via the microtask queue above). Before
    // the fix this is where the list exploded to `BIG` rows.
    await waitFor(() => expect(openedSockets.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 0));
    expect(listRows(container).length).toBe(PAGE);

    // The interim total: a full page only bounds the set from below.
    expect(screen.getByText(`Showing 1–${PAGE} of ${PAGE}+`)).toBeInTheDocument();
    // The full page implies a further page; the pager must say so.
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("never opens a live subscription for the list's windowed query", async () => {
    fixture = makeFixture(BIG);
    renderAllNotes();
    await screen.findByText(new RegExp(`^Showing 1–${PAGE}`));
    await new Promise((r) => setTimeout(r, 0));

    // Ambient surfaces (saved views, date views) may subscribe — their
    // windows are a separate finding (app#110). The LIST's window must not:
    // its subscription is exactly a subscribe URL carrying the list page
    // size, which is what mirrored the full set into the page before the fix.
    const listSubs = openedSockets.filter((u) => {
      const q = new URL(u).searchParams;
      return u.includes("/api/subscribe") && q.get("limit") === String(PAGE);
    });
    expect(listSubs).toEqual([]);
  });

  it("a short page ends the set: exact total shown, Next disabled", async () => {
    fixture = makeFixture(23);
    const { container } = renderAllNotes();

    await screen.findByText(/^Showing 1–23/);
    expect(screen.getByText("Showing 1–23 of 23")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(listRows(container).length).toBe(23);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
