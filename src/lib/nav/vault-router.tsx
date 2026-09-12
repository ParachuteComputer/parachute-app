import { detectMountBase } from "@/lib/base-url";
import {
  type ReactNode,
  createContext,
  startTransition,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type Location, Router, UNSAFE_createBrowserHistory } from "react-router";

export function vaultPrefixOf(pathname: string, mount: string): string {
  const match = /^\/v\/([^/]+)(?=\/|$)/.exec(pathname.slice(mount.length));
  return match ? `${mount}/v/${match[1]}` : mount;
}

export const RenderedLocationContext = createContext<Location | null>(null);
export function useRenderedLocation(): Location {
  const location = useContext(RenderedLocationContext);
  if (!location) throw new Error("useRenderedLocation requires VaultScopedBrowserRouter");
  return location;
}

type AbsoluteNavigate = (to: string, opts?: { replace?: boolean }) => void;
export const AbsoluteNavigateContext = createContext<AbsoluteNavigate | null>(null);
export function useAbsoluteNavigate(): AbsoluteNavigate {
  const navigate = useContext(AbsoluteNavigateContext);
  if (!navigate) throw new Error("useAbsoluteNavigate requires VaultScopedBrowserRouter");
  return navigate;
}

// React Router 7.18.1 BrowserRouter body, with basename derived from its own
// location: dist/development/chunk-KS7C4IRE.mjs:10391–10428. One history
// subscription and one state update keep Back's location and basename together.
export function VaultScopedBrowserRouter({ children }: { children: ReactNode }) {
  const historyRef = useRef<ReturnType<typeof UNSAFE_createBrowserHistory> | null>(null);
  if (historyRef.current == null) {
    historyRef.current = UNSAFE_createBrowserHistory({ window, v5Compat: true });
  }
  const history = historyRef.current;
  const [state, setStateImpl] = useState({ action: history.action, location: history.location });
  const setState = useCallback((newState: typeof state) => {
    startTransition(() => setStateImpl(newState));
  }, []);
  useLayoutEffect(() => history.listen(setState), [history, setState]);
  const absoluteNavigate = useCallback<AbsoluteNavigate>(
    (to, opts) => {
      if (opts?.replace) history.replace(to);
      else history.push(to);
    },
    [history],
  );
  return (
    <AbsoluteNavigateContext.Provider value={absoluteNavigate}>
      <RenderedLocationContext.Provider value={state.location}>
        <Router
          basename={vaultPrefixOf(
            state.location.pathname,
            detectMountBase(state.location.pathname),
          )}
          location={state.location}
          navigationType={state.action}
          navigator={history}
        >
          {children}
        </Router>
      </RenderedLocationContext.Provider>
    </AbsoluteNavigateContext.Provider>
  );
}
