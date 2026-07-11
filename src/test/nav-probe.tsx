import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router";

export interface NavLogEntry {
  /** react-router's own classification of the transition that just landed
   *  on `pathname` — "PUSH" | "REPLACE" | "POP". This is exactly what
   *  NAVIGATION.md's decision table governs. */
  type: string;
  pathname: string;
}

/**
 * Test-only harness for asserting push-vs-replace against NAVIGATION.md's
 * decision table. Mount as a sibling of `<Routes>` (inside the same Router,
 * not inside a specific `<Route>`) so it re-renders — and appends to `log`
 * — on every transition, regardless of which route ends up active.
 *
 * Usage:
 * ```tsx
 * const log: NavLogEntry[] = [];
 * render(
 *   <MemoryRouter initialEntries={["/welcome"]}>
 *     <NavTypeLog log={log} />
 *     <Routes>...</Routes>
 *   </MemoryRouter>,
 * );
 * // ...trigger the transition under test...
 * expect(log.at(-1)).toEqual({ type: "PUSH", pathname: "/" });
 * ```
 */
export function NavTypeLog({ log }: { log: NavLogEntry[] }) {
  const type = useNavigationType();
  const location = useLocation();
  const pathname = location.pathname + location.search;
  // `log` is a plain mutable array passed in for the test to inspect
  // afterward, not reactive state — including it would just re-run this
  // effect on every push.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally omits `log` (see above)
  useEffect(() => {
    log.push({ type, pathname });
  }, [type, pathname]);
  return null;
}
