import { IconShrink } from "@/components/NavIcons";
import { isFocusablePath, useFocusMode } from "@/lib/focus-mode";
import { useEffect } from "react";
import { useLocation } from "react-router";

// Mounted once inside <BrowserRouter> (needs route context for useLocation)
// — same "one listener at the root" shape as TextSizeShortcutsMount, so a
// second surface entering the tree never double-binds the keymap. Owns both
// route-scoped behaviors POLISH-WAVE PR 4 asks for:
//
//   1. The ⌘. door in — toggles focus mode, but only while sitting on a
//      focusable route (/n/:id or /n/:id/edit); elsewhere it's a no-op so
//      the shortcut can never arm a mode with nothing on screen to show it.
//   2. The route-change reset — focus mode is ephemeral (not persisted, per
//      focus-mode.ts), so ANY navigation — including the read↔edit hop on
//      the same note — leaves it behind. This is the primary mechanism;
//      AppShell's `isFocusablePath` render guard is the belt-and-suspenders
//      second check for the same invariant.
//
// Renders no DOM.
export function FocusModeMount() {
  const location = useLocation();
  const setOn = useFocusMode((s) => s.setOn);
  const toggle = useFocusMode((s) => s.toggle);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not a value read in the body
  useEffect(() => {
    setOn(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.altKey || e.shiftKey) return;
      if (e.key !== ".") return;
      if (!isFocusablePath(location.pathname)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [location.pathname, toggle]);

  return null;
}

// The universal door out (POLISH-WAVE PR 4: "a floating dismiss chip
// top-right"). Rendered by AppShell only while focus mode is active — the
// one exit affordance that works identically on both the read and edit
// routes, since ⌘. is silent chrome and Escape is edit-route-unsafe (Code-
// Mirror already binds Escape to cancel-edit, CodeMirrorEditor.tsx). Glass
// + enter-fade is the PR1 floating-surface family (TextSizeControl's
// popover, the slash menu); entrance-only per that PR's own rule — exit is
// an instant unmount, no deferred-unmount machinery for a one-frame
// dismissal.
export function FocusModeExitChip() {
  const setOn = useFocusMode((s) => s.setOn);
  return (
    <button
      type="button"
      onClick={() => setOn(false)}
      aria-label="Exit focus mode"
      title="Exit focus (⌘.)"
      className="glass-panel enter-fade focus-ring fixed top-4 right-4 z-30 grid h-10 w-10 place-items-center rounded-full border border-border text-fg-muted shadow-lift hover:text-accent"
      style={{ marginTop: "env(safe-area-inset-top)" }}
    >
      <IconShrink width={18} height={18} />
    </button>
  );
}
