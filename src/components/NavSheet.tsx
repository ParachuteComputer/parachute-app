import { InstallPrompt } from "@/components/InstallPrompt";
import { PinnedNotesSubList, isPinnedRow } from "@/components/PinnedNotesSubList";
import { TextSizeControl } from "@/components/TextSizeControl";
import { ThemeToggle } from "@/components/ThemeToggle";
import { VaultSwitcher } from "@/components/VaultSwitcher";
import { type NavBand, type NavItem, type NavLocation, useNavBands } from "@/lib/nav/model";
import { useVaultStore } from "@/lib/vault";
import { Fragment, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";

// The mobile NavSheet (DESIGN-SPEC §2.3) — the ☰ junk-drawer menu's
// replacement. A bottom sheet whose content is EXACTLY the rail's bands in
// the rail's order, rendered from the same `useNavBands()` model (the F14
// fix): switcher band on top (§2.4, inline rows — not a nested popover) →
// YOUR NOTES (the lens set) → EXPLORE → YOUR PARACHUTE → SET UP → foot
// (Settings + the ☰ era's extras: InstallPrompt · TextSizeControl ·
// ThemeToggle).
//
// Two entry points, one surface: the header's ☰ button and its vault pill
// both open THIS sheet (the pill lands focus on the switcher band) — no
// second menu vocabulary. Tags and Vaults become reachable on mobile for the
// first time (F14; they were 0-tap-unreachable before).
//
// Chrome: fixed bottom sheet, max-h-[85dvh], rounded top, glass over a scrim,
// drag handle. Dialog semantics: focus-trapped, closes on scrim tap / Escape /
// swipe-down / route change (the owner closes on pathname change).
//
// PHONE ONLY (`md:hidden`) — the breakpoint contract has three bands, not two:
// phone (<768px) = BottomTabBar + THIS sheet · tablet (768–1023px) = the
// docked `NavDrawer` · desktop (>=1024px) = the Rail. The drawer is the
// deliberate counterpart to this sheet, not a variant of it: persistent handle
// instead of a hidden ☰, docked instead of modal, no scrim/focus-trap/scroll-
// lock. A tablet is not a big phone, and this sheet is the phone's answer.
// The pinned invariant lives in `navigation-breakpoint-contract.test.tsx`.

export interface NavSheetProps {
  open: boolean;
  onClose: () => void;
  /** The vault-pill entry — land focus on the switcher band. */
  initialFocus?: "switcher";
}

export function NavSheet({ open, onClose, initialFocus }: NavSheetProps) {
  if (!open) return null;
  return <NavSheetPanel onClose={onClose} initialFocus={initialFocus} />;
}

function NavSheetPanel({ onClose, initialFocus }: Omit<NavSheetProps, "open">) {
  const hasVaults = useVaultStore((s) => Object.keys(s.vaults).length > 0);
  const bands = useNavBands();
  // The whole location — the Pinned/Archive lenses match on `?view=` (LZ-2).
  const location = useLocation();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const switcherRef = useRef<HTMLDivElement | null>(null);
  const touchStartY = useRef<number | null>(null);

  const rooms = bands.filter((b) => b.id !== "foot");
  const foot = bands.find((b) => b.id === "foot");

  // Focus management: trap focus in the sheet while open; restore the
  // trigger's focus on close. The vault-pill entry lands on the switcher band.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const target =
      initialFocus === "switcher"
        ? (switcherRef.current?.querySelector<HTMLElement>("button, a") ?? panelRef.current)
        : panelRef.current;
    target?.focus();
    return () => previouslyFocused?.focus?.();
  }, [initialFocus]);

  // Escape closes; Tab wraps (a minimal trap — the sheet is the only
  // interactive layer while open, the scrim covers everything else).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      // If focus is currently OUTSIDE the trap — the panel container itself
      // (tabIndex -1) or the scrim button, which lives outside panelRef — a
      // Tab/Shift+Tab would walk out to the page behind the scrim. Pull it
      // back in instead (B1: the trap must not leak backwards).
      const activeEl = document.activeElement;
      if (!(activeEl instanceof HTMLElement) || !focusables.includes(activeEl)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Body scroll lock while the sheet is up — the page behind must not scroll
  // under the scrim.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Swipe-down to close: a downward drag that starts with the sheet's own
  // scroll at the top reads as "dismiss", not "scroll".
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current =
      panelRef.current && panelRef.current.scrollTop <= 0 ? e.touches[0].clientY : null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    if (e.touches[0].clientY - touchStartY.current > 64) {
      touchStartY.current = null;
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      {/* Scrim — tap to close. */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="enter-fade absolute inset-0 h-full w-full cursor-default bg-black/40"
      />
      {
        // biome-ignore lint/a11y/useSemanticElements: a native <dialog> needs imperative showModal(); this sheet manages its own focus + scrim.
        <div
          role="dialog"
          ref={panelRef}
          aria-modal="true"
          aria-label="Menu"
          tabIndex={-1}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          className="enter-rise glass-panel absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-[var(--radius-2xl)] shadow-lift"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {/* Drag handle. */}
          <div aria-hidden className="sticky top-0 z-10 flex justify-center pt-2.5 pb-1.5">
            <span className="h-1 w-10 rounded-full bg-border" />
          </div>

          {/* The hinge — §2.4's row model inline, when there's anything to hinge. */}
          {hasVaults ? (
            <div
              ref={switcherRef}
              data-nav-band="switcher"
              className="border-b border-border-light"
            >
              <VaultSwitcher variant="sheet" onAction={onClose} />
            </div>
          ) : null}

          {/* The rooms — the SAME bands as the desktop rail, same order. Inside
            an aria-modal dialog the BottomTabBar's Primary landmark is hidden
            from AT, so the label doesn't collide while the sheet is up. */}
          {rooms.length > 0 ? (
            <nav aria-label="Primary" className="px-3 pb-1">
              {rooms.map((band) => (
                <SheetBand key={band.id} band={band} />
              ))}
            </nav>
          ) : null}

          {/* Foot — Settings pinned, plus the ☰ era's utility extras. */}
          <div data-nav-band="foot" className="border-t border-border px-3 py-3">
            {foot?.items.map((item) => (
              <SheetRow key={item.id} item={item} loc={location} />
            ))}
            <div className="mt-2 flex flex-wrap items-center gap-3 px-3">
              <InstallPrompt />
              <TextSizeControl />
              <ThemeToggle />
            </div>
          </div>
        </div>
      }
    </div>
  );
}

function SheetBand({ band }: { band: NavBand }) {
  const location = useLocation();
  return (
    <div data-nav-band={band.id}>
      {band.label ? (
        <p className="eyebrow flex items-baseline gap-2 px-3 pt-4 pb-1.5">
          <span>{band.label}</span>
          {band.sublabel ? (
            <span className="font-round text-2xs normal-case text-fg-dim">{band.sublabel}</span>
          ) : null}
        </p>
      ) : null}
      {band.items.map((item) => (
        <Fragment key={item.id}>
          <SheetRow item={item} loc={location} />
          {/* Pinned-note parity — the third projection #131 deferred. The
              sheet is only MOUNTED while open, so the five-row fetch is paid
              on a ☰ tap, never at rest. Closing on tap is the owner's job
              here (the sheet already closes on pathname change), so no
              onNavigate. */}
          {isPinnedRow(band.id, item.id) ? <PinnedNotesSubList variant="touch" /> : null}
        </Fragment>
      ))}
    </div>
  );
}

// The sheet's row — the §3 row pattern at thumb scale: icon · label · badge,
// grass-soft active pill (never underline/border selection).
function SheetRow({ item, loc }: { item: NavItem; loc: NavLocation }) {
  const active = item.match(loc);
  return (
    <Link
      to={item.to}
      data-nav-item={item.id}
      aria-current={active ? "page" : undefined}
      className={`focus-ring flex items-center gap-3 rounded-lg px-3 py-2.5 font-round text-base transition-colors duration-(--dur-quick) ease-out ${
        active
          ? "bg-grass-soft font-semibold text-grass-ink"
          : "font-medium text-fg-muted hover:bg-bg hover:text-fg"
      }`}
    >
      <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center">
        {item.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge}
    </Link>
  );
}
