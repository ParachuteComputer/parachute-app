import { DateFieldControl, GroupByControl, LensSwitcher } from "@/components/views/LensSwitcher";
import type { ResolvedField } from "@/lib/views/fields";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The controls-row pills (polish V3) — presentational units over ControlPill.
// The lens dropdown lists the five kinds with the current one checked; the
// organize-by pills carry first-class labels, the legacy-value unshift, and
// the two MUST-RENDER empty states (a control that vanishes can't explain
// what the view is organized by).
//
// The empty states now also CARRY THE ON-RAMP (field-presets): with a primary
// tag they offer to create the missing field in one click; without one they
// keep an honest message that says what to do instead.

const FIELDS: ResolvedField[] = [
  { name: "title", schema: { type: "string" } },
  { name: "status", schema: { type: "string", enum: ["active", "done"] } },
  { name: "due", schema: { type: "date" } },
];

describe("LensSwitcher (lens dropdown)", () => {
  it("one pill, no written label — the kind IS the identity; the menu lists all five kinds, current checked", () => {
    const onSwitch = vi.fn();
    render(<LensSwitcher kind="board" onSwitch={onSwitch} />);
    const trigger = screen.getByRole("button", { name: "Lens: Board" });
    expect(trigger.textContent).not.toMatch(/lens/i); // aria carries the role, not the pill face
    fireEvent.click(trigger);

    const menu = screen.getByRole("menu", { name: "Lens" });
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent?.replace("✓", ""))).toEqual([
      "List",
      "Board",
      "Calendar",
      "Gallery",
      "Table",
    ]);
    expect(within(menu).getByRole("menuitemradio", { name: "Board" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(menu).getByRole("menuitemradio", { name: "List" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("picking a kind reports it through the unchanged onSwitch seam", () => {
    const onSwitch = vi.fn();
    render(<LensSwitcher kind="list" onSwitch={onSwitch} />);
    fireEvent.click(screen.getByRole("button", { name: "Lens: List" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Calendar" }));
    expect(onSwitch).toHaveBeenCalledWith("calendar");
  });
});

describe("GroupByControl", () => {
  it("labeled pill [GROUP BY value]; every resolved field is an option, each with its stable tint dot", () => {
    const onChange = vi.fn();
    render(<GroupByControl value="status" fields={FIELDS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Group by status" }));
    const menu = screen.getByRole("menu", { name: "Group by" });
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent?.replace("✓", ""))).toEqual(["title", "status", "due"]);
    expect(within(menu).getByRole("menuitemradio", { name: "status" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // The V2 stable-hue dot rides each option.
    expect(items.every((i) => i.querySelector(".tint-dot"))).toBe(true);

    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "due" }));
    expect(onChange).toHaveBeenCalledWith("due");
  });

  it("a legacy value on an undeclared field still shows selected (the unshift)", () => {
    render(<GroupByControl value="legacy_lane" fields={FIELDS} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Group by legacy_lane" }));
    const items = screen.getAllByRole("menuitemradio");
    expect(items[0].textContent).toContain("legacy_lane");
    expect(items[0]).toHaveAttribute("aria-checked", "true");
  });

  // --- The one-click on-ramp: an empty Group-by offers to CREATE the field
  // it needs, instead of dead-ending on "this tag has no schema fields."

  it("EMPTY STATE with a primary tag: the menu offers the status/priority presets + the custom escape", () => {
    const onCreateField = vi.fn();
    const onCustomField = vi.fn();
    render(
      <GroupByControl
        value={undefined}
        fields={[]}
        onChange={vi.fn()}
        createTag="project"
        onCreateField={onCreateField}
        onCustomField={onCustomField}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Group by —" }));

    // The pill still renders, still explains — but now names the tag it would
    // write to and what happens next.
    expect(
      screen.getByText("#project has no fields yet. Add one and this board gets its lanes:"),
    ).toBeTruthy();
    // No VALUES to pick (nothing resolved), three COMMANDS to run.
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
    const actions = screen.getAllByRole("menuitem");
    expect(actions.map((a) => a.textContent)).toEqual([
      "Add a status fieldTo do · In progress · Done",
      "Add a priority fieldLow · Medium · High",
      "Something else…Name it in the tag editor",
    ]);

    fireEvent.click(actions[0]);
    expect(onCreateField).toHaveBeenCalledTimes(1);
    expect(onCreateField.mock.calls[0][0]).toEqual({
      name: "status",
      label: "status",
      hint: "To do · In progress · Done",
      schema: { type: "string", enum: ["To do", "In progress", "Done"] },
    });
    expect(onCustomField).not.toHaveBeenCalled();
  });

  it("EMPTY STATE with a primary tag: 'Something else…' routes to the custom-field escape, creating nothing", () => {
    const onCreateField = vi.fn();
    const onCustomField = vi.fn();
    render(
      <GroupByControl
        value={undefined}
        fields={[]}
        onChange={vi.fn()}
        createTag="project"
        onCreateField={onCreateField}
        onCustomField={onCustomField}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Group by —" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /something else/i }));
    expect(onCustomField).toHaveBeenCalledTimes(1);
    expect(onCreateField).not.toHaveBeenCalled();
  });

  it("EMPTY STATE with NO primary tag: an honest message that says what to do — and no presets to offer", () => {
    render(<GroupByControl value={undefined} fields={[]} onChange={vi.fn()} createTag={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Group by —" }));
    expect(
      screen.getByText(
        "This view isn't scoped to one tag, so there's no schema to add a field to — add a single tag to the query, or open a tag's view.",
      ),
    ).toBeTruthy();
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });

  it("a creation in flight disables every command row (no double-write)", () => {
    render(
      <GroupByControl
        value={undefined}
        fields={[]}
        onChange={vi.fn()}
        createTag="project"
        onCreateField={vi.fn()}
        onCustomField={vi.fn()}
        creating
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Group by —" }));
    expect(screen.getAllByRole("menuitem").every((a) => (a as HTMLButtonElement).disabled)).toBe(
      true,
    );
  });

  it("fields already resolve → no on-ramp; the menu is values only", () => {
    render(
      <GroupByControl
        value="status"
        fields={FIELDS}
        onChange={vi.fn()}
        createTag="project"
        onCreateField={vi.fn()}
        onCustomField={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Group by status" }));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });
});

describe("DateFieldControl", () => {
  it("labeled pill [BY DATE value]; only date-typed fields are options", () => {
    const onChange = vi.fn();
    render(<DateFieldControl value="due" fields={FIELDS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "By date due" }));
    const menu = screen.getByRole("menu", { name: "By date" });
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent?.replace("✓", ""))).toEqual(["due"]);
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    // No note when a real date field drives the calendar.
    expect(screen.queryByText("Showing by created date")).toBeNull();
  });

  it("EMPTY STATE: no date field resolved → the pill honestly reads 'created' (the read-only axis), with the graduation menu + dim line", () => {
    const onChange = vi.fn();
    render(<DateFieldControl value={undefined} fields={FIELDS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "By date created" }));
    expect(screen.getByText("Showing by created date")).toBeTruthy();
    // The date-typed fields are listed unchecked — picking one graduates the
    // calendar from the createdAt fallback to editable.
    const item = screen.getByRole("menuitemradio", { name: "due" });
    expect(item).toHaveAttribute("aria-checked", "false");
    fireEvent.click(item);
    expect(onChange).toHaveBeenCalledWith("due");
  });

  it("EMPTY STATE with no date-typed fields at all: pill renders, menu is just the explanation", () => {
    render(
      <DateFieldControl value={undefined} fields={[FIELDS[0], FIELDS[1]]} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "By date created" }));
    expect(screen.getByText("Showing by created date")).toBeTruthy();
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
  });

  it("ON-RAMP: no date-typed field but a primary tag → one click adds `due`", () => {
    const onCreateField = vi.fn();
    render(
      <DateFieldControl
        value={undefined}
        // A tag WITH a schema, just no date field — the on-ramp still applies,
        // and the merge-on-write payload leaves `title`/`status` alone.
        fields={[FIELDS[0], FIELDS[1]]}
        onChange={vi.fn()}
        createTag="project"
        onCreateField={onCreateField}
        onCustomField={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "By date created" }));
    expect(
      screen.getByText(
        "Showing by created date. #project has no date field — add one to plot and drag by it:",
      ),
    ).toBeTruthy();

    const actions = screen.getAllByRole("menuitem");
    expect(actions.map((a) => a.textContent)).toEqual([
      "Add a due fieldA date on each note",
      "Something else…Name it in the tag editor",
    ]);
    fireEvent.click(actions[0]);
    expect(onCreateField.mock.calls[0][0]).toEqual({
      name: "due",
      label: "due",
      hint: "A date on each note",
      schema: { type: "date" },
    });
  });

  it("ON-RAMP: a tag that ALREADY declares `due` (as a non-date type) is never offered the `due` preset — only the custom escape (no silent redefine)", () => {
    const onCreateField = vi.fn();
    const onCustomField = vi.fn();
    render(
      <DateFieldControl
        value={undefined}
        // `due` exists on the tag, but declared as a STRING — so it's not a
        // date-typed OPTION, yet the tag DOES own the `due` key. Offering the
        // `due` preset here would merge-clobber that string field on write.
        fields={[{ name: "due", schema: { type: "string" } }]}
        onChange={vi.fn()}
        createTag="project"
        existingFieldNames={["due"]}
        onCreateField={onCreateField}
        onCustomField={onCustomField}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "By date created" }));
    // The `due` preset is suppressed; only the honest "Something else…" path
    // survives (rename/redefine deliberately in the tag editor).
    const actions = screen.getAllByRole("menuitem");
    expect(actions.map((a) => a.textContent)).toEqual(["Something else…Name it in the tag editor"]);
    expect(screen.queryByText(/Add a due field/)).toBeNull();

    fireEvent.click(actions[0]);
    expect(onCustomField).toHaveBeenCalledTimes(1);
    expect(onCreateField).not.toHaveBeenCalled();
  });

  it("ON-RAMP: a date field already resolves → no offer, just the value list", () => {
    render(
      <DateFieldControl
        value={undefined}
        fields={FIELDS}
        onChange={vi.fn()}
        createTag="project"
        onCreateField={vi.fn()}
        onCustomField={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "By date created" }));
    expect(screen.getByText("Showing by created date")).toBeTruthy();
    expect(screen.getAllByRole("menuitemradio").map((i) => i.textContent)).toEqual(["due"]);
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });
});
