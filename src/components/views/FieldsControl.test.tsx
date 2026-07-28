import { FieldsControl } from "@/components/views/FieldsControl";
import type { TagFieldSchema } from "@/lib/vault/types";
import type { ResolvedField } from "@/lib/views/fields";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The Fields control (views train C) — presentational, so driven directly
// with a spy `onChange` receiving the full ordered list after every edit.
// Asserts the schema∪override union, ordered toggle writes, up/down reorder,
// the minimum-one lock (the wire format can't express "show none"), and the
// per-row type glyph (from the schema TYPE alone, never the field's name).

function resolved(names: string[]): ResolvedField[] {
  return names.map((name) => ({ name, schema: { type: "string" } }));
}

// All-string fixture — every row's glyph is "Aa"; the dedicated glyph test
// below varies the type per field.
function schemaMap(names: string[]): Record<string, TagFieldSchema> {
  return Object.fromEntries(names.map((name) => [name, { type: "string" } as TagFieldSchema]));
}

function renderOpen(shown: string[], schemaNames: string[]) {
  const onChange = vi.fn();
  render(
    <FieldsControl
      fields={resolved(shown)}
      schemaFields={schemaMap(schemaNames)}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^fields/i }));
  return onChange;
}

describe("FieldsControl", () => {
  it("lists the schema∪override union — an override field NOT in the schema is still listed, checked", () => {
    renderOpen(["status", "extra"], ["title", "status", "due"]);
    // Shown (checked, in view order) first, hidden schema fields after.
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // Strip the reorder glyphs AND this all-string fixture's "Aa" type glyph
    // (the dedicated glyph test below asserts it varies by type).
    expect(
      boxes.map((b) => [
        b.closest("li")!.textContent!.replace(/[↑↓]/g, "").replace(/^Aa/, ""),
        b.checked,
      ]),
    ).toEqual([
      ["status", true],
      ["extra", true],
      ["title", false],
      ["due", false],
    ]);
    // The trigger counts the shown set — the V3 pill face reads [FIELDS 2 ▾].
    expect(screen.getByRole("button", { name: "Fields 2" })).toBeTruthy();
  });

  it("checking a hidden field appends it to the END of the ordered shown set", () => {
    const onChange = renderOpen(["status", "extra"], ["title", "status", "due"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "due" }));
    expect(onChange).toHaveBeenCalledWith(["status", "extra", "due"]);
  });

  it("unchecking a shown field removes it, preserving the others' order", () => {
    const onChange = renderOpen(["title", "status", "due"], ["title", "status", "due"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "status" }));
    expect(onChange).toHaveBeenCalledWith(["title", "due"]);
  });

  it("reorders via up/down — edges disabled, hidden fields get no reorder buttons", () => {
    const onChange = renderOpen(["a", "b", "c"], ["a", "b", "c", "z"]);
    fireEvent.click(screen.getByRole("button", { name: "Move b up" }));
    expect(onChange).toHaveBeenLastCalledWith(["b", "a", "c"]);
    fireEvent.click(screen.getByRole("button", { name: "Move b down" }));
    expect(onChange).toHaveBeenLastCalledWith(["a", "c", "b"]);

    expect(screen.getByRole("button", { name: "Move a up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move c down" })).toBeDisabled();
    // `z` is hidden — ordering it is meaningless until it's checked.
    expect(screen.queryByRole("button", { name: "Move z up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move z down" })).toBeNull();
  });

  it("minimum one: the last checked box is disabled with a hint, and cannot fire a write", () => {
    const onChange = renderOpen(["status"], ["status", "due"]);
    const last = screen.getByRole("checkbox", { name: "status" });
    expect(last).toBeDisabled();
    expect(screen.getByText("Views show at least one field.")).toBeTruthy();
    fireEvent.click(last);
    expect(onChange).not.toHaveBeenCalled();
    // The hidden field stays checkable — the way OUT of the minimum.
    fireEvent.click(screen.getByRole("checkbox", { name: "due" }));
    expect(onChange).toHaveBeenCalledWith(["status", "due"]);
  });

  it("above the minimum there is no lock and no hint", () => {
    renderOpen(["status", "due"], []);
    expect(screen.getByRole("checkbox", { name: "status" })).not.toBeDisabled();
    expect(screen.queryByText("Views show at least one field.")).toBeNull();
  });

  it("renders nothing when the union is empty (no schema, no effective set)", () => {
    const onChange = vi.fn();
    render(<FieldsControl fields={[]} schemaFields={{}} onChange={onChange} />);
    expect(screen.queryByRole("button", { name: /^fields/i })).toBeNull();
  });

  it("Escape closes the panel", () => {
    renderOpen(["status"], ["status", "due"]);
    expect(screen.getByRole("dialog", { name: "Fields" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Fields" })).toBeNull();
  });

  describe("type glyph — from the schema TYPE alone, never the field's name", () => {
    it("shown rows glyph from their own ResolvedField.schema; hidden rows from schemaFields", () => {
      const onChange = vi.fn();
      render(
        <FieldsControl
          fields={[
            { name: "status", schema: { type: "string", enum: ["active", "done"] } },
            { name: "effort_days", schema: { type: "number" } },
          ]}
          schemaFields={{
            status: { type: "string", enum: ["active", "done"] },
            effort_days: { type: "number" },
            due: { type: "date" },
            done: { type: "boolean" },
            owner: { type: "string" },
          }}
          onChange={onChange}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /^fields/i }));
      const rows = screen
        .getAllByRole("checkbox")
        .map((cb) => cb.closest("li")!.textContent!.replace(/[↑↓]/g, ""));
      expect(rows).toEqual(["●status", "#effort_days", "📅due", "●done", "Aaowner"]);
    });
  });
});
