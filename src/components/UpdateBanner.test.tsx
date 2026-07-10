import { UpdateBanner } from "@/components/UpdateBanner";
import { __resetReloadArmedForTests } from "@/lib/pwa";
import { __getPwaTestRig, __getPwaUpdateCalls, __resetPwaTestRig } from "@/test/stubs/pwa-register";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The `virtual:pwa-register/react` module is aliased to a test stub (see
// vitest.config.ts) that returns needRefresh=false by default. This smoke
// test proves the component imports the stub, renders without crashing,
// and correctly renders nothing when there's no pending update.
describe("UpdateBanner", () => {
  beforeEach(() => {
    __resetPwaTestRig();
    __resetReloadArmedForTests();
  });
  afterEach(() => {
    __resetPwaTestRig();
    __resetReloadArmedForTests();
    // Clean up our navigator.serviceWorker stub between tests so an absent
    // SW container in the next test still reflects the production default.
    // Assign undefined rather than delete — biome flags `delete` as a perf
    // anti-pattern and Object.defineProperty with value:undefined matches
    // jsdom's "absent property" behaviour for `"serviceWorker" in navigator`
    // checks downstream.
    try {
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: undefined,
      });
    } catch {
      // Some jsdom builds make this non-configurable; best-effort.
    }
  });

  it("renders nothing when there is no pending service-worker update", () => {
    render(<UpdateBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("auto-applies a ready update (no prompt): calls updateServiceWorker(true) AND arms controllerchange", async () => {
    // autoUpdate policy: a new deploy applies automatically — no visible
    // "reload" button. On needRefresh the updater calls updateServiceWorker(true)
    // (skipWaiting) and arms its OWN controllerchange listener + fallback timeout
    // FIRST, so a missed-by-workbox `controlling` event still reloads exactly
    // once (notes#148; window.location.reload is non-configurable in jsdom, so
    // pwa.test.ts covers the actual reload half).
    const swContainer = {
      addEventListener: vi.fn(),
    };
    // Stub navigator.serviceWorker so the production code path can attach
    // its listener. The default jsdom navigator has no serviceWorker
    // property at all.
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: swContainer,
    });

    render(<UpdateBanner />);
    // No user action — flipping needRefresh drives the auto-apply effect.
    await act(async () => {
      __getPwaTestRig()?.setNeedRefresh(true);
      await Promise.resolve();
    });

    // No "reload" button is ever rendered — the update is silent.
    expect(screen.queryByRole("button", { name: /reload/i })).not.toBeInTheDocument();
    // (1) updateServiceWorker(true) is messaged so the waiting SW skips waiting.
    expect(__getPwaUpdateCalls()).toEqual([true]);
    // (2) Our own controllerchange listener was attached BEFORE the skipWaiting
    // message so a missed workbox `controlling` event still triggers the reload.
    expect(swContainer.addEventListener).toHaveBeenCalledWith(
      "controllerchange",
      expect.any(Function),
      expect.objectContaining({ once: true }),
    );
  });
});
