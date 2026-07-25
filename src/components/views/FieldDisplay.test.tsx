import { FieldDisplay, isUrlValue } from "@/components/views/FieldDisplay";
import { todayKey } from "@/lib/dates";
import type { TagFieldSchema } from "@/lib/vault/types";
import type { ViewFieldValue } from "@/lib/views/mutate";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Typed field rendering (views polish V1) — pure value+schema in, node out,
// so driven directly. What renders here is what every chip / table cell /
// boolean toggle shows: the FieldValueControl trigger renders THIS.

function renderDisplay(value: ViewFieldValue, schema?: TagFieldSchema | null) {
  return render(
    <span data-testid="d">
      <FieldDisplay value={value} schema={schema} />
    </span>,
  );
}

function text(container: HTMLElement): string {
  return container.textContent ?? "";
}

describe("isUrlValue", () => {
  it("matches http(s) strings only", () => {
    expect(isUrlValue("https://example.com")).toBe(true);
    expect(isUrlValue("HTTP://example.com")).toBe(true);
    expect(isUrlValue("ftp://example.com")).toBe(false);
    expect(isUrlValue("example.com")).toBe(false);
    expect(isUrlValue(3)).toBe(false);
    expect(isUrlValue(null)).toBe(false);
  });
});

describe("FieldDisplay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("empty (null / undefined / '') → the quiet — placeholder", () => {
    expect(text(renderDisplay(null).container)).toBe("—");
    expect(text(renderDisplay(undefined as unknown as ViewFieldValue).container)).toBe("—");
    expect(text(renderDisplay("").container)).toBe("—");
  });

  it("boolean three-state: ✓ (grass) / ✕ (dim) / — unset", () => {
    const yes = renderDisplay(true, { type: "boolean" });
    expect(text(yes.container)).toBe("✓");
    expect(yes.container.querySelector(".text-grass")).not.toBeNull();

    const no = renderDisplay(false, { type: "boolean" });
    expect(text(no.container)).toBe("✕");
    expect(no.container.querySelector(".text-fg-dim")).not.toBeNull();

    expect(text(renderDisplay(null, { type: "boolean" }).container)).toBe("—");
  });

  it("date: human-relative via formatFieldDate (Today / same-year month-day)", () => {
    // Fake only Date so the component's default `now` is deterministic.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 24, 12, 0, 0)); // local Jul 24, 2026

    expect(text(renderDisplay(todayKey(), { type: "date" }).container)).toBe("Today");

    const sameYear = text(renderDisplay("2026-08-01", { type: "date" }).container);
    expect(sameYear).toMatch(/Aug/i);
    expect(sameYear).not.toMatch(/2026/);

    const otherYear = text(renderDisplay("2025-08-01", { type: "date" }).container);
    expect(otherYear).toMatch(/2025/);

    // Unparseable stays raw — honest.
    expect(text(renderDisplay("soon", { type: "date" }).container)).toBe("soon");
  });

  it("number: as-is (no locale reformat), tabular-nums for column alignment", () => {
    const { container } = renderDisplay(1234.5, { type: "number" });
    expect(text(container)).toBe("1234.5"); // not "1,234.5"
    expect(container.querySelector(".tabular-nums")).not.toBeNull();
  });

  it("url: link-STYLED (hostname + truncated path, accent) but NOT an anchor — one door", () => {
    const { container, queryByRole } = renderDisplay(
      "https://example.com/docs/some/quite/long/path/segment?x=1",
      { type: "string" },
    );
    expect(text(container)).toContain("example.com");
    // The path tail is cut, not dumped whole.
    expect(text(container)).not.toContain("segment?x=1");
    expect(text(container)).toContain("…");
    expect(container.querySelector(".text-accent")).not.toBeNull();
    // No nested navigation inside the edit trigger.
    expect(queryByRole("link")).toBeNull();
  });

  it("url: a bare origin shows just the hostname", () => {
    expect(text(renderDisplay("https://example.com/").container)).toBe("example.com");
  });

  it("enum values render as plain text for now (tinting is V2)", () => {
    const { container } = renderDisplay("active", { type: "string", enum: ["active", "done"] });
    expect(text(container)).toBe("active");
    expect(container.querySelector("span[class]")).toBeNull();
  });

  it("string: as-is", () => {
    expect(text(renderDisplay("hello world", { type: "string" }).container)).toBe("hello world");
  });

  it("no schema degrades to honest raw rendering", () => {
    expect(text(renderDisplay("2026-08-01", null).container)).toBe("2026-08-01");
  });
});
