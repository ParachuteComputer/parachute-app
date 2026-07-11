import { useCallback } from "react";
import { useNavigate } from "react-router";

/**
 * The history-aware escape rule (NAVIGATION.md § "The history-aware escape
 * rule"). Prefers going back in the browser's actual history stack — so a
 * "Maybe later" / "← Back" affordance lands wherever the user really came
 * from — but degrades to a named fallback route when there's genuinely
 * nothing behind the current entry (a fresh tab, a magic-link landing, a
 * deep link).
 *
 * WHY `history.state.idx`, not `location.key !== "default"`: react-router
 * mints a FRESH key on every `replace`, so only the untouched initial entry
 * is ever `"default"`. A first-entry `replace` (e.g. a magic-link tab whose
 * only entry is replaced `/welcome`→`/`) leaves a non-default key with NO
 * real history behind it — a `key`-based check would believe there's
 * somewhere to go and `navigate(-1)` would step OFF-app (back to the email
 * client). react-router instead stores a monotonic entry index on
 * `window.history.state.idx`: it stays `0` for the very first entry
 * regardless of how many times that entry is replaced, and only becomes
 * `> 0` once a real push has stacked a prior in-app entry behind the current
 * one (both verified in `history.test.tsx`). So `idx > 0` is the honest "is
 * there in-app history behind me" test — this can never walk the user out of
 * the app.
 *
 * This reads the browser's real `window.history`, so it is correct under the
 * app's `<BrowserRouter>`; a `<MemoryRouter>` keeps its own separate stack,
 * so the hook's tests drive it through a real `<BrowserRouter>`.
 *
 * No consumers wire this into a click handler yet — that's later PRs' job
 * (W2-3's DayView back, W2-6's "Maybe later" beats). This PR ships the
 * policy + the shared primitive so those PRs import rather than reinvent it.
 */
export function useHistoryAwareBack(fallbackTo: string): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) {
      navigate(-1);
    } else {
      navigate(fallbackTo);
    }
  }, [navigate, fallbackTo]);
}
