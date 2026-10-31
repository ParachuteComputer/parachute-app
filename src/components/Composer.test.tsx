import { Composer } from "@/components/Composer";
import { NEW_NOTE_SCOPE, loadDraft, saveDraft } from "@/lib/drafts/store";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// LZ-1 (LENS-SPEC.md §3.1 anatomy item 2): the W2-10 honest composer, extracted
// VERBATIM from Home.tsx into its own component so the upcoming one-surface
// merge can drop it onto both the Recent and All lenses. This file is the
// composer's own test suite, moved out of Home.test.tsx and re-pointed at the
// extracted component — same assertions, same regressions pinned, now
// exercising `<Composer>` directly instead of through `<Home>`. The
// surrounding-chrome tests (masthead, quick doors, setup nudge, trial
// ambience) live in VaultSurface.recent.test.tsx — Home dissolved into the
// Recent lens in LZ-4.
//
// These pin the honest contract: type in place, save without navigating away,
// one shared draft with /new, a capability-gated mic — and the flush-on-blur
// guard (F10/W2-10 review fold) that stops an outside door (mobile "+",
// speed-dial, palette) from dropping the debounced tail.

// The composer's save fires the same fire-and-forget schema ensure NoteNew's
// does (audit GET + create PUT against the vault). The tests here mock fetch
// but don't enumerate those calls; stub the module to a no-op (schema-ensure
// has its own focused tests). Same pattern as NoteNew.test.tsx / Home.test.tsx.
vi.mock("@/lib/vault/schema-ensure", () => ({
  ensureNotesSchema: vi.fn(async () => {}),
}));

interface Row {
  id: string;
  path: string;
  createdAt: string;
  updatedAt?: string;
  tags?: string[];
  preview?: string;
}

// A routed fetch for the composer (W2-10): the blanket array-for-everything
// stub can't express "POST create succeeds" or "the vault declares
// transcription disabled". Matching is deliberately narrow — the notes LIST
// is `/api/notes?…` (query string present); anything unmatched 404s so
// settings/tag-role reads fall back to their defaults.
function installRoutedFetch(opts: {
  notes?: Row[];
  apiVault?: Record<string, unknown>;
  createStatus?: number;
}) {
  const impl = vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const json = (body: unknown, status = 200) =>
      ({ ok: status < 400, status, json: async () => body, text: async () => "" }) as Response;
    if (method === "POST" && url.includes("/api/notes")) {
      if (opts.createStatus && opts.createStatus >= 400) {
        return json({ error: "nope" }, opts.createStatus);
      }
      const parsed = init?.body ? JSON.parse(String(init.body)) : {};
      return json({ id: "created-1", createdAt: new Date().toISOString(), ...parsed });
    }
    if (url.includes("/api/vault")) return json(opts.apiVault ?? { name: "default" });
    if (url.includes("/api/notes?")) return json(opts.notes ?? []);
    return json(null, 404);
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

const SEED_ONLY: Row[] = [
  {
    id: "g1",
    path: "Welcome to your vault 🪂",
    tags: ["guide"],
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-01T09:00:00.000Z",
  },
];

const VAULT: VaultRecord = {
  id: "v1",
  url: "http://localhost:1940",
  name: "default",
  issuer: "http://localhost:1940",
  clientId: "c",
  scope: "full",
  addedAt: "2026-07-01T00:00:00.000Z",
  lastUsedAt: "2026-07-01T00:00:00.000Z",
};

function seedStore() {
  useVaultStore.setState({
    vaults: { v1: VAULT },
    activeVaultId: "v1",
  });
  localStorage.setItem(
    "lens:token:v1",
    JSON.stringify({ accessToken: "t", scope: "full", vault: "default" }),
  );
}

function LocationSpy() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <MemoryRouter initialEntries={["/"]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/" element={children} />
          <Route path="/new" element={<LocationSpy />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function renderComposer(focused = false) {
  render(
    <Wrap>
      <Composer vault={VAULT} focused={focused} />
    </Wrap>,
  );
}

describe("Composer — the honest write-in-place hero (W2-10; F10)", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  it("is a real textarea — typing happens in place, no navigation", async () => {
    installRoutedFetch({ notes: SEED_ONLY });
    renderComposer();
    const input = await screen.findByRole("textbox", { name: /what's on your mind\?/i });
    fireEvent.change(input, { target: { value: "a small thought" } });
    expect(input).toHaveValue("a small thought");
    // No route change — the affordance no longer lies.
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();
  });

  it("focus expands the card: Save-to-vault + the full-editor escape appear", async () => {
    installRoutedFetch({ notes: SEED_ONLY });
    renderComposer();
    const input = await screen.findByRole("textbox", { name: /what's on your mind\?/i });
    // Resting: the quiet draft line, no action row. It must not promise the
    // note is saved to the vault — nothing reaches the vault until Save.
    expect(screen.getByText(/drafts are kept until you save/i)).toBeInTheDocument();
    expect(screen.queryByText(/autosaves/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save to default/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open full editor/i })).not.toBeInTheDocument();

    fireEvent.focus(input);
    expect(screen.getByRole("button", { name: /save to default/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open full editor/i })).toHaveAttribute("href", "/new");
  });

  it("Save creates the note through the NoteNew path and stays mounted (no navigation)", async () => {
    const fetchImpl = installRoutedFetch({ notes: SEED_ONLY });
    renderComposer();
    const input = await screen.findByRole("textbox", { name: /what's on your mind\?/i });
    fireEvent.change(input, { target: { value: "quick capture #idea" } });
    fireEvent.click(screen.getByRole("button", { name: /save to default/i }));

    // The create POST carries the same shape NoteNew's text save sends:
    // the extracted hashtag only (no #capture, T-318) + provenance metadata.
    await waitFor(() => {
      const post = fetchImpl.mock.calls.find(([, init]) => init?.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post?.[1]?.body));
      expect(body.content).toBe("quick capture #idea");
      expect(body.tags).toEqual(["idea"]);
      expect(body.metadata).toEqual({ source: "text", app: "notes" });
      expect(body.path).toMatch(/^Notes\//);
    });

    // No navigation away; the composer clears; the shared draft is consumed.
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();
    await waitFor(() => expect(input).toHaveValue(""));
    expect(loadDraft("v1", NEW_NOTE_SCOPE)).toBeNull();
  });

  it("a failed save keeps the words and says why (no silent loss)", async () => {
    installRoutedFetch({ notes: SEED_ONLY, createStatus: 500 });
    renderComposer();
    const input = await screen.findByRole("textbox", { name: /what's on your mind\?/i });
    fireEvent.change(input, { target: { value: "do not lose me" } });
    fireEvent.click(screen.getByRole("button", { name: /save to default/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(input).toHaveValue("do not lose me");
  });

  it("the typed draft lands in the SHARED store on the full-editor hop (survives to /new)", async () => {
    installRoutedFetch({ notes: SEED_ONLY });
    renderComposer();
    const input = await screen.findByRole("textbox", { name: /what's on your mind\?/i });
    fireEvent.change(input, { target: { value: "started here" } });
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole("link", { name: /open full editor/i }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/new"));
    // The flush beat the debounce: the draft sits under the exact key
    // NoteNew's restore reads (vault id + NEW_NOTE_SCOPE). The full
    // Home→/new round-trip is pinned in NoteNew.test.tsx.
    expect(loadDraft("v1", NEW_NOTE_SCOPE)?.body.content).toBe("started here");
  });

  it("flushes on blur so an OUTSIDE door (mobile +, speed-dial, palette) can't drop the tail", async () => {
    installRoutedFetch({ notes: SEED_ONLY });
    renderComposer();
    const input = await screen.findByRole("textbox", { name: /what's on your mind\?/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "typed then left by an outside door" } });
    // Focus leaves the composer WITHOUT touching its own flush-wired links —
    // the real hop is the mobile "+", speed-dial, or palette, which steal
    // focus (focusout) before their click navigates to /new. Without the
    // onBlur flush the 600ms debounce is still armed and the store is empty,
    // so NoteNew's render-phase restore reads nothing and the tail is lost.
    fireEvent.focusOut(input);
    expect(loadDraft("v1", NEW_NOTE_SCOPE)?.body.content).toBe(
      "typed then left by an outside door",
    );
  });

  it("restores a draft started on /new — one draft, both surfaces", async () => {
    saveDraft("v1", NEW_NOTE_SCOPE, {
      content: "started on /new",
      path: "Notes/2026/07-11/09-00-00",
      tags: ["capture"],
    });
    installRoutedFetch({ notes: SEED_ONLY });
    renderComposer();
    const input = await screen.findByRole("textbox", { name: /what's on your mind\?/i });
    expect(input).toHaveValue("started on /new");
    // A draft-in-progress greets you expanded, ready to finish or save.
    expect(screen.getByRole("button", { name: /save to default/i })).toBeInTheDocument();
  });

  it("the mic is the W2-9 voice arrival (/new?voice=1)", async () => {
    installRoutedFetch({ notes: SEED_ONLY });
    renderComposer();
    const mic = await screen.findByRole("link", { name: /record a voice note/i });
    expect(mic).toHaveAttribute("href", "/new?voice=1");
  });

  // T-318 / DESIGN-0.9 §8c: no pre-filled tag. A typed note with no tags of
  // its own saves with NO tags; how it arrived rides metadata. (The opt-in
  // inbox tag, and the lazy tag declaration, are pinned against the real
  // schema-ensure in Composer.inbox.test.tsx.)
  it("a fresh composer shows no tag chip and saves an untagged note with no tags", async () => {
    const { ensureNotesSchema } = await import("@/lib/vault/schema-ensure");
    vi.mocked(ensureNotesSchema).mockClear();
    const fetchImpl = installRoutedFetch({ notes: SEED_ONLY });
    renderComposer();
    const input = await screen.findByRole("textbox", { name: /what's on your mind\?/i });
    fireEvent.focus(input);
    expect(screen.queryByText("capture")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove tag/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("inbox-tag-hint")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "never touched tags" } });
    fireEvent.click(screen.getByRole("button", { name: /save to default/i }));

    await waitFor(() => {
      const post = fetchImpl.mock.calls.find(([, init]) => init?.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post?.[1]?.body));
      expect(body.tags).toBeUndefined();
      expect(body.metadata).toEqual({ source: "text", app: "notes" });
    });
    expect(vi.mocked(ensureNotesSchema)).not.toHaveBeenCalled();
  });

  it("an untouched composer never writes a draft", async () => {
    installRoutedFetch({ notes: SEED_ONLY });
    renderComposer();
    const input = await screen.findByRole("textbox", { name: /what's on your mind\?/i });
    fireEvent.focus(input);
    fireEvent.focusOut(input);
    expect(loadDraft("v1", NEW_NOTE_SCOPE)).toBeNull();
  });

  // T-318 snags2 "unsaved-draft leak": leaving Home while a Save is in flight
  // (tap a recent note, the "+", the palette) unmounts the composer, whose
  // unmount flush rightly keeps the words — but TanStack drops `mutate`'s own
  // onSuccess once the component is gone, so the clear never ran. The note got
  // created AND its text stayed behind as the shared draft, to be saved again
  // from the next /new or composer.
  it("a save that lands after the composer unmounted still consumes the draft", async () => {
    let answerCreate: ((r: Response) => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        const json = (body: unknown, status = 200) =>
          ({ ok: status < 400, status, json: async () => body, text: async () => "" }) as Response;
        if (init?.method === "POST" && url.includes("/api/notes")) {
          return new Promise<Response>((resolve) => {
            answerCreate = resolve;
          });
        }
        if (url.includes("/api/notes?")) return json(SEED_ONLY);
        return json(null, 404);
      }),
    );
    const first = render(
      <Wrap>
        <Composer vault={VAULT} />
      </Wrap>,
    );
    const input = await screen.findByRole("textbox", { name: /what's on your mind\?/i });
    fireEvent.change(input, { target: { value: "saved while leaving" } });
    fireEvent.click(screen.getByRole("button", { name: /save to default/i }));
    await waitFor(() => expect(answerCreate).not.toBeNull());
    first.unmount();
    // The unmount flush kept the words while the save was still unanswered.
    expect(loadDraft("v1", NEW_NOTE_SCOPE)?.body.content).toBe("saved while leaving");

    answerCreate!({
      ok: true,
      status: 201,
      json: async () => ({ id: "made-1", path: "Notes/x", createdAt: "2026-10-30T12:00:00Z" }),
      text: async () => "",
    } as Response);
    await waitFor(() => expect(loadDraft("v1", NEW_NOTE_SCOPE)).toBeNull());

    // Back on Home: the composer opens empty, nothing to save twice.
    render(
      <Wrap>
        <Composer vault={VAULT} />
      </Wrap>,
    );
    expect(await screen.findByRole("textbox", { name: /what's on your mind\?/i })).toHaveValue("");
  });

  it("a failed save leaves the draft in the store", async () => {
    installRoutedFetch({ notes: SEED_ONLY, createStatus: 500 });
    renderComposer();
    const input = await screen.findByRole("textbox", { name: /what's on your mind\?/i });
    fireEvent.change(input, { target: { value: "not saved yet" } });
    fireEvent.click(screen.getByRole("button", { name: /save to default/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.focusOut(input);
    expect(loadDraft("v1", NEW_NOTE_SCOPE)?.body.content).toBe("not saved yet");
  });

  it("the mic honors the transcription gate: disabled vault → no mic, the honest line", async () => {
    installRoutedFetch({
      notes: SEED_ONLY,
      apiVault: { name: "default", transcription: { enabled: false } },
    });
    renderComposer();
    const input = await screen.findByRole("textbox", { name: /what's on your mind\?/i });
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: /record a voice note/i })).toBeNull(),
    );
    // The honest line surfaces with the expanded card (same two-door copy
    // as /new's recorder slot).
    fireEvent.focus(input);
    expect(await screen.findByTestId("voice-unavailable")).toHaveTextContent(
      /isn't enabled on this vault/i,
    );
  });
});
