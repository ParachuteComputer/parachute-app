import { useRegisterSW } from "virtual:pwa-register/react";
import { reloadAfterServiceWorkerUpdate } from "@/lib/pwa";
import { shouldRegisterServiceWorker } from "@/lib/sw-bootstrap";

/**
 * Silent auto-updater that drives `useRegisterSW`. Split out from the
 * exported `UpdateBanner` shim so the hook only runs when the runtime
 * mount matches the build-time vite base — calling `useRegisterSW` at a
 * mismatched mount would register the SW with the wrong scope (the bug
 * Aaron hit 2026-05-23). React hooks can't be conditional within a single
 * component, but conditional *rendering* of the child component is fine.
 *
 * autoUpdate policy (parachute-app): a new deploy applies automatically —
 * no "reload" prompt. The judge URL is iterated on + shown to Aaron, so a
 * returning visitor must never be stuck on a stale bundle behind a button.
 *
 * How the reload ACTUALLY runs (vite-plugin-pwa build register, `registerType:
 * "autoUpdate"` → `auto=true`): the generated SW self-`skipWaiting`s +
 * `clientsClaim`s, and the plugin fires `onNeedReload()` on the new worker's
 * `activated` (isUpdate/isExternal) event — REPLACING its default
 * `window.location.reload()`. (The `needRefresh`/`waiting`/`updateServiceWorker`
 * prompt path is dead in this mode — `updateServiceWorker(true)` is a no-op —
 * so we don't touch it.) We route `onNeedReload` through
 * `reloadAfterServiceWorkerUpdate`: it arms a one-shot `controllerchange`
 * listener + a fallback timeout and reloads exactly once, so a browser that
 * drops the reload (iOS standalone / BFCache) still recovers — reload has
 * bitten us before (notes#148/#165). Renders no UI.
 */
function UpdateBannerInner() {
  useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check for a fresh SW hourly while the app is open, so a long-lived
      // session picks up a new deploy without a manual reload.
      if (!registration) return;
      const hour = 60 * 60 * 1000;
      setInterval(() => {
        registration.update().catch(() => {});
      }, hour);
    },
    onNeedReload() {
      reloadAfterServiceWorkerUpdate();
    },
  });

  return null;
}

/**
 * Mount-gated SW registration. The PWA service worker and manifest are
 * baked at Vite build time with a fixed scope (root `/` for this app); when
 * the bundle is served at a different mount (e.g. `/surface/notes/` under
 * parachute-surface), registering the SW there interferes with every fetch
 * — workbox can't find precached entries for the runtime mount and ends
 * up returning HTML for what should be JS modules / JSON manifests.
 *
 * We mount the inner updater (and let it call `useRegisterSW`) only when
 * the runtime mount matches the build-time base. Otherwise we render
 * nothing — no SW registration. PWA install requires a custom build with
 * `VITE_BASE_PATH=<runtime-mount>` for non-default mounts.
 */
export function UpdateBanner() {
  if (!shouldRegisterServiceWorker()) return null;
  return <UpdateBannerInner />;
}
