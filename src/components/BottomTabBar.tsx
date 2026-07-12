import { IconClock, IconNotes, IconPlus, IconSearch } from "@/components/NavIcons";
import { NOTES_TO, RECENT_TO, matchAllNotes, matchRecent } from "@/lib/nav/model";
import { useQuickSwitchOpen } from "@/lib/quick-switch/open-store";
import { useVaultStore } from "@/lib/vault";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

// Mobile + tablet fixed bottom navigation — the D6 four-slot set, in its
// LZ-2 interim dress: Recent · Notes · [ + ] · Search, where the centre + is
// a raised capture action, not a peer tab. LENS-SPEC §5's 3-slot bar is
// LZ-5's; until then the shipped 4-slot layout stays, but the "Today" tab is
// relabeled Recent NOW so the tab and the rail's Recent lens never disagree
// on what `/` is called (the F14 no-drift lesson). Hidden on >= lg where the
// desktop Rail handles navigation. The `lg:hidden` gate MUST match the
// Rail's `lg:flex` gate — at any width exactly one of them shows (the
// notes#147 contract, now Rail↔BottomTabBar).
//
// Settings left the bottom bar with the D6 pass — it lives behind the header
// ⋯ menu and in the desktop rail foot (the dissolved console is a room, not a
// tab). Reading a note (/n/:id) and the day drill-in (/today?date=) stay
// under Recent.
export function BottomTabBar() {
  const hasActiveVault = useVaultStore((s) => s.activeVaultId !== null);
  const setSwitcherOpen = useQuickSwitchOpen((s) => s.setOpen);
  const location = useLocation();

  if (!hasActiveVault) return null;

  // Active-state grammar comes from the shared nav model (W2-5) — the tab
  // bar is a subset projection of the notes band, so it can't drift from the
  // Rail/NavSheet's matching rules. Using the model's matchers verbatim means
  // the Pinned/Archive lenses (`/notes?view=…`) light NO tab here — those
  // lenses aren't in the 4-slot set (the NavSheet carries them until LZ-5).
  const isRecent = matchRecent(location);
  const isNotes = matchAllNotes(location);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-[--w-page] items-stretch justify-around px-2">
        <Tab to={RECENT_TO} label="Recent" active={isRecent} icon={<IconClock />} />
        <Tab to={NOTES_TO} label="Notes" active={isNotes} icon={<IconNotes />} />
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
        className="focus-ring -mt-4 grid h-[3.25rem] w-[3.25rem] place-items-center rounded-full bg-accent text-[--color-on-accent] shadow-lg transition-colors hover:bg-accent-hover"
      >
        <IconPlus width={26} height={26} strokeWidth={2} />
      </Link>
    </li>
  );
}
