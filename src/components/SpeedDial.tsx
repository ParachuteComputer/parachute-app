import { IconImport, IconMic, IconPen, IconPlus } from "@/components/NavIcons";
import { isCeremonyPath } from "@/lib/nav/model";
import { useVaultStore } from "@/lib/vault/store";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";

// The desktop capture speed-dial (W2-9, adopt #5 — prototype
// `15-home-fab-speed-dial-menu.png`): a floating coral "+" disc in the
// top-right corner that expands DOWNWARD into three capture verbs, each a
// label pill beside a forest icon disc:
//
//   New note     → /new
//   Voice note   → /new?voice=1  (lands in voice capture, no extra tap)
//   Import notes → /import
//
// Tablet + desktop, ≥md (`hidden md:block`). On a PHONE the BottomTabBar's
// raised centre [+] stays the one capture gesture and hops straight to /new —
// a second stacked menu on a phone would slow the thing the phone is built
// around. The gate follows the bar's: the bar is `md:hidden` since the tablet
// band went to the NavDrawer (which, like the Rail, carries no capture verb),
// so without this at md there would be no capture affordance on a tablet at
// all. The breakpoint contract test pins the gate.
//
// Placement: top-right, clear of everything else floating — the AmbientMapFab
// lives bottom-right (md:bottom-6) and the palette pill floats bottom-centre,
// so the two coral discs can never stack. Hidden on ceremony routes (§4.1
// rule 5 — no chrome noise under "Making a place for moss…") and on /new
// itself (you're already holding the pen — same rule as the Map FAB hiding
// on /map).
export function SpeedDial() {
  const hasVault = useVaultStore((s) => s.activeVaultId !== null);
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Route change closes the dial (a verb click navigates; the menu must not
  // linger over the destination). Also covers back/forward.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not a value used in the body
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes and hands focus back to the trigger; click-outside closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (!hasVault) return null;
  if (isCeremonyPath(pathname)) return null;
  if (pathname === "/new") return null;

  return (
    <div ref={rootRef} className="fixed top-6 right-6 z-30 hidden md:block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close create menu" : "Create"}
        aria-expanded={open}
        aria-controls={menuId}
        title={open ? undefined : "Create"}
        className="focus-ring grid h-12 w-12 place-items-center rounded-full bg-accent text-(--color-on-accent) shadow-lift transition-transform duration-(--dur-move) ease-out hover:scale-105 hover:bg-accent-hover motion-reduce:hover:scale-100"
      >
        <span
          aria-hidden="true"
          className={`transition-transform duration-(--dur-move) ease-out ${open ? "rotate-45" : ""}`}
        >
          <IconPlus width={24} height={24} strokeWidth={2} />
        </span>
      </button>

      {open ? (
        <div id={menuId} aria-label="Create" className="mt-3 flex flex-col items-end gap-3">
          <Verb to="/new" label="New note" icon={<IconPen width={18} height={18} />} />
          <Verb to="/new?voice=1" label="Voice note" icon={<IconMic width={18} height={18} />} />
          <Verb to="/import" label="Import notes" icon={<IconImport width={18} height={18} />} />
        </div>
      ) : null}
    </div>
  );
}

// One verb row — label pill (card surface) beside a forest icon disc, per the
// prototype's dark-disc grammar (the ink colour carries it in both themes:
// forest discs by day, cream discs by night). The whole row is one link.
function Verb({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      data-speed-dial-verb={label}
      className="focus-ring group flex items-center gap-3 rounded-full"
    >
      <span className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-fg shadow-soft transition-colors duration-(--dur-quick) ease-out group-hover:border-accent/50">
        {label}
      </span>
      <span
        aria-hidden="true"
        className="grid h-11 w-11 place-items-center rounded-full bg-fg text-bg shadow-soft transition-transform duration-(--dur-move) ease-out group-hover:scale-105 motion-reduce:group-hover:scale-100"
      >
        {icon}
      </span>
    </Link>
  );
}
