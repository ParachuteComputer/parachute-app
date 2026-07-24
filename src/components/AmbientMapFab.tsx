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
// It sits above the mobile bottom-tab bar (bottom-20) and drops to the corner
// on desktop (lg:bottom-6). Hidden on the graph route itself — you're already
// there. Uses ONLY the shipped graph route; no new backend.
export function AmbientMapFab() {
  const hasVault = useVaultStore((s) => s.activeVaultId !== null);
  const earned = useMapEarned();
  const modifiedBarShown = useViewModifiedBar((s) => s.shown);
  const { pathname } = useLocation();

  if (!hasVault) return null;
  if (earned) return null;
  if (pathname === MAP_TO) return null;
  // A view's "View modified — Save / Revert" bar docks in this same corner
  // at the same z (views train B) — the FAB would paint over / steal taps
  // from Save on phones and ~1024-1250px desktops, so it yields while the
  // bar is up and returns the moment the exploration ends.
  if (modifiedBarShown) return null;

  return (
    <Link
      to={MAP_TO}
      aria-label="Open the relational map"
      title="Your map"
      className="focus-ring fixed right-5 bottom-20 z-20 grid h-12 w-12 place-items-center rounded-full border border-border bg-card text-accent shadow-lg hover:border-accent lg:right-6 lg:bottom-6"
    >
      <IconMap width={22} height={22} />
    </Link>
  );
}
