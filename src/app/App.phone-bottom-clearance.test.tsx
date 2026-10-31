import { __resetDoorDescriptorCacheForTests } from "@/lib/account/descriptor";
import { MIRROR_FLAG_KEY } from "@/lib/mirror/flag";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

// Newcomer walk snag 12 (phone, 390×844): the "Now in {vault}" toast sat ON the
// bottom bar, hiding its raised +, and the ambient Map FAB covered the last
// content on every page. jsdom can't measure layout, so these pin the gates the
// layout hangs off — WHEN the toast lifts above the bar and WHEN the content
// column ends with room for the FAB. The geometry itself was measured in a real
// browser at 390×844 (see the PR).

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response("{}", { status: 404 })),
  );
}

function seedOneVault() {
  const record: VaultRecord = {
    id: "v-garden",
    url: "http://localhost:1940/vault/garden",
    name: "garden",
    issuer: "http://localhost:1940",
    clientId: "c",
    scope: "full",
    addedAt: "2026-10-30T00:00:00.000Z",
    lastUsedAt: "2026-10-30T00:00:00.000Z",
  };
  useVaultStore.setState({ vaults: { "v-garden": record }, activeVaultId: "v-garden" });
}

function toastRegion(message: string): HTMLElement {
  const region = screen.getByText(message).closest("output");
  if (!region) throw new Error("toast region not found");
  return region;
}

describe("App — phone bottom clearance (snag 12)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(MIRROR_FLAG_KEY, "false");
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    __resetDoorDescriptorCacheForTests();
    window.history.replaceState({}, "", "/notes/");
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lifts the toast above the bottom bar (and its raised +) while the bar is up", async () => {
    seedOneVault();
    render(<App />);
    await screen.findByRole("navigation", { name: "Primary" });
    act(() => {
      useToastStore.getState().push("Now in garden", "success");
    });
    const region = toastRegion("Now in garden");
    expect(region).toHaveAttribute("data-above-bottom-bar", "true");
    // From md up the bar is gone, so the toast keeps its corner offset there.
    expect(region.className).toMatch(/\bmd:bottom-6\b/);
  });

  it("keeps the toast at the screen edge when there is no bottom bar", async () => {
    render(<App />);
    act(() => {
      useToastStore.getState().push("Signed out", "info");
    });
    const region = toastRegion("Signed out");
    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    expect(region).not.toHaveAttribute("data-above-bottom-bar");
    expect(region.className).toMatch(/(^|\s)bottom-6\b/);
  });

  it("reserves room under the content for the Map FAB while the FAB is up", async () => {
    seedOneVault();
    render(<App />);
    await screen.findByRole("link", { name: /open the relational map/i });
    // The reserve closes the content column, after the footer.
    const column = document.querySelector("main")?.parentElement;
    expect(column?.lastElementChild).toHaveAttribute("data-map-fab-clearance");
  });

  it("drops the FAB reserve where the FAB is hidden (the map itself)", async () => {
    seedOneVault();
    window.history.replaceState({}, "", "/notes/map");
    render(<App />);
    await screen.findByRole("navigation", { name: "Primary" });
    expect(screen.queryByRole("link", { name: /open the relational map/i })).toBeNull();
    expect(document.querySelector("[data-map-fab-clearance]")).toBeNull();
  });
});
