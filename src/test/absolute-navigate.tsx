import { AbsoluteNavigateContext } from "@/lib/nav/vault-router";
import type { ReactNode } from "react";
import { vi } from "vitest";

/** Standalone MemoryRouter tests observe the context-changing handoff only. */
export function absoluteNavigateHarness() {
  const navigate = vi.fn<(to: string, opts?: { replace?: boolean }) => void>();
  function Provider({ children }: { children: ReactNode }) {
    return (
      <AbsoluteNavigateContext.Provider value={navigate}>
        {children}
      </AbsoluteNavigateContext.Provider>
    );
  }
  return { Provider, navigate };
}
