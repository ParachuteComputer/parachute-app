import { IconMap } from "@/components/NavIcons";
import { MAP_TO } from "@/lib/nav/model";
import { useMapEarned } from "@/lib/vault/map-earned";
import { useVaultStore } from "@/lib/vault/store";
import { useViewModifiedBar } from "@/lib/views/modified-bar";
import { Link, useLocation } from "react-router";

// The Map's ambient home (SYNTHESIS D5). Until the Map earns a nav slot
// (`useMapEarned`), it lives here: a quiet bottom-right button that opens the
// existing vault graph — on BOTH form factors. Once earned, the nav row takes
// over on both (rail on desktop, NavSheet on mobile — W2-5 / route-map row
// 11), so the FAB hides on both; it never doubles up with a nav row. (Pre-W2-5
// it hid on desktop only, because mobile had no earned-gated nav row to hand
// off to — that asymmetry was half of F14.)
//
// It sits above the PHONE bottom-tab bar (5rem plus the home-indicator inset,
// since the bar itself grows by that inset) and drops to the corner as soon as
// that bar is gone (md:bottom-6). The clearance tracks the BAR's
// gate, not the Rail's: the bar went `md:hidden` when the tablet band became
// the NavDrawer's (notes#147, three bands), so holding this at `lg:` would
// float the FAB 80px up from a tablet's corner with nothing underneath it.
// Hidden on the graph route itself — you're already
// there. Uses ONLY the shipped graph route; no new backend.
//
export function useAmbientMapFabShown(): boolean {
  const hasVault = useVaultStore((s) => s.activeVaultId !== null);
  const earned = useMapEarned();
  const modifiedBarShown = useViewModifiedBar((s) => s.shown);
  const { pathname } = useLocation();

  if (!hasVault) return false;
  if (earned) return false;
  if (pathname === MAP_TO) return false;
  // A view's "View modified — Save / Revert" bar docks in this same corner
  // at the same z (views train B) — the FAB would paint over / steal taps
  // from Save on phones and ~1024-1250px desktops, so it yields while the
  // bar is up and returns the moment the exploration ends.
  return !modifiedBarShown;
}

export function AmbientMapFab() {
  if (!useAmbientMapFabShown()) return null;

  return (
    <Link
      to={MAP_TO}
      aria-label="Open the relational map"
      title="Your map"
      className="focus-ring fixed right-5 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 grid h-12 w-12 place-items-center rounded-full border border-border bg-card text-accent shadow-lg hover:border-accent md:right-6 md:bottom-6"
    >
      <IconMap width={22} height={22} />
    </Link>
  );
}

// The FAB floats over the page, so while it's up on a phone the content column
// ends with this spacer: with the column's own pb-16 (the bar) it leaves 9rem —
// the FAB's 5rem offset + its 3rem + a 1rem gap — so the last line can always
// scroll out from under the button (newcomer walk snag 12). The body already
// pays the home-indicator inset. The View-modified strip takes the FAB's place
// in that corner and is no taller, so it keeps the same room — which also stops
// the page jumping when the strip comes and goes. A leaf of its own so the
// map-earned cache read re-renders this div, not the app shell.
export function MapFabClearance() {
  const fabShown = useAmbientMapFabShown();
  const modifiedBarShown = useViewModifiedBar((s) => s.shown);
  if (!fabShown && !modifiedBarShown) return null;
  return <div aria-hidden="true" data-map-fab-clearance="" className="h-20 shrink-0 md:hidden" />;
}
