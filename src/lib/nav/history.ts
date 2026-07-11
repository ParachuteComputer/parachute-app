import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * The history-aware escape rule (NAVIGATION.md § "The history-aware escape
 * rule"). Prefers going back in the browser's actual history stack — so a
 * "Maybe later" / "← Back" affordance lands wherever the user really came
 * from — but degrades to a named fallback route when there's nothing behind
 * the current entry (a fresh tab, a magic-link landing, a deep link).
 *
 * react-router marks a stack's very first entry with the `"default"` key
 * (true from the moment `MemoryRouter`/`BrowserRouter` mounts, before any
 * push/replace has happened), so checking `location.key !== "default"` is a
 * reliable "is there really something behind me" test — this can never walk
 * the user out of the app the way a bare `navigate(-1)` could.
 *
 * No consumers wire this into a click handler yet — that's later PRs' job
 * (W2-3's DayView back, W2-6's "Maybe later" beats). This PR ships the
 * policy + the shared primitive so those PRs import rather than reinvent it.
 */
export function useHistoryAwareBack(fallbackTo: string): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (location.key !== "default") {
      navigate(-1);
    } else {
      navigate(fallbackTo);
    }
  }, [location.key, navigate, fallbackTo]);
}
