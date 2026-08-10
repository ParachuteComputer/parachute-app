import { InstallPrompt } from "@/components/InstallPrompt";
import { IconChevronLeft, IconSearch } from "@/components/NavIcons";
import { PinnedNotesSubList, isPinnedRow } from "@/components/PinnedNotesSubList";
import { TextSizeControl } from "@/components/TextSizeControl";
import { ThemeToggle } from "@/components/ThemeToggle";
import { VaultSwitcher } from "@/components/VaultSwitcher";
import { type NavBand, type NavItem, type NavLocation, useNavBands } from "@/lib/nav/model";
import { useQuickSwitchOpen } from "@/lib/quick-switch/open-store";
import { useVaultStore } from "@/lib/vault";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";

// The TABLET nav drawer — the md→lg band's one primary-navigation projection
// (the three-band breakpoint contract, notes#147 as amended; see
// `navigation-breakpoint-contract.test.tsx` for the pinned invariant).
//
// Why it exists: the contract used to be BINARY — Rail at lg+, BottomTabBar +
// modal NavSheet below it — so an iPad in portrait (768–834px) got a phone's
// treatment: no persistent nav at all, tap ☰ for a bottom sheet. The middle
// tier now has a surface of its own.
//
// The shape (`hidden md:flex lg:hidden`):
//   · CLOSED — a 56px slim edge rail pinned to the left of the content, always
//     visible: a 44px handle button plus a quiet vertical grip. Nav is
//     DISCOVERABLE without tapping anything, which was the whole gap.
//   · OPEN — the same element widens to 288px and DOCKS beside the content as
//     a flex sibling, exactly the way the desktop Rail does. No scrim, no
//     focus trap, no body-scroll lock: this is persistent chrome, not a modal,
//     and that is precisely what distinguishes it from the NavSheet (which
//     stays the phone projection, <768px).
//
// Docked-and-reflowing rather than overlaid because the app shell ALREADY
// solves that case: `AppShell`'s row is a `md:flex` container whose first
// child is the nav and whose second is `min-w-0 flex-1` content, so animating
// this element's width reflows the content column for free — no fixed
// positioning, no z-index stack, no layout shift the shell doesn't already
// handle for the Rail's own collapse. At the narrowest tablet width the open
// drawer leaves 480px of content; the drawer opens on demand and closes on
// navigate, so that is a transient state, not the resting one.
//
// Touch-first: every hit target is >= 44px (handle 44x44; rows `py-2.5` at
// `text-base` = 44px, the NavSheet's proven thumb scale — NOT the Rail's
// 36px mouse rows, and deliberately NOT the Rail's hover-oriented collapsed
// icon mode).
//
// Bands come from `useNavBands()` — the ONE nav model the Rail and the
// NavSheet also render (F14: no projection owns a room list, so three
// projections still cannot disagree about what the rooms are). The utility
// foot (InstallPrompt · TextSizeControl · ThemeToggle) comes with the
// NavSheet's foot rather than the Rail's: those three had NO home above the
// sheet, so a tablet that no longer gets the sheet must carry them here.
//
// Open state is per-session React state, deliberately NOT persisted — the
// handle is the durable affordance, and a drawer that restores itself open
// would hand a 768px tablet a 480px content column on arrival.

/** The `<nav>` the handle discloses — only in the DOM while open. */
const DRAWER_PANEL_ID = "nav-drawer-panel";

export function NavDrawer() {
  const vault = useVaultStore((s) => s.getActiveVault());
  const bands = useNavBands();
  // The whole location — the Pinned/Archive lenses match on `?view=` (LZ-2).
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);

  // Escape closes — the drawer is not modal, so this is a convenience, not the
  // dialog contract the NavSheet owes. Two rules that convenience must respect:
  //   · `defaultPrevented` — an overlay ABOVE the drawer (the command palette,
  //     opened from the drawer's own Search) handles its own Escape first; a
  //     blind listener here would collapse the drawer underneath it too.
  //   · focus must not be dropped on the floor. The panel unmounts on close, so
  //     if focus was INSIDE it, it would land on <body> and a keyboard user
  //     would have to tab in from the top of the document. Put it back on the
  //     handle — the element the drawer collapses into. If focus was elsewhere
  //     (someone typing in the surface behind), leave it exactly where it is:
  //     closing chrome must never steal the caret.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const focusWasInside = rootRef.current?.contains(document.activeElement) ?? false;
      setOpen(false);
      if (focusWasInside) handleRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Back/forward (and any nav the drawer's own rows didn't originate) slides it
  // shut, so you never land on a destination with the drawer still eating the
  // content column. PATHNAME only, never the search string: VaultSurface
  // mirrors its live filters into `?search=&tag=` with `replace: true`
  // (NAVIGATION.md, "All-lens filter writeback"), and closing on that would
  // slam the drawer shut while someone types in the surface behind it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not a value used in the body
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  if (!vault) return null;

  const rooms = bands.filter((b) => b.id !== "foot");
  const foot = bands.find((b) => b.id === "foot");

  return (
    <div
      ref={rootRef}
      data-nav-projection="drawer"
      data-drawer-open={open ? "true" : "false"}
      // Width animates on --dur-move (the motion-token vocabulary) — zeroed
      // under prefers-reduced-motion at the token layer, so the slide stills
      // itself without a per-callsite `motion-reduce:`.
      //
      // The widths are 3.5rem/18rem (`w-14`/`w-72`) PLUS the left safe-area
      // inset, with that inset also paid as padding. A big phone in LANDSCAPE
      // is ≥768px CSS px (an iPhone Pro Max is 932), so it lands in the tablet
      // band and its notch sits exactly where this rail does — the Rail never
      // had to care, because nothing that wide is a phone at `lg`. Adding the
      // inset to the padding alone would eat the handle's 44px target out of a
      // fixed 56px rail; adding it to BOTH keeps the rail 56px of usable width
      // beside the notch. Insets are 0 everywhere else, so this is a no-op on
      // every tablet.
      className={`glass-panel sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border pl-[env(safe-area-inset-left)] transition-[width] duration-(--dur-move) ease-out md:flex lg:hidden ${
        open
          ? "w-[calc(18rem+env(safe-area-inset-left))]"
          : "w-[calc(3.5rem+env(safe-area-inset-left))]"
      }`}
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* The landmark is PERMANENT — present closed as well as open, so a
          screen-reader user in the tablet band can jump to navigation and land
          on the handle rather than on nothing. Named distinctly from the Rail's
          "Primary" complementary landmark and the BottomTabBar's "Primary"
          navigation landmark: the breakpoint contract is CSS-only, so all three
          projections share one DOM (only `display: none` keeps the other two out
          of the a11y tree) and a repeated landmark name would be ambiguous. */}
      <nav aria-label="Vault navigation" className="flex min-h-0 flex-1 flex-col">
        {/* The handle row. The toggle keeps ONE position in the tree across both
            states so a keyboard user's focus survives the slide. Closed padding
            is `p-1` on purpose: `box-sizing: border-box` means `w-14` (56px)
            minus the 1px right border leaves 55px, and 4 + 44 + 4 = 52 fits
            where `p-1.5`'s 6 + 44 + 6 = 56 would have squeezed the 44px target. */}
        <div
          className={`flex shrink-0 items-start justify-center gap-1.5 ${open ? "p-1.5" : "p-1"}`}
        >
          {open ? (
            <div className="min-w-0 flex-1">
              <VaultSwitcher variant="rail" />
            </div>
          ) : null}
          <button
            ref={handleRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={open ? DRAWER_PANEL_ID : undefined}
            aria-label={open ? "Close the navigation drawer" : "Open the navigation drawer"}
            title={open ? "Close navigation" : "Open navigation"}
            className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-lg text-fg-dim transition-colors duration-(--dur-quick) ease-out hover:bg-bg hover:text-fg-muted"
          >
            <span
              aria-hidden
              className={`transition-transform duration-(--dur-move) ease-out ${open ? "" : "rotate-180"}`}
            >
              <IconChevronLeft width={20} height={20} />
            </span>
          </button>
        </div>

        {open ? (
          <>
            <div className="shrink-0 px-3 pb-3">
              <DrawerSearch onDone={close} />
            </div>

            <div
              id={DRAWER_PANEL_ID}
              className="enter-fade min-h-0 flex-1 overflow-y-auto px-3 pb-3"
            >
              {rooms.map((band) => (
                <DrawerBand key={band.id} band={band} onNavigate={close} />
              ))}
            </div>

            <div
              data-nav-band="foot"
              className="enter-fade shrink-0 border-t border-border px-3 py-3"
            >
              {foot?.items.map((item) => (
                <DrawerRow key={item.id} item={item} loc={location} onNavigate={close} />
              ))}
              {/* The sheet's utility trio — homeless above <768px until now. */}
              <div className="mt-2 flex flex-wrap items-center gap-3 px-3">
                <InstallPrompt />
                <TextSizeControl />
                <ThemeToggle />
              </div>
            </div>
          </>
        ) : (
          // The grip — a vertical echo of the NavSheet's drag handle, so the
          // closed rail reads as something you pull rather than a blank margin.
          <div aria-hidden className="mt-1 flex justify-center">
            <span className="h-10 w-1 rounded-full bg-border-light" />
          </div>
        )}
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer primitives. Each projection owns its own row rendering (the NavSheet
// does the same) — what is shared is the MODEL, never the markup: the rail's
// rows are mouse-scale, these are thumb-scale.
// ---------------------------------------------------------------------------

function DrawerBand({ band, onNavigate }: { band: NavBand; onNavigate: () => void }) {
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
          <DrawerRow item={item} loc={location} onNavigate={onNavigate} />
          {/* Pinned-note parity (app#131 deferred this to the tablet work).
              Only mounted while the drawer is OPEN — the closed 56px rail has
              no room for titles, which is also why the fetch costs nothing at
              rest. Tapping a pinned note closes the drawer, same as any room:
              you asked for a destination. */}
          {isPinnedRow(band.id, item.id) ? (
            <PinnedNotesSubList variant="touch" onNavigate={onNavigate} />
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

// Icon · label · badge with the grass-soft active pill (§3's row pattern), at
// the sheet's thumb scale. Tapping a room slides the drawer back in: the point
// of the tap was the destination, and a docked panel would keep 288px of the
// tablet's width after you got there.
function DrawerRow({
  item,
  loc,
  onNavigate,
}: {
  item: NavItem;
  loc: NavLocation;
  onNavigate: () => void;
}) {
  const active = item.match(loc);
  return (
    <Link
      to={item.to}
      data-nav-item={item.id}
      onClick={onNavigate}
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

// Search opens the command palette, which is a full-screen overlay — so the
// drawer gets out of its way on the way through.
function DrawerSearch({ onDone }: { onDone: () => void }) {
  const setOpen = useQuickSwitchOpen((s) => s.setOpen);
  return (
    <button
      type="button"
      onClick={() => {
        setOpen(true);
        onDone();
      }}
      className="focus-ring flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left font-round text-base text-fg-dim transition-colors duration-(--dur-quick) ease-out hover:border-accent/50 hover:text-fg-muted"
    >
      <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center">
        <IconSearch width={18} height={18} />
      </span>
      <span className="flex-1">Search…</span>
    </button>
  );
}
