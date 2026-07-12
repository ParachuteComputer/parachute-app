import { readFileSync } from "node:fs";
import { VaultSurface } from "@/app/routes/VaultSurface";
import { RecentTimeline } from "@/components/RecentTimeline";
import { useVaultStore } from "@/lib/vault/store";
import type { Note } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// W2-11 / F9 — the parity contract: the SAME note renders the SAME anatomy
// (dot/status · title · preview · time · chips) through the shared NoteRow on
// BOTH Today's timeline and the /notes list. Before this, Home and /notes
// each hand-rolled a row and the two had drifted (no dot, no pinned star, no
// archived state on Today). These tests pin the unification structurally —
// the /notes row and the Today row must be byte-identical markup.

function installFetch(state: { notes: unknown[]; tags: unknown[] }) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = url.includes("/api/tags") ? state.tags : state.notes;
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => "",
    } as Response;
  });
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
}

// A note exercising every slot of the anatomy: folder path (so the mono path
// line shows), preview, tags — plus a pinned variant and an archived variant.
const FULL_NOTE: Note = {
  id: "n1",
  path: "Projects/lens/README",
  preview: "A lens onto any Parachute Vault.",
  tags: ["project", "idea"],
  createdAt: "2026-04-18T10:00:00.000Z",
  updatedAt: "2026-04-18T11:00:00.000Z",
};

const PINNED_ARCHIVED_NOTES: Note[] = [
  { ...FULL_NOTE, id: "p1", path: "pinned-note", tags: ["pinned"] },
  { ...FULL_NOTE, id: "a1", path: "archived-note", tags: ["archived"] },
];

// Extract the one rendered note row (the `.note-row` wrapper's parent <li>)
// from a container. Scoped to the notes list to avoid other list items.
function rowFor(scope: HTMLElement, title: string): HTMLElement {
  const span = within(scope).getByText(title);
  const li = span.closest("li");
  if (!li) throw new Error(`no <li> around "${title}"`);
  return li as HTMLElement;
}

describe("NoteRow parity — Today and /notes render the same anatomy", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the SAME note renders byte-identical row markup on Today's timeline and the /notes list", async () => {
    installFetch({ notes: [FULL_NOTE], tags: [] });

    // /notes — the one surface (VaultSurface since LZ-3), All lens.
    const notesRender = render(<VaultSurface />, { wrapper: Wrapper });
    const notesList = await screen.findByRole("list", { name: "Notes" });
    const notesRow = rowFor(notesList as HTMLElement, "README");
    const notesRowHtml = notesRow.outerHTML;
    notesRender.unmount();

    // Today — the reading room (RecentTimeline is Home's list renderer).
    render(<RecentTimeline notes={[FULL_NOTE]} />, { wrapper: Wrapper });
    const todayRow = rowFor(document.body, "README");

    // Byte-identical markup = identical anatomy, identical order, identical
    // states. (The rooms differ only by their page width — page-prose vs
    // page — which lives outside the row.)
    expect(todayRow.outerHTML).toBe(notesRowHtml);

    // And the anatomy itself, spelled out: dot · title · path · preview ·
    // time · chips.
    expect(todayRow.querySelector(".note-dot")).not.toBeNull();
    expect(within(todayRow).getByText("README")).toBeInTheDocument();
    expect(within(todayRow).getByText("Projects/lens/README")).toBeInTheDocument();
    expect(within(todayRow).getByText("A lens onto any Parachute Vault.")).toBeInTheDocument();
    expect(within(todayRow).getByText("#project")).toBeInTheDocument();
    expect(within(todayRow).getByText("#idea")).toBeInTheDocument();
  });

  it("pinned and archived status render on Today's timeline too (the old divergence)", async () => {
    installFetch({ notes: PINNED_ARCHIVED_NOTES, tags: [] });
    render(<RecentTimeline notes={PINNED_ARCHIVED_NOTES} />, { wrapper: Wrapper });

    const pinnedRow = rowFor(document.body, "pinned-note");
    expect(within(pinnedRow).getByLabelText(/pinned/i)).toBeInTheDocument();

    const archivedRow = rowFor(document.body, "archived-note");
    expect(archivedRow.className).toMatch(/\bopacity-60\b/);
    expect(archivedRow.className).toMatch(/\bitalic\b/);
  });
});

describe("NoteRow — the §3 row pattern (grass-soft active, never underline-select)", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the stylesheet gives .note-row a grass-soft press state and a card-tint hover", () => {
    // The active/press state is grass-soft (the design system's row pattern),
    // defined once in index.css. Read the source stylesheet directly — the
    // vitest css pipeline doesn't hand back raw text.
    const indexCss = readFileSync("src/styles/index.css", "utf8");
    const activeRule = indexCss.match(/\.note-row:active\s*{[^}]*}/)?.[0] ?? "";
    expect(activeRule).toContain("--color-grass-soft");
    const hoverRule = indexCss.match(/\.note-row:hover\s*{[^}]*}/)?.[0] ?? "";
    expect(hoverRule).toContain("--color-card");
  });

  it("selection is never an underline — no underline classes anywhere in the row", async () => {
    installFetch({ notes: [FULL_NOTE], tags: [] });
    render(<RecentTimeline notes={[FULL_NOTE]} />, { wrapper: Wrapper });
    const row = rowFor(document.body, "README");
    for (const el of [row, ...Array.from(row.querySelectorAll("*"))]) {
      expect((el as HTMLElement).className).not.toMatch(/underline/);
    }
  });
});
