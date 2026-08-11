import { NavSheet } from "@/components/NavSheet";
import { SyncStatusIndicator } from "@/components/SyncStatusIndicator";
import { VaultSwitcher } from "@/components/VaultSwitcher";
import { useVaultStore } from "@/lib/vault";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";

// PHONE top bar (`md:hidden`). On desktop the left Rail is the app's spine and
// this header is gone; at md–lg the NavDrawer is that spine and this header is
// gone too — the drawer carries the vault switcher itself (as the Rail does),
// so leaving the bar up would double the switcher AND leave a ☰ that opens a
// `md:hidden` NavSheet, i.e. a button that does nothing. Below md this bar +
// the BottomTabBar carry navigation and the NavSheet carries everything else.
// (Consequence, accepted: `SyncStatusIndicator` lives only here, so md+ has no
// sync chip — which is exactly the desktop Rail's long-standing state, not a
// tablet-specific hole.)
//
// The vault switcher pill leads the bar — the vault name is the identity spine
// on the phone exactly as in the desktop rail. W2-5 replaced the old ☰
// dropdown junk-drawer (Account/Settings/Connect/Map/… as a flat link pile —
// F14's mobile half) with the NavSheet: ☰ and the vault pill BOTH open the
// same bottom sheet rendering the same `useNavBands()` bands as the rail —
// the pill lands on its switcher band. One surface, two entry points, no
// separate menu vocabulary. With no vault, the bar shows the "Parachute"
// wordmark (the "No vault connected" state line died with the menu — F21).
// Mirrors the CSS band this header (and the NavSheet it owns) renders in
// (`md:hidden`, Tailwind's default 768px breakpoint) — see the force-close
// effect below for why a JS-side copy of that boundary is needed at all.
const PHONE_BAND_QUERY = "(max-width: 767.98px)";

export function Header() {
  const location = useLocation();
  const hasVaults = useVaultStore((s) => Object.keys(s.vaults).length > 0);
  const [sheet, setSheet] = useState<null | "menu" | "switcher">(null);

  // Close the sheet whenever the route changes — a tap on a nav link must not
  // leave the sheet open over the destination page (§2.3 close rules).
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not a value used in the body
  useEffect(() => {
    setSheet(null);
  }, [location.pathname]);

  // The NavSheet is CSS-hidden (`md:hidden`), never unmounted, while `sheet`
  // state lives HERE rather than inside it — so `sheet` can survive a resize
  // past the phone band. Rotate a phone from portrait (sheet open: body
  // scroll locked, Escape/Tab trap armed) to landscape >=768px and the
  // sheet's own close paths (scrim tap, Escape, swipe) are all inside the
  // subtree that just went `display: none`; nothing fires, so the page stays
  // scroll-locked and keyboard nav stays dead behind an invisible dialog. A
  // `matchMedia` listener on the same boundary the CSS uses force-closes the
  // moment the phone band is left, in either direction — mirrors NavDrawer's
  // tablet-band listener (NavDrawer.tsx).
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(PHONE_BAND_QUERY);
    const onChange = (e: MediaQueryListEvent) => {
      if (!e.matches) setSheet(null);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // UI-audit finding #10: the signed-out arrival screen (`/`, no vault
  // connected — front door / already-signed-in / net-error) renders its own
  // wordmark lockup (Landing.tsx's <Shell>). This bar's plain "Parachute"
  // link would stack a second wordmark directly above it, and its hamburger
  // has nothing meaningful to open with no session yet. Suppress the bar
  // there; every other no-vault route (e.g. /add, /welcome) keeps it.
  if (!hasVaults && location.pathname === "/") return null;

  return (
    <>
      <header
        className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur md:hidden"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <nav className="flex items-center justify-between gap-3 px-4 py-3">
          {hasVaults ? (
            <div className="min-w-0 flex-1">
              <VaultSwitcher variant="header" onOpenNavSheet={() => setSheet("switcher")} />
            </div>
          ) : (
            <Link
              to="/"
              className="focus-ring min-w-0 shrink truncate font-serif text-lg tracking-tight text-fg hover:text-accent"
            >
              Parachute
            </Link>
          )}

          <div className="flex shrink-0 items-center gap-2">
            {hasVaults ? <SyncStatusIndicator /> : null}
            {/* A pure opener: while the sheet is up its scrim covers this
                button, so closing belongs to the sheet (scrim/Escape/swipe). */}
            <button
              type="button"
              onClick={() => setSheet("menu")}
              aria-label="Open menu"
              aria-expanded={sheet !== null}
              aria-haspopup="dialog"
              className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-fg-muted hover:text-accent"
            >
              <span aria-hidden="true" className="font-mono text-base leading-none">
                ☰
              </span>
            </button>
          </div>
        </nav>
      </header>
      {/* Rendered OUTSIDE the <header> — its backdrop-filter would otherwise
          become the containing block for the sheet's fixed positioning. */}
      <NavSheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        initialFocus={sheet === "switcher" ? "switcher" : undefined}
      />
    </>
  );
}
