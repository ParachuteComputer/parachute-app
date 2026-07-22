import { MirrorStatusLine } from "@/components/MirrorStatusLine";
import type { MirrorSlice } from "@/lib/mirror/types";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Drive the two inputs the line reads: the mirror slice + the vault's
// point-in-time note count (the hydration denominator). The wire field is
// `totalNotes` (both daemons) — the SDK's stale `noteCount` is deliberately
// exercised as a separate case to prove the line no longer reads it.
const { holder } = vi.hoisted(() => ({
  holder: {
    mirror: null as MirrorSlice | null,
    stats: undefined as { totalNotes?: number; noteCount?: number } | undefined,
  },
}));

vi.mock("@/providers/SyncProvider", () => ({
  useSync: () => ({ mirror: holder.mirror }),
}));
vi.mock("@/lib/vault/queries", () => ({
  useVaultInfo: () => ({ data: { stats: holder.stats } }),
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
    holder.stats = undefined;
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

  it("shows the hydration progress line as 'N of ~T' from totalNotes", () => {
    holder.mirror = slice({ state: "hydrating", progress: { done: 3 } });
    holder.stats = { totalNotes: 10 };
    render(<MirrorStatusLine />);
    expect(screen.getByText(/Saving your vault for offline · 3 of ~10/)).toBeInTheDocument();
  });

  it("falls back to a bare count when the total isn't known yet", () => {
    holder.mirror = slice({ state: "hydrating", progress: { done: 5 } });
    holder.stats = undefined;
    render(<MirrorStatusLine />);
    expect(screen.getByText(/Saving your vault for offline · 5$/)).toBeInTheDocument();
  });

  it("does NOT read the stale `noteCount` field — falls back to bare N when only noteCount is present", () => {
    // Regression for #79 item 3: the wire never sends `noteCount`; a payload
    // carrying only it must not surface as the denominator.
    holder.mirror = slice({ state: "hydrating", progress: { done: 7 } });
    holder.stats = { noteCount: 10 };
    render(<MirrorStatusLine />);
    expect(screen.getByText(/Saving your vault for offline · 7$/)).toBeInTheDocument();
  });

  it("silences the ticking hydration progress for screen readers (aria-live=off)", () => {
    // #77: the count re-announces on each synced page during cold hydration.
    // Keep it visible but drop it from the live region.
    holder.mirror = slice({ state: "hydrating", progress: { done: 3 } });
    holder.stats = { totalNotes: 10 };
    render(<MirrorStatusLine />);
    expect(screen.getByText(/Saving your vault for offline/)).toHaveAttribute("aria-live", "off");
  });

  it("still announces the offline state transition (no aria-live=off)", () => {
    holder.mirror = slice({ state: "offline", lastSyncedAt: Date.now() - 60_000 });
    render(<MirrorStatusLine />);
    // The implicit `status` role (polite) stays — no explicit aria-live override.
    expect(screen.getByText(/showing your saved vault/i)).not.toHaveAttribute("aria-live");
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
