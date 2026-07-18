import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSCRIBE_DEFAULT,
  deleteTranscribeDefault,
  loadTranscribeDefault,
  saveTranscribeDefault,
} from "./transcribe-default";

describe("transcribe-default storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to ON (transcribe) when nothing is stored", () => {
    expect(DEFAULT_TRANSCRIBE_DEFAULT).toBe(true);
    expect(loadTranscribeDefault("nope")).toBe(true);
  });

  it("round-trips false", () => {
    saveTranscribeDefault("v1", false);
    expect(loadTranscribeDefault("v1")).toBe(false);
  });

  it("round-trips true", () => {
    saveTranscribeDefault("v1", false);
    saveTranscribeDefault("v1", true);
    expect(loadTranscribeDefault("v1")).toBe(true);
  });

  it("falls back to the default for a non-boolean stored value", () => {
    localStorage.setItem("lens:transcribe-default:v1", JSON.stringify({ transcribe: "yes" }));
    expect(loadTranscribeDefault("v1")).toBe(DEFAULT_TRANSCRIBE_DEFAULT);
  });

  it("falls back to the default when stored JSON is malformed", () => {
    localStorage.setItem("lens:transcribe-default:v1", "{not json");
    expect(loadTranscribeDefault("v1")).toBe(DEFAULT_TRANSCRIBE_DEFAULT);
  });

  it("delete removes the entry", () => {
    saveTranscribeDefault("v1", false);
    deleteTranscribeDefault("v1");
    expect(loadTranscribeDefault("v1")).toBe(DEFAULT_TRANSCRIBE_DEFAULT);
  });

  it("scopes per vault", () => {
    saveTranscribeDefault("a", false);
    saveTranscribeDefault("b", true);
    expect(loadTranscribeDefault("a")).toBe(false);
    expect(loadTranscribeDefault("b")).toBe(true);
  });
});
