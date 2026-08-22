import { describe, expect, it } from "vitest";
import {
  DATE_VIEW_REFETCH_INTERVAL_MS,
  DateViewOverflowError,
  dateViewRefetchInterval,
  isDateViewOverflowError,
} from "./query-errors";

describe("date-view overflow query policy", () => {
  it("recognizes the deterministic overflow error", () => {
    const error = new DateViewOverflowError(5000);
    expect(error.name).toBe("DateViewOverflowError");
    expect(error.message).toContain("5,000-note safety ceiling");
    expect(isDateViewOverflowError(error)).toBe(true);
    expect(isDateViewOverflowError(new Error(error.message))).toBe(false);
  });

  it("pauses polling only while the query is overflowed", () => {
    expect(dateViewRefetchInterval(new DateViewOverflowError(5000))).toBe(false);
    expect(dateViewRefetchInterval(new Error("temporary"))).toBe(DATE_VIEW_REFETCH_INTERVAL_MS);
    expect(dateViewRefetchInterval(null)).toBe(DATE_VIEW_REFETCH_INTERVAL_MS);
  });
});
