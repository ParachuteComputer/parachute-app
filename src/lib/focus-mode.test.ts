import { isFocusablePath, useFocusMode } from "@/lib/focus-mode";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("useFocusMode store", () => {
  beforeEach(() => {
    useFocusMode.setState({ on: false });
  });
  afterEach(() => {
    useFocusMode.setState({ on: false });
  });

  it("starts off", () => {
    expect(useFocusMode.getState().on).toBe(false);
  });

  it("setOn sets the flag directly", () => {
    useFocusMode.getState().setOn(true);
    expect(useFocusMode.getState().on).toBe(true);
    useFocusMode.getState().setOn(false);
    expect(useFocusMode.getState().on).toBe(false);
  });

  it("toggle flips the flag", () => {
    useFocusMode.getState().toggle();
    expect(useFocusMode.getState().on).toBe(true);
    useFocusMode.getState().toggle();
    expect(useFocusMode.getState().on).toBe(false);
  });
});

describe("isFocusablePath — POLISH-WAVE PR 4's route guard", () => {
  it("matches the note read route", () => {
    expect(isFocusablePath("/n/abc-123")).toBe(true);
  });

  it("matches the note edit route", () => {
    expect(isFocusablePath("/n/abc-123/edit")).toBe(true);
  });

  it("matches an encoded id (no embedded slash)", () => {
    expect(isFocusablePath("/n/Canon%2FAaron")).toBe(true);
  });

  it.each(["/", "/notes", "/n", "/n/", "/settings", "/n/abc-123/other", "/views/abc"])(
    "rejects everything else: %s",
    (pathname) => {
      expect(isFocusablePath(pathname)).toBe(false);
    },
  );
});
