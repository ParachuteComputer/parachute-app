import { IconNotes, IconPlus, IconSearch } from "@/components/NavIcons";
import { RECENT_TO, matchVaultSurface } from "@/lib/nav/model";
import { useQuickSwitchOpen } from "@/lib/quick-switch/open-store";
import { useVaultStore } from "@/lib/vault";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

// Mobile + tablet fixed bottom navigation — LENS-SPEC §5.2's 3-slot bar
// (ratified D2): Notes · [ + ] · Search, where the centre + is a raised
// capture action, not a peer tab. One surface ⇒ ONE surface tab: "Notes"
// goes to `/` (the Recent lens is the front door) and stays lit across the
// whole surface — `/`, `/notes` in every `?view=` dress, and the drill-ins
// (/n/:id, /today?date=) that stay under it. WHICH lens you're wearing is
// the on-surface LensStrip's job — carrying the lens set in the bar too is
// the redundancy D2 rejected.
//
// PHONE ONLY (`md:hidden`). The notes#147 contract is THREE bands now, not
// two: phone (<768px) = this bar + the modal NavSheet · tablet (768–1023px) =
// the docked NavDrawer (`hidden md:flex lg:hidden`) · desktop (>=1024px) =
// the Rail (`hidden lg:flex`). Exactly one primary-nav projection shows at
// every width, and this gate is the phone end of it: drifting it back to
// `lg:hidden` would put the bar and the drawer on screen together on a
// tablet. The pinned invariant lives in
// `navigation-breakpoint-contract.test.tsx`.
//
// Settings left the bottom bar with the D6 pass — it lives behind the header
// ⋯ menu and in the desktop rail foot (the dissolved console is a room, not a
// tab).
export function BottomTabBar() {
  const hasActiveVault = useVaultStore((s) => s.activeVaultId !== null);
  const setSwitcherOpen = useQuickSwitchOpen((s) => s.setOpen);
  const location = useLocation();

  if (!hasActiveVault) return null;

  // Active-state grammar comes from the shared nav model (W2-5) — the tab
  // bar is a projection of the model, so it can't drift from the Rail/
  // NavSheet's matching rules. `matchVaultSurface` is the union of the four
  // lens matchers' territory: the Pinned/Archive lenses light THIS tab now
  // (they're the one surface too), never a separate All/Pinned tab.
  const isSurface = matchVaultSurface(location);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-(--w-page) items-stretch justify-around px-2">
        <Tab to={RECENT_TO} label="Notes" active={isSurface} icon={<IconNotes />} />
        <CenterCapture />
        <TabButton label="Search" icon={<IconSearch />} onClick={() => setSwitcherOpen(true)} />
      </ul>
    </nav>
  );
}

function Tab({
  to,
  label,
  icon,
  active,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  active: boolean;
}) {
  return (
    <li className="flex-1">
      <Link
        to={to}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={`focus-ring flex h-14 flex-col items-center justify-center gap-0.5 text-2xs ${
          active ? "text-accent" : "text-fg-muted hover:text-accent"
        }`}
      >
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </Link>
    </li>
  );
}

function TabButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <li className="flex-1">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="focus-ring flex h-14 w-full flex-col items-center justify-center gap-0.5 text-2xs text-fg-muted hover:text-accent"
      >
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </button>
    </li>
  );
}

// The centre + — the primary capture action (D6). A raised coral disc, bigger
// than the tabs and lifted above the bar, so "write something" is the one
// gesture the phone is built around. Taps into the unified create surface
// (/new), where voice capture also lives.
function CenterCapture() {
  return (
    <li className="flex flex-1 items-center justify-center">
      <Link
        to="/new"
        aria-label="New note"
        className="focus-ring -mt-4 grid h-[3.25rem] w-[3.25rem] place-items-center rounded-full bg-accent text-(--color-on-accent) shadow-lg transition-colors hover:bg-accent-hover"
      >
        <IconPlus width={26} height={26} strokeWidth={2} />
      </Link>
    </li>
  );
}
