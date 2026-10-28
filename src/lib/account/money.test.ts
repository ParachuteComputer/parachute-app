import { describe, expect, it } from "vitest";
import { isOpenBeta, trialDaysLeftOf } from "./money";
import type { AccountSummary } from "./types";

const base: AccountSummary = {
  email: "a@example.com",
  plan: { tier: "trial", label: "Free trial", trial_days_left: 90 },
  billing_enabled: true,
  has_billing_customer: false,
};

// The one gate every ambient countdown (rail chip "(90d)", switcher foot,
// Recent nudge, Account chip) reads through.
describe("trialDaysLeftOf", () => {
  it("never a countdown in open beta, even if the door sent one", () => {
    expect(trialDaysLeftOf({ ...base, billing_mode: "open_beta" })).toBeNull();
    expect(isOpenBeta({ ...base, billing_mode: "open_beta" })).toBe(true);
  });

  it("paid mode and an older door (no billing_mode) keep the countdown", () => {
    expect(trialDaysLeftOf({ ...base, billing_mode: "paid" })).toBe(90);
    expect(trialDaysLeftOf(base)).toBe(90);
    expect(isOpenBeta(base)).toBe(false);
  });

  it("no summary (a hub) → no countdown", () => {
    expect(trialDaysLeftOf(null)).toBeNull();
  });
});
