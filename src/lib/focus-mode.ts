import { create } from "zustand";

// Ephemeral UI state for POLISH-WAVE PR 4 — "one gesture and the room goes
// quiet." Deliberately NOT persisted (no localStorage, unlike text-size):
// focus is a per-visit posture, not a preference. `FocusModeMount`
// (components/FocusModeMount.tsx) resets `on` to false on every route
// change, so the store itself never needs to know which route it's on —
// this file stays a plain on/off flag, same shape as `useQuickSwitchOpen`.
interface FocusModeState {
  on: boolean;
  setOn(next: boolean): void;
  toggle(): void;
}

export const useFocusMode = create<FocusModeState>((set) => ({
  on: false,
  setOn(next) {
    set({ on: next });
  },
  toggle() {
    set((s) => ({ on: !s.on }));
  },
}));

// Focus mode is scoped to the reading/writing rooms only (POLISH-WAVE PR 4
// §"Spec": "only /n/:id and /n/:id/edit may enter") — not a global mode.
// Matched against `useLocation().pathname`, which React Router has already
// stripped of the mount `basename`, so this holds under any mount base
// (/notes/, /surface/<slug>/, …) without threading the base through here.
const FOCUSABLE_PATH = /^\/n\/[^/]+(\/edit)?$/;

export function isFocusablePath(pathname: string): boolean {
  return FOCUSABLE_PATH.test(pathname);
}
