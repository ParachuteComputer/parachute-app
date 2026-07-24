import { create } from "zustand";

// Ephemeral UI flag: is the "View modified — Save / Revert" bar on screen?
// (views train B, review must-fix). The bar and the AmbientMapFab both dock
// bottom-right at the same z — on phones and ~1024-1250px desktops the FAB
// painted over / stole taps from Save — so the FAB hides while the bar is
// shown. Same shape and non-persistence rationale as `useFocusMode`
// (src/lib/focus-mode.ts): a per-visit posture, never a preference. The bar
// component sets it on mount and clears it on unmount (Revert / Save /
// leaving the route all unmount the bar), so the store never needs to know
// about routes.
interface ViewModifiedBarState {
  shown: boolean;
  setShown(next: boolean): void;
}

export const useViewModifiedBar = create<ViewModifiedBarState>((set) => ({
  shown: false,
  setShown(next) {
    set({ shown: next });
  },
}));
