import { IconChevronLeft, IconSearch } from "@/components/NavIcons";
import { ThemeToggle } from "@/components/ThemeToggle";
import { VaultSwitcher } from "@/components/VaultSwitcher";
import { type NavBand, type NavItem, useNavBands } from "@/lib/nav/model";
import { useQuickSwitchOpen } from "@/lib/quick-switch/open-store";
import { useVaultStore } from "@/lib/vault";
import { useCallback, useState } from "react";
import { Link, useLocation } from "react-router";

// The desktop left rail — the app's spine on wide screens (DESIGN-SPEC §2.2;
// prototype scenes 10–12). Rendered `hidden lg:flex`; below lg the mobile
// chrome (Header + NavSheet + BottomTabBar) takes over. Reading top→bottom:
//
//   · the vault switcher (the hinge — identity leads everything) + the
//     collapse toggle,
//   · a quiet Search affordance (opens the command palette),
//   · YOUR NOTES — the lens set: Recent · All notes · Pinned · Archive (LZ-2),
//   · EXPLORE — Calendar · Tags · Activity · Map(earned),
//   · YOUR PARACHUTE — Account & plan · Vaults · Connect AI · Import notes,
//   · SET UP — the guided shelf, hidden once done or dismissed,
//   · Settings, pinned to the foot (theme toggle keeps its spot).
//
// The bands come from `useNavBands()` — the ONE nav model the mobile NavSheet
// also renders (F14: neither projection owns a room list, so they can't
// disagree). Collapses to a 64px icon rail (icons only, title tooltips),
// persisted in localStorage("parachute.rail-collapsed"). Returns null with no
// active vault (the no-vault desktop view is the full-width Landing).

const RAIL_COLLAPSED_KEY = "parachute.rail-collapsed";

function useRailCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RAIL_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setCollapsed((cur) => {
      const next = !cur;
      try {
        localStorage.setItem(RAIL_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // storage unavailable — the state still flips for this session.
      }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

export function Rail() {
  const vault = useVaultStore((s) => s.getActiveVault());
  const bands = useNavBands();
  const [collapsed, toggleCollapsed] = useRailCollapsed();

  if (!vault) return null;

  const rooms = bands.filter((b) => b.id !== "foot");
  const foot = bands.find((b) => b.id === "foot");

  return (
    <aside
      aria-label="Primary"
      // Width animates 300ms (spec §1.2 micro-motion) — disabled under
      // prefers-reduced-motion like every other transition in the app.
      className={`glass-panel sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border transition-[width] duration-300 motion-reduce:transition-none lg:flex ${
        collapsed ? "w-16" : "w-60"
      }`}
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className={collapsed ? "flex flex-col items-stretch gap-2 p-3" : "p-3"}>
        <div className={collapsed ? "" : "flex items-start gap-1.5"}>
          <div className="min-w-0 flex-1">
            <VaultSwitcher variant="rail" collapsed={collapsed} />
          </div>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand" : "Collapse"}
            className={`focus-ring grid shrink-0 place-items-center rounded-lg text-fg-dim hover:bg-bg hover:text-fg-muted ${
              collapsed ? "mx-auto mt-2 h-8 w-8" : "h-9 w-7"
            }`}
          >
            <span
              aria-hidden
              className={`transition-transform duration-300 motion-reduce:transition-none ${collapsed ? "rotate-180" : ""}`}
            >
              <IconChevronLeft width={16} height={16} />
            </span>
          </button>
        </div>
        <RailSearch collapsed={collapsed} />
      </div>

      <nav aria-label="Your vault" className="flex-1 overflow-y-auto px-3 pb-3">
        {rooms.map((band) => (
          <RailBand key={band.id} band={band} collapsed={collapsed} />
        ))}
      </nav>

      <div data-nav-band="foot" className="border-t border-border p-3">
        {foot?.items.map((item) =>
          collapsed ? (
            <RailLink key={item.id} item={item} collapsed />
          ) : (
            <div key={item.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <RailLink item={item} collapsed={false} />
              </div>
              {/* Appearance lived in the old desktop ⋯ overflow; the rail foot
                  is its calm home (a quiet icon, no label — Neil's air). */}
              <ThemeToggle />
            </div>
          ),
        )}
        {collapsed ? (
          <div className="mt-1 flex justify-center">
            <ThemeToggle />
          </div>
        ) : null}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Rail primitives — one band, one row. Collapsed: icons only, tooltips carry
// the labels, section labels hide.
// ---------------------------------------------------------------------------

function RailBand({ band, collapsed }: { band: NavBand; collapsed: boolean }) {
  return (
    <div data-nav-band={band.id}>
      {band.label && !collapsed ? (
        <p className="eyebrow flex items-baseline gap-2 px-3 pt-4 pb-1.5">
          <span>{band.label}</span>
          {band.sublabel ? (
            <span className="font-round text-2xs normal-case text-fg-dim">{band.sublabel}</span>
          ) : null}
        </p>
      ) : null}
      {band.label && collapsed ? (
        // The collapsed rail keeps the band SEAM (a hairline breath) so the
        // two zones stay visually distinct even without their labels.
        <div aria-hidden className="mx-2 mt-3 mb-2 border-t border-border-light" />
      ) : null}
      {band.items.map((item) => (
        <RailLink key={item.id} item={item} collapsed={collapsed} />
      ))}
    </div>
  );
}

function RailLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  // The whole location, not just the pathname — the Pinned/Archive lenses
  // live in the `?view=` param (LZ-2's search-aware match).
  const location = useLocation();
  const active = item.match(location);
  return (
    <Link
      to={item.to}
      data-nav-item={item.id}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      className={`focus-ring flex items-center rounded-lg font-round text-sm transition-colors ${
        collapsed ? "justify-center px-0 py-2" : "gap-3 px-3 py-2"
      } ${
        active
          ? "bg-grass-soft font-semibold text-grass-ink"
          : "font-medium text-fg-muted hover:bg-bg hover:text-fg"
      }`}
    >
      <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center">
        {item.icon}
      </span>
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.badge}
        </>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Search — opens the command palette (⌘K). Kept in the rail so desktop users
// have a visible Search entry now that the old header row is gone.
// ---------------------------------------------------------------------------

function RailSearch({ collapsed }: { collapsed: boolean }) {
  const setOpen = useQuickSwitchOpen((s) => s.setOpen);
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        title="Search (⌘K)"
        className="focus-ring mx-auto grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-fg-dim transition-colors hover:border-accent/50 hover:text-fg-muted"
      >
        <IconSearch width={16} height={16} />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="focus-ring mt-2 flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left font-round text-sm text-fg-dim transition-colors hover:border-accent/50 hover:text-fg-muted"
    >
      <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center">
        <IconSearch width={16} height={16} />
      </span>
      <span className="flex-1">Search…</span>
      <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 font-round text-[10px] text-fg-dim">
        ⌘K
      </kbd>
    </button>
  );
}
