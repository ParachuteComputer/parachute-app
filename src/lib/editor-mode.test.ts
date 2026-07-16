// @vitest-environment jsdom
// Mirrors text-size.test.ts's rationale for the explicit pragma.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LIVE_PREVIEW_STORAGE_KEY,
  readStoredLivePreview,
  writeStoredLivePreview,
} from "./editor-mode";

describe("editor-mode", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("readStoredLivePreview defaults to true (ON) when unset", () => {
    expect(readStoredLivePreview()).toBe(true);
  });

  it("readStoredLivePreview is false only when the stored value is exactly 'off'", () => {
    localStorage.setItem(LIVE_PREVIEW_STORAGE_KEY, "off");
    expect(readStoredLivePreview()).toBe(false);
    localStorage.setItem(LIVE_PREVIEW_STORAGE_KEY, "garbage");
    expect(readStoredLivePreview()).toBe(true);
  });

  it("writeStoredLivePreview(false) persists 'off'; writeStoredLivePreview(true) removes the key", () => {
    writeStoredLivePreview(false);
    expect(localStorage.getItem(LIVE_PREVIEW_STORAGE_KEY)).toBe("off");
    expect(readStoredLivePreview()).toBe(false);
    writeStoredLivePreview(true);
    expect(localStorage.getItem(LIVE_PREVIEW_STORAGE_KEY)).toBeNull();
    expect(readStoredLivePreview()).toBe(true);
  });
});
