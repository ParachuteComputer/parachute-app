import { DateViewOverflowError } from "@/lib/vault/query-errors";
import { useQueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { describe, expect, it } from "vitest";
import { QueryProvider, shouldRetryQuery } from "./QueryProvider";

describe("QueryProvider retry policy", () => {
  it("wires the tested policy into the provider's QueryClient", () => {
    const { result } = renderHook(() => useQueryClient(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryProvider, null, children),
    });

    expect(result.current.getDefaultOptions().queries?.retry).toBe(shouldRetryQuery);
  });

  it("never retries a deterministic date-view overflow", () => {
    const error = new DateViewOverflowError(5000);
    expect(shouldRetryQuery(0, error)).toBe(false);
    expect(shouldRetryQuery(1, error)).toBe(false);
  });

  it("preserves the generic two-retry budget for other errors", () => {
    const error = new Error("temporary");
    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(1, error)).toBe(true);
    expect(shouldRetryQuery(2, error)).toBe(false);
  });
});
