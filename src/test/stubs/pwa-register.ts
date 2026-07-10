import { useState } from "react";

// Test stub for `virtual:pwa-register/react` — the real module is only
// resolved by vite-plugin-pwa at build time. In tests we return the minimal
// shape consumers rely on, plus a rig that models the AUTO-UPDATE path: with
// `registerType: "autoUpdate"` the plugin fires the caller's `onNeedReload`
// callback on the new SW's `activated` event (it replaces the default
// `window.location.reload()`). The rig lets a test invoke that callback and
// observe the reload wiring — the actual shipping path, not the dead
// prompt-mode `needRefresh` branch. Production code imports from this stub via
// the vitest alias.
export interface PwaTestRig {
  /**
   * Invoke the `onNeedReload` callback the app passed to `useRegisterSW` —
   * models the plugin firing it on the new SW's `activated` event in
   * autoUpdate mode.
   */
  triggerNeedReload: () => void;
}

interface RegisterSWStubOptions {
  onRegisteredSW?: (url: string, registration: unknown) => void;
  onNeedReload?: () => void;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
}

let rig: PwaTestRig | null = null;

export function useRegisterSW(options?: RegisterSWStubOptions) {
  // The prompt-mode state is retained only so the returned shape matches the
  // real hook; autoUpdate never flips it (updateServiceWorker is a no-op there).
  const needRefresh = useState(false);
  const offlineReady = useState(false);
  const updateServiceWorker = async () => {};
  rig = {
    triggerNeedReload: () => options?.onNeedReload?.(),
  };
  return { needRefresh, offlineReady, updateServiceWorker };
}

export function __getPwaTestRig(): PwaTestRig | null {
  return rig;
}

export function __resetPwaTestRig(): void {
  rig = null;
}
