import { describe, expect, it } from "vitest";
import { AccountApiError } from "./client";
import { describeAccountError } from "./error-copy";

// F12 — a plan-limit hit (or any other account-API error) must never render
// as a bare wire code. The primary fix is jsonOrThrow preferring the server's
// friendly `message` (client.test.ts); this is the belt-and-suspenders layer
// for what that doesn't cover — a bare code with no message, or an unknown
// code — so it operates on the raw error string, not the server shape.

describe("describeAccountError", () => {
  it("maps a known bare code to friendly copy", () => {
    expect(describeAccountError(new AccountApiError(403, "vault_limit_reached"))).toMatch(
      /vault limit/i,
    );
    expect(describeAccountError(new AccountApiError(409, "vault_taken"))).toMatch(/already taken/i);
    expect(describeAccountError(new AccountApiError(400, "reserved"))).toMatch(/reserved/i);
    expect(describeAccountError(new AccountApiError(400, "invalid_name"))).toMatch(
      /lowercase letters/i,
    );
  });

  it("passes prose messages through unchanged (the server's own friendly message)", () => {
    expect(describeAccountError(new Error("That vault name is already taken."))).toBe(
      "That vault name is already taken.",
    );
  });

  it("falls back to the generic message for an unrecognized bare code", () => {
    expect(describeAccountError(new Error("some_future_code"))).toBe(
      "Something went wrong. Try again.",
    );
  });

  it("uses the caller's custom fallback when given", () => {
    expect(describeAccountError(new Error("weird_code"), "Couldn't open that vault.")).toBe(
      "Couldn't open that vault.",
    );
  });

  it("falls back for a non-Error thrown value", () => {
    expect(describeAccountError("nope")).toBe("Something went wrong. Try again.");
  });

  it("falls back for an empty message", () => {
    expect(describeAccountError(new Error(""))).toBe("Something went wrong. Try again.");
  });
});
