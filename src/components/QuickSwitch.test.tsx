import { QuickSwitch } from "@/components/QuickSwitch";
import { QuickSwitchMount } from "@/components/QuickSwitchMount";
import { Rail } from "@/components/Rail";
import { NavBandsProvider } from "@/lib/nav/model";
import { useQuickSwitchOpen } from "@/lib/quick-switch/open-store";
import { pushRecent } from "@/lib/quick-switch/recents";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function seedStore() {
  useVaultStore.setState({
    vaults: {
      v1: {
        id: "v1",
        url: "http://localhost:1940",
        name: "default",
        issuer: "http://localhost:1940",
        clientId: "c",
        scope: "full",
        addedAt: "2026-04-18T00:00:00.000Z",
        lastUsedAt: "2026-04-18T00:00:00.000Z",
      },
    },
    activeVaultId: "v1",
  });
  localStorage.setItem(
    "lens:token:v1",
    JSON.stringify({ accessToken: "t", scope: "full", vault: "default" }),
  );
}

function installFetch(notes: unknown[], tags: unknown[] = []) {
  const impl = vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    if (url.includes("/api/tags")) {
      return { ok: true, status: 200, json: async () => tags, text: async () => "" } as Response;
    }
    return { ok: true, status: 200, json: async () => notes, text: async () => "" } as Response;
  });
  vi.stubGlobal("fetch", impl);
}

function LocationSpy() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function Wrap({ children, initial = "/" }: { children: ReactNode; initial?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <MemoryRouter initialEntries={[initial]}>
      <QueryClientProvider client={qc}>
        <LocationSpy />
        <Routes>
          <Route path="*" element={children} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("QuickSwitch", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  it("filters results as the user types and navigates on Enter", async () => {
    installFetch([
      { id: "canon", path: "Canon/Aaron.md", createdAt: "2026-04-18T00:00:00Z" },
      { id: "journal", path: "Journal/Day.md", createdAt: "2026-04-18T00:00:00Z" },
    ]);
    render(
      <Wrap>
        <QuickSwitch onClose={() => {}} />
      </Wrap>,
    );

    const input = screen.getByLabelText(/quick switch query/i);
    // Wait for the notes fetch to populate.
    await waitFor(() => expect(screen.queryByText(/loading notes/i)).not.toBeInTheDocument());

    fireEvent.change(input, { target: { value: "aaron" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/n/canon"));
  });

  it("arrow keys move the selection", async () => {
    installFetch([
      { id: "a", path: "Alpha.md", createdAt: "2026-04-18T00:00:00Z" },
      { id: "b", path: "Alphabet.md", createdAt: "2026-04-18T00:00:00Z" },
    ]);
    render(
      <Wrap>
        <QuickSwitch onClose={() => {}} />
      </Wrap>,
    );
    const input = screen.getByLabelText(/quick switch query/i);
    fireEvent.change(input, { target: { value: "alpha" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    // Second entry gets selected.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/n/b"));
  });

  it("Escape closes the switcher", async () => {
    installFetch([]);
    const onClose = vi.fn();
    render(
      <Wrap>
        <QuickSwitch onClose={onClose} />
      </Wrap>,
    );
    const input = screen.getByLabelText(/quick switch query/i);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows recent notes as the empty-query starting list", async () => {
    pushRecent("v1", "canon", 1);
    installFetch([
      { id: "canon", path: "Canon/Aaron.md", createdAt: "2026-04-18T00:00:00Z" },
      { id: "other", path: "Other.md", createdAt: "2026-04-18T00:00:00Z" },
    ]);
    render(
      <Wrap>
        <QuickSwitch onClose={() => {}} />
      </Wrap>,
    );
    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(options[0]?.textContent).toContain("Aaron");
    });
  });

  // W2-9 presentation: the pill's right slot is RESERVED for a future
  // "Smart" toggle — a visual placeholder only. It must be clearly inert:
  // not a control, hidden from AT, no handler to trigger.
  it("the reserved Smart slot is inert — a non-interactive, aria-hidden span", async () => {
    installFetch([]);
    render(
      <Wrap>
        <QuickSwitch onClose={() => {}} />
      </Wrap>,
    );
    const slot = screen.getByTestId("smart-slot-reserved");
    expect(slot.tagName).toBe("SPAN");
    expect(slot).toHaveAttribute("aria-hidden", "true");
    // Nothing happens on a click — the location is unchanged and the
    // palette stays put (no navigation, no toggle, no dialog).
    fireEvent.click(slot);
    expect(screen.getByTestId("location").textContent).toBe("/");
    expect(screen.getByLabelText(/quick switch query/i)).toBeInTheDocument();
  });

  // W2-9 mobile sheet: phones have no Esc key — the explicit Cancel closes.
  it("the Cancel button closes the palette (the mobile sheet's explicit exit)", async () => {
    installFetch([]);
    const onClose = vi.fn();
    render(
      <Wrap>
        <QuickSwitch onClose={onClose} />
      </Wrap>,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("> prefix surfaces commands — typing '>new' jumps to /new on Enter", async () => {
    installFetch([]);
    render(
      <Wrap>
        <QuickSwitch onClose={() => {}} />
      </Wrap>,
    );
    const input = screen.getByLabelText(/quick switch query/i);
    fireEvent.change(input, { target: { value: ">new" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/new"));
  });
});

describe("QuickSwitchMount", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useQuickSwitchOpen.setState({ open: false });
    seedStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useQuickSwitchOpen.setState({ open: false });
    localStorage.clear();
  });

  it("opens on Cmd+K and closes on a second press", async () => {
    installFetch([]);
    render(
      <Wrap>
        <QuickSwitchMount />
      </Wrap>,
    );
    expect(screen.queryByLabelText(/quick switch query/i)).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByLabelText(/quick switch query/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.queryByLabelText(/quick switch query/i)).not.toBeInTheDocument();
  });

  it("also opens on Ctrl+K for non-Mac users", () => {
    installFetch([]);
    render(
      <Wrap>
        <QuickSwitchMount />
      </Wrap>,
    );
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByLabelText(/quick switch query/i)).toBeInTheDocument();
  });

  it("does not hijack a plain 'k' keypress", () => {
    installFetch([]);
    render(
      <Wrap>
        <QuickSwitchMount />
      </Wrap>,
    );
    fireEvent.keyDown(window, { key: "k" });
    expect(screen.queryByLabelText(/quick switch query/i)).not.toBeInTheDocument();
  });

  // W2-9 done-when: the palette opens from all three doors. ⌘K and the
  // mobile Search tab are pinned above / in BottomTabBar.test — this pins
  // the third: the rail's Search row.
  it("opens from the desktop rail's Search row", async () => {
    installFetch([]);
    render(
      <Wrap>
        {/* Rail reads the nav model from context (app#110). */}
        <NavBandsProvider>
          <Rail />
        </NavBandsProvider>
        <QuickSwitchMount />
      </Wrap>,
    );
    expect(screen.queryByLabelText(/quick switch query/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(screen.getByLabelText(/quick switch query/i)).toBeInTheDocument();
  });

  it("closes the switcher when the active vault changes", async () => {
    installFetch([]);
    useVaultStore.setState({
      vaults: {
        v1: {
          id: "v1",
          url: "http://localhost:1940",
          name: "default",
          issuer: "http://localhost:1940",
          clientId: "c",
          scope: "full",
          addedAt: "2026-04-18T00:00:00.000Z",
          lastUsedAt: "2026-04-18T00:00:00.000Z",
        },
        v2: {
          id: "v2",
          url: "http://localhost:1940",
          name: "second",
          issuer: "http://localhost:1940",
          clientId: "c",
          scope: "full",
          addedAt: "2026-04-18T00:00:00.000Z",
          lastUsedAt: "2026-04-18T00:00:00.000Z",
        },
      },
      activeVaultId: "v1",
    });
    render(
      <Wrap>
        <QuickSwitchMount />
      </Wrap>,
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    expect(screen.getByLabelText(/quick switch query/i)).toBeInTheDocument();

    await act(async () => {
      useVaultStore.setState({ activeVaultId: "v2" });
    });

    expect(screen.queryByLabelText(/quick switch query/i)).not.toBeInTheDocument();
    expect(useQuickSwitchOpen.getState().open).toBe(false);
  });
});
