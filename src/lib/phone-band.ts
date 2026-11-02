import { useSyncExternalStore } from "react";

// The phone band: below Tailwind's default `md` breakpoint (768px), the same
// boundary every `md:hidden` / `hidden md:*` gate uses. CSS does the band's
// work almost everywhere; this JS copy is for the few places it can't (DOM
// order, force-closing a CSS-hidden sheet on resize).
export const PHONE_BAND_QUERY = "(max-width: 767.98px)";

function hasMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function subscribe(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => {};
  const mql = window.matchMedia(PHONE_BAND_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function isPhoneBand(): boolean {
  return hasMatchMedia() && window.matchMedia(PHONE_BAND_QUERY).matches;
}

/** True while the viewport is in the phone band; false where it can't tell. */
export function usePhoneBand(): boolean {
  return useSyncExternalStore(subscribe, isPhoneBand, () => false);
}
