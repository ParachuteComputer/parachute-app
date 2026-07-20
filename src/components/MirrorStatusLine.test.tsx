import { MirrorStatusLine } from "@/components/MirrorStatusLine";
import type { MirrorSlice } from "@/lib/mirror/types";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Drive the two inputs the line reads: the mirror slice + the vault note count
// (for the hydration denominator).
const { holder } = vi.hoisted(() => ({
  holder: { mirror: null as MirrorSlice | null, noteCount: undefined as number | undefined },
}));

vi.mock("@/providers/SyncProvider", () => ({
  useSync: () => ({ mirror: holder.mirror }),
}));
vi.mock("@/lib/vault/queries", () => ({
  useVaultInfo: () => ({ data: { stats: { noteCount: holder.noteCount } } }),
}));

function slice(over: Partial<MirrorSlice>): MirrorSlice {
  return {
    enabled: true,
    state: "synced",
    lastSyncedAt: null,
    syncNow: async () => {},
    clearOffline: async () => {},
    ...over,
  };
}

describe("MirrorStatusLine", () => {
  afterEach(() => {
    holder.mirror = null;
    holder.noteCount = undefined;
  });

  it("shows the offline staleness line when offline with a saved vault", () => {
    holder.mirror = slice({ state: "offline", lastSyncedAt: Date.now() - 60_000 });
    render(<MirrorStatusLine />);
    expect(screen.getByText(/showing your saved vault/i)).toBeInTheDocument();
  });

  it("does NOT show the offline line before the first sync (no saved vault yet)", () => {
    holder.mirror = slice({ state: "offline", lastSyncedAt: null });
    const { container } = render(<MirrorStatusLine />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the hydration progress line with n/total during first hydration", () => {
    holder.mirror = slice({ state: "hydrating", progress: { done: 3 } });
    holder.noteCount = 10;
    render(<MirrorStatusLine />);
    expect(screen.getByText(/Saving your vault for offline · 3\/10/)).toBeInTheDocument();
  });

  it("falls back to a bare count when the total isn't known yet", () => {
    holder.mirror = slice({ state: "hydrating", progress: { done: 5 } });
    holder.noteCount = undefined;
    render(<MirrorStatusLine />);
    expect(screen.getByText(/Saving your vault for offline · 5$/)).toBeInTheDocument();
  });

  it("renders nothing when the mirror is off (flag-off inert) or synced", () => {
    holder.mirror = slice({ enabled: false, state: "off" });
    const { container, rerender } = render(<MirrorStatusLine />);
    expect(container).toBeEmptyDOMElement();

    holder.mirror = slice({ state: "synced", lastSyncedAt: Date.now() });
    rerender(<MirrorStatusLine />);
    expect(container).toBeEmptyDOMElement();
  });
});
