import { useRegisterSW } from "virtual:pwa-register/react";
import { reloadAfterServiceWorkerUpdate } from "@/lib/pwa";
import { shouldRegisterServiceWorker } from "@/lib/sw-bootstrap";
import { useEffect } from "react";

/**
 * Silent auto-updater that drives `useRegisterSW`. Split out from the
 * exported `UpdateBanner` shim so the hook only runs when the runtime
 * mount matches the build-time vite base — calling `useRegisterSW` at a
 * mismatched mount would register the SW with the wrong scope (the bug
 * Aaron hit 2026-05-23). React hooks can't be conditional within a single
 * component, but conditional *rendering* of the child component is fine.
 *
 * autoUpdate policy (parachute-app): when a new deploy is ready
 * (`needRefresh`), apply it AUTOMATICALLY and reload — no "reload" prompt.
 * The judge URL is iterated on + shown to Aaron, so a returning visitor must
 * never be stuck on a stale bundle behind a manual button. Renders no UI.
 */
function UpdateBannerInner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check for a fresh SW hourly while the app is open.
      if (!registration) return;
      const hour = 60 * 60 * 1000;
      setInterval(() => {
        registration.update().catch(() => {});
      }, hour);
    },
  });

  useEffect(() => {
    if (!needRefresh) return;
    // A new deploy is ready — apply it automatically. Arm our own
    // controllerchange listener + a hard timeout BEFORE asking the SW to
    // skipWaiting, so whichever fires first reloads the page exactly once
    // (notes#148 — vite-plugin-pwa's built-in `controlling` listener can be
    // missed on iOS standalone / BFCache). The reload swaps the new assets in
    // atomically, so skipWaiting never leaves stale JS requesting purged chunks.
    reloadAfterServiceWorkerUpdate();
    void updateServiceWorker(true);
  }, [needRefresh, updateServiceWorker]);

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
