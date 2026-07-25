import {
  type FieldControlOption,
  FieldValueControl,
  resolveControlKind,
} from "@/components/views/FieldValueControl";
import type { TagFieldSchema } from "@/lib/vault/types";
import type { ViewFieldValue } from "@/lib/views/mutate";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The shared field editor (view-experience wave, Part A.2) — presentational, so
// driven directly with a spy `onCommit`. Asserts the right control renders per
// schema type, the value's TYPE survives the write, and clearing writes null.

describe("resolveControlKind", () => {
  it("explicit options ⇒ enum, regardless of type", () => {
    const opts: FieldControlOption[] = [{ value: "x", label: "x" }];
    expect(resolveControlKind({ type: "number" }, opts)).toBe("enum");
  });
  it("a declared enum ⇒ enum", () => {
    expect(resolveControlKind({ type: "string", enum: ["a", "b"] })).toBe("enum");
  });
  it("maps the scalar types, defaulting unknown/absent to string", () => {
    expect(resolveControlKind({ type: "date" })).toBe("date");
    expect(resolveControlKind({ type: "boolean" })).toBe("boolean");
    expect(resolveControlKind({ type: "number" })).toBe("number");
    expect(resolveControlKind({ type: "string" })).toBe("string");
    expect(resolveControlKind(null)).toBe("string");
    expect(resolveControlKind({ type: "wat" })).toBe("string");
  });
});

function renderControl(props: {
  schema?: TagFieldSchema | null;
  value: ViewFieldValue;
  options?: FieldControlOption[];
  includeClear?: boolean;
}) {
  const onCommit = vi.fn();
  render(<FieldValueControl field="status" onCommit={onCommit} {...props} />);
  return onCommit;
}

describe("FieldValueControl", () => {
  it("enum: opens a menu of the schema's values; picking commits that value", () => {
    const onCommit = renderControl({
      schema: { type: "string", enum: ["active", "done"] },
      value: "active",
    });
    fireEvent.click(screen.getByRole("button", { name: /edit status/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "done" }));
    expect(onCommit).toHaveBeenCalledWith("done");
  });

  it("enum with includeClear: a set value offers a Clear option that writes null", () => {
    const onCommit = renderControl({
      schema: { type: "string", enum: ["active", "done"] },
      value: "active",
      includeClear: true,
    });
    fireEvent.click(screen.getByRole("button", { name: /edit status/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear" }));
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("boolean: a toggle flips and commits a real boolean (not a string)", () => {
    const onCommit = renderControl({ schema: { type: "boolean" }, value: false });
    fireEvent.click(screen.getByRole("button", { name: /edit status/i }));
    expect(onCommit).toHaveBeenCalledWith(true);
    expect(typeof onCommit.mock.calls[0][0]).toBe("boolean");
  });

  it("number: commits a real number (not '3')", () => {
    const onCommit = renderControl({ schema: { type: "number" }, value: 1 });
    fireEvent.click(screen.getByRole("button", { name: /edit status/i }));
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(3);
    expect(typeof onCommit.mock.calls[0][0]).toBe("number");
  });

  it("string: commits the typed text; clearing to empty writes null", () => {
    const onCommit = renderControl({ schema: { type: "string" }, value: "hi" });
    fireEvent.click(screen.getByRole("button", { name: /edit status/i }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "there" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("there");

    // Re-open and clear to empty → null.
    fireEvent.click(screen.getByRole("button", { name: /edit status/i }));
    const input2 = screen.getByRole("textbox");
    fireEvent.change(input2, { target: { value: "" } });
    fireEvent.keyDown(input2, { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith(null);
  });

  it("date: commits the picked ISO date string", () => {
    const onCommit = renderControl({ schema: { type: "date" }, value: null });
    fireEvent.click(screen.getByRole("button", { name: /edit status/i }));
    const input = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: "2026-07-14" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onCommit).toHaveBeenCalledWith("2026-07-14");
  });

  it("enum with explicit options (the board case): renders those options and commits their typed value", () => {
    const onCommit = renderControl({
      value: 1,
      options: [
        { value: 3, label: "3" },
        { value: null, label: "No status", muted: true },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /edit status/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "3" }));
    expect(onCommit).toHaveBeenCalledWith(3);
    expect(typeof onCommit.mock.calls[0][0]).toBe("number");
  });

  it("enum menu options carry their value's stable hue dot (polish V2)", () => {
    renderControl({
      schema: { type: "string", enum: ["active", "done", "blocked"] },
      value: "active",
    });
    fireEvent.click(screen.getByRole("button", { name: /edit status/i }));
    // Hand-assigned semantics: active → sun, done → grass, blocked → danger.
    const dotOf = (name: string) =>
      screen.getByRole("menuitem", { name }).querySelector(".tint-dot");
    expect(dotOf("active")).toHaveClass("tint-sun");
    expect(dotOf("done")).toHaveClass("tint-grass");
    expect(dotOf("blocked")).toHaveClass("tint-danger");
  });

  it("the empty-value menu options stay dotless — no hue for 'no value'", () => {
    renderControl({
      schema: { type: "string", enum: ["active", "done"] },
      value: "active",
      options: [
        { value: "done", label: "done" },
        { value: null, label: "No status", muted: true },
      ],
      includeClear: true,
    });
    fireEvent.click(screen.getByRole("button", { name: /edit status/i }));
    // The board's muted uncategorized option (value null) has no dot…
    expect(
      screen.getByRole("menuitem", { name: "No status" }).querySelector(".tint-dot"),
    ).toBeNull();
    // …and neither does Clear; the real value keeps its dot.
    expect(screen.getByRole("menuitem", { name: "Clear" }).querySelector(".tint-dot")).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: "done" }).querySelector(".tint-dot"),
    ).not.toBeNull();
  });
});

// Typed rendering in the trigger (polish V1) — the trigger IS FieldDisplay,
// so the control shows a boolean as a check and keeps URLs one-door.
describe("FieldValueControl typed display", () => {
  it("boolean trigger reads ✓/✕, not Yes/No (toasts keep Yes/No)", () => {
    renderControl({ schema: { type: "boolean" }, value: true });
    expect(screen.getByRole("button", { name: /edit status/i })).toHaveTextContent("✓");
  });

  it("a URL value renders link-styled but the trigger stays ONE-DOOR: tap opens the editor, and the popover offers the Open ↗ anchor", () => {
    renderControl({ schema: { type: "string" }, value: "https://example.com/docs" });
    const trigger = screen.getByRole("button", { name: /edit status/i });
    expect(trigger).toHaveTextContent("example.com");
    // No anchor nested in the trigger button.
    expect(screen.queryByRole("link")).toBeNull();

    fireEvent.click(trigger);
    // Tap opened the EDITOR (one door)…
    expect(screen.getByRole("dialog", { name: /edit status/i })).toBeInTheDocument();
    // …and the real "open" lives beside the commit, on the committed value.
    const open = screen.getByRole("link", { name: "Open link" });
    expect(open).toHaveAttribute("href", "https://example.com/docs");
    expect(open).toHaveAttribute("target", "_blank");
    expect(open.getAttribute("rel")).toContain("noopener");
  });

  it("the Open ↗ anchor appears ONLY for URL values", () => {
    renderControl({ schema: { type: "string" }, value: "not a url" });
    fireEvent.click(screen.getByRole("button", { name: /edit status/i }));
    expect(screen.getByRole("dialog", { name: /edit status/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open link" })).toBeNull();
  });
});
