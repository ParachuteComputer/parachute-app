import {
  TEXT_SIZES,
  type TextSize,
  applyTextSize,
  nextTextSize,
  previousTextSize,
  readStoredTextSize,
  textSizeLabel,
  writeStoredTextSize,
} from "@/lib/text-size";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Header chrome control + global keyboard shortcuts for text-size. The
// Settings dropdown (notes#123) is canonical for "set my preferred size";
// this surface exists because text-zoom is an in-the-moment action (notes
// #127: "usually I'm in the middle of typing a note when I want to
// increase the size"). Two paths:
//
//   1. Click the "Aa" button (`TextSizeControl`) → 3-option popover.
//   2. Cmd+Plus / Cmd+Minus / Cmd+0 — bound by `TextSizeShortcutsMount`,
//      which is rendered once at the app root so the listener never
//      double-binds when the mobile menu (a second `TextSizeControl`
//      instance) opens.
//
// Both invoke the same store + apply helpers from lib/text-size.ts —
// localStorage is the single source of truth so all surfaces (Settings,
// header button, shortcuts) stay synchronized via the storage key. The
// local `size` state in `TextSizeControl` is just a UI mirror so the
// popover renders the right "current" pill; it's read fresh from
// localStorage by the global shortcut handler so a click on one surface
// doesn't stale-out the other.

// Custom event the popover listens for so the visible "current" indicator
// stays in sync when the keyboard shortcut (or any other same-tab caller)
// changes the size. `storage` events don't fire on the writer tab, so we
// need a same-tab signal alongside the cross-tab one.
const TEXT_SIZE_CHANGE_EVENT = "notes:text-size-change";

function broadcast(next: TextSize) {
  writeStoredTextSize(next);
  applyTextSize(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<TextSize>(TEXT_SIZE_CHANGE_EVENT, { detail: next }));
  }
}

// Mount once at the app root — renders no DOM. Separate from the visible
// `TextSizeControl` because the Header renders that twice (desktop +
// mobile menu) and we don't want two keydown listeners firing in parallel
// when both surfaces are mounted.
export function TextSizeShortcutsMount() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.altKey || e.shiftKey) return;
      // Cmd+= / Cmd+Plus — many keyboards report "=" without shift even
      // for the visible Plus glyph (same physical key). Treat both as
      // "step up".
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        broadcast(nextTextSize(readStoredTextSize()));
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        broadcast(previousTextSize(readStoredTextSize()));
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        broadcast("default");
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

// Popover viewport clearance, px, kept on both axes so the panel never
// touches the screen edge (tablet Safari's rounded corners + gesture bar eat
// a few px too).
const VIEWPORT_MARGIN = 8;

export function TextSizeControl() {
  const [size, setSize] = useState<TextSize>(() => readStoredTextSize());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Where the popover renders. The control sits at the FOOT of every
  // container it's mounted in (desktop rail, mobile/tablet NavSheet bottom
  // sheet) — opening downward unconditionally (the old behavior) pushes the
  // panel below the sheet/viewport whenever the trigger is near the bottom
  // edge. `placement` flips it upward when there isn't room below;
  // `leftOverridePx` clamps the panel horizontally so it can't cross either
  // side of the viewport (same risk if the trigger sits near a screen edge).
  // `null` means "no measurement yet — fall back to the default `right-0`
  // anchor," so first paint looks exactly like before this fix in the
  // common (non-clipping) case.
  const [placement, setPlacement] = useState<"up" | "down">("down");
  const [leftOverridePx, setLeftOverridePx] = useState<number | null>(null);

  // Wraps the persist+apply+mirror trio so callers (popover buttons,
  // future onChange consumers) don't have to remember the order. Also
  // broadcasts the same-tab change event so a sibling TextSizeControl
  // (mobile menu) sees the new value without waiting for storage tick.
  const set = useCallback((next: TextSize) => {
    setSize(next);
    broadcast(next);
  }, []);

  // Stay in sync when *another* surface changes the size. `storage` covers
  // the cross-tab case (Settings in tab A → header in tab B); the custom
  // `TEXT_SIZE_CHANGE_EVENT` covers the same-tab case (shortcut fires while
  // popover is open, or sibling TextSizeControl in the mobile menu writes).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "notes:textSize") return;
      setSize(readStoredTextSize());
    };
    const onLocal = (e: Event) => {
      const detail = (e as CustomEvent<TextSize>).detail;
      if (detail) setSize(detail);
      else setSize(readStoredTextSize());
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(TEXT_SIZE_CHANGE_EVENT, onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(TEXT_SIZE_CHANGE_EVENT, onLocal);
    };
  }, []);

  // Close the popover on click-outside. Same shape as SyncStatusIndicator.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Measure-and-flip: on open, read the trigger's real on-screen position
  // (`getBoundingClientRect` is viewport-relative regardless of how many
  // scrollable ancestors — e.g. the NavSheet bottom sheet — sit in between)
  // and the panel's own size, then decide placement + a horizontal clamp.
  // `useLayoutEffect` so this resolves before the browser paints — no
  // visible flash of the wrong position. Recomputes on resize/scroll while
  // open (rail collapse, keyboard-triggered viewport resize, sheet scroll)
  // via a capturing `scroll` listener, which is how you observe scroll on
  // ANY nested scrollable ancestor since `scroll` doesn't bubble.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const trigger = rootRef.current;
      const panel = popoverRef.current;
      if (!trigger || !panel) return;

      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const panelHeight = panelRect.height || panel.offsetHeight;
      const panelWidth = panelRect.width || panel.offsetWidth;

      const spaceBelow = window.innerHeight - triggerRect.bottom;
      setPlacement(spaceBelow < panelHeight + VIEWPORT_MARGIN ? "up" : "down");

      // Mirror the default `right-0` anchor (panel's right edge == trigger's
      // right edge), then clamp so neither edge crosses the viewport.
      const desiredLeft = triggerRect.right - panelWidth;
      const minLeft = VIEWPORT_MARGIN;
      const maxLeft = Math.max(minLeft, window.innerWidth - panelWidth - VIEWPORT_MARGIN);
      const clampedLeft = Math.min(Math.max(desiredLeft, minLeft), maxLeft);
      setLeftOverridePx(clampedLeft - triggerRect.left);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`Text size: ${textSizeLabel(size)}. Click to change.`}
        aria-expanded={open}
        title={`Text size: ${textSizeLabel(size)}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-card px-2 py-1.5 text-sm text-fg-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span aria-hidden="true" className="font-serif">
          A<span className="text-xs">a</span>
        </span>
      </button>

      {open ? (
        // biome-ignore lint/a11y/useSemanticElements: a native <dialog> requires imperative show()/showModal() calls; this is a popover, not a modal.
        <div
          role="dialog"
          ref={popoverRef}
          aria-label="Text size"
          data-placement={placement}
          className={`enter-rise absolute right-0 z-30 w-40 rounded-md border border-border bg-card p-2 text-sm shadow-lg ${
            placement === "up" ? "bottom-full mb-2" : "mt-2"
          }`}
          style={
            leftOverridePx != null ? { left: `${leftOverridePx}px`, right: "auto" } : undefined
          }
        >
          <ul className="flex flex-col gap-0.5">
            {TEXT_SIZES.map((s) => {
              const active = s === size;
              return (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => {
                      set(s);
                      setOpen(false);
                    }}
                    aria-pressed={active}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-bg/60 ${
                      active ? "text-accent" : "text-fg-muted"
                    }`}
                  >
                    <span>{textSizeLabel(s)}</span>
                    {active ? (
                      <span aria-hidden="true" className="text-xs">
                        ✓
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
