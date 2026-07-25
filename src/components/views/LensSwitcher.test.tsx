import { DateFieldControl, GroupByControl, LensSwitcher } from "@/components/views/LensSwitcher";
import type { ResolvedField } from "@/lib/views/fields";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The controls-row pills (polish V3) — presentational units over ControlPill.
// The lens dropdown lists the five kinds with the current one checked; the
// organize-by pills carry first-class labels, the legacy-value unshift, and
// the two MUST-RENDER empty states (a control that vanishes can't explain
// what the view is organized by).

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

  it("EMPTY STATE: zero resolvable fields still renders [GROUP BY —] with the explanatory line", () => {
    render(<GroupByControl value={undefined} fields={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Group by —" }));
    expect(
      screen.getByText("No fields to group by — this view's tag has no schema fields."),
    ).toBeTruthy();
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
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
});
