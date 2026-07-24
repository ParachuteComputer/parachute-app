import { Toaster } from "@/components/Toaster";
import { useToastStore } from "@/lib/toast/store";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The per-toast duration (views train A): a microconfirmation rides a short
// `durationMs` and auto-dismisses on its own clock; a toast without one keeps
// the 4s default. (The Toaster resets surviving toasts' timers whenever the
// list changes — pre-existing behavior the assertions below account for.)

describe("Toaster durations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.getState().clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dismisses a durationMs toast on its own clock; default toasts keep 4s", () => {
    render(<Toaster />);
    act(() => {
      useToastStore.getState().push("✓ status → done", "success", { durationMs: 1800 });
      useToastStore.getState().push("plain info");
    });
    expect(screen.getByText("✓ status → done")).toBeInTheDocument();
    expect(screen.getByText("plain info")).toBeInTheDocument();

    // The microconfirmation goes at 1800ms; the default toast survives it.
    act(() => vi.advanceTimersByTime(1800));
    expect(screen.queryByText("✓ status → done")).toBeNull();
    expect(screen.getByText("plain info")).toBeInTheDocument();

    // The dismissal re-armed the survivor's timer (pre-existing reset-on-change
    // behavior) — it goes a full default window later, not before.
    act(() => vi.advanceTimersByTime(3999));
    expect(screen.getByText("plain info")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("plain info")).toBeNull();
  });
});
