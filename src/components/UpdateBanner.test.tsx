import { UpdateBanner } from "@/components/UpdateBanner";
import { __resetReloadArmedForTests } from "@/lib/pwa";
import { __getPwaTestRig, __resetPwaTestRig } from "@/test/stubs/pwa-register";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The `virtual:pwa-register/react` module is aliased to a test stub (see
// vitest.config.ts). With `registerType: "autoUpdate"` the SHIPPING reload path
// is the plugin's `onNeedReload` callback (fired on the new SW's `activated`
// event) — NOT the prompt-mode `needRefresh`/`updateServiceWorker` branch, which
// is dead in auto mode. These tests exercise the real path only.
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
    try {
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: undefined,
      });
    } catch {
      // Some jsdom builds make this non-configurable; best-effort.
    }
  });

  it("renders nothing — autoUpdate is silent, no reload prompt or button", () => {
    render(<UpdateBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reload/i })).not.toBeInTheDocument();
  });

  it("routes the plugin's onNeedReload (autoUpdate `activated` path) through the one-shot controllerchange reload", () => {
    // In autoUpdate mode the plugin invokes `onNeedReload` on the new SW's
    // `activated` event, REPLACING its default `window.location.reload()`. We
    // route it through `reloadAfterServiceWorkerUpdate`, which arms a one-shot
    // `controllerchange` listener + a fallback timeout so the reload happens
    // exactly once even if the browser drops the event (notes#148/#165). This
    // is the shipping path — there is no prompt-mode button to click, and
    // `updateServiceWorker(true)` is a no-op in auto mode, so we don't touch it.
    const swContainer = {
      addEventListener: vi.fn(),
    };
    // Stub navigator.serviceWorker so reloadAfterServiceWorkerUpdate can attach
    // its listener. The default jsdom navigator has no serviceWorker property.
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: swContainer,
    });

    render(<UpdateBanner />);
    // No user action — model the plugin firing onNeedReload on `activated`.
    act(() => {
      __getPwaTestRig()?.triggerNeedReload();
    });

    // Our one-shot controllerchange listener was armed — the belt-and-suspenders
    // reload is REAL on the auto path (not asserting a dead prompt-mode path).
    expect(swContainer.addEventListener).toHaveBeenCalledWith(
      "controllerchange",
      expect.any(Function),
      expect.objectContaining({ once: true }),
    );
  });
});
