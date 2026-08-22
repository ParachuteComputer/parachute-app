import { DateViewOverflowError } from "@/lib/vault/query-errors";
import { describe, expect, it } from "vitest";
import { shouldRetryQuery } from "./QueryProvider";

describe("QueryProvider retry policy", () => {
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
