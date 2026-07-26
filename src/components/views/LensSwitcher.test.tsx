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
// The empty states carry the on-ramp: with a primary tag they INVITE the user
// to add a field (opening the tag-schema editor, where the user names it —
// the app proposes no vocabulary of its own); without a single tag to add to,
// they keep an honest message that says what to do instead. The invitation
// only appears once the tag schema has actually answered (`schemaReady`), so
// it never cries "no fields yet" on a tag mid-fetch.

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

  // --- The on-ramp: an empty Group-by INVITES adding a field (the user names
  // it in the tag editor), instead of dead-ending on "this tag has no fields."

  it("EMPTY STATE with a primary tag: one invitation to add a field, no preset vocabulary; clicking routes to onAddField and writes nothing itself", () => {
    const onAddField = vi.fn();
    render(
      <GroupByControl
        value={undefined}
        fields={[]}
        onChange={vi.fn()}
        createTag="project"
        onAddField={onAddField}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Group by —" }));

    // The pill still renders, still explains — names the tag, says what's next.
    expect(
      screen.getByText("#project has no fields yet — add one to give this board its columns:"),
    ).toBeTruthy();
    // No VALUES to pick, and exactly ONE command: the invitation (no `status`,
    // no `priority` — the app names nothing).
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
    const actions = screen.getAllByRole("menuitem");
    expect(actions.map((a) => a.textContent)).toEqual([
      "Add a field to group by…You name it; give it values to get columns.",
    ]);

    fireEvent.click(actions[0]);
    expect(onAddField).toHaveBeenCalledTimes(1);
  });

  it("EMPTY STATE while the schema is still loading (schemaReady false): no invitation yet — don't cry 'no fields' on a tag mid-fetch", () => {
    render(
      <GroupByControl
        value={undefined}
        fields={[]}
        onChange={vi.fn()}
        createTag="project"
        schemaReady={false}
        onAddField={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Group by —" }));
    expect(screen.queryByText(/has no fields yet/)).toBeNull();
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });

  it("EMPTY STATE with NO primary tag: an honest message that says what to do — and no invitation to offer", () => {
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

  it("fields already resolve → no invitation; the menu is values only", () => {
    render(
      <GroupByControl
        value="status"
        fields={FIELDS}
        onChange={vi.fn()}
        createTag="project"
        onAddField={vi.fn()}
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

  it("EMPTY STATE with no date-typed fields and no tag to add to: pill renders, menu is just the explanation", () => {
    render(
      <DateFieldControl value={undefined} fields={[FIELDS[0], FIELDS[1]]} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "By date created" }));
    expect(screen.getByText("Showing by created date")).toBeTruthy();
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });

  it("ON-RAMP: no date-typed field but a primary tag → an invitation to add a date field", () => {
    const onAddField = vi.fn();
    render(
      <DateFieldControl
        value={undefined}
        // A tag WITH a schema, just no date field — the on-ramp still applies.
        fields={[FIELDS[0], FIELDS[1]]}
        onChange={vi.fn()}
        createTag="project"
        onAddField={onAddField}
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
      "Add a date field…You name it; it holds a date on each note.",
    ]);
    fireEvent.click(actions[0]);
    expect(onAddField).toHaveBeenCalledTimes(1);
  });

  it("ON-RAMP: a tag that ALREADY declares a same-named non-date field still gets the invitation — we propose no name, so there's nothing to silently clobber (the collision is the editor's to surface)", () => {
    const onAddField = vi.fn();
    render(
      <DateFieldControl
        value={undefined}
        // `due` exists on the tag, but declared as a STRING — not a date-typed
        // OPTION. The old preset flow suppressed the `due` offer here to avoid
        // a merge-clobber; now the app names nothing, so the invitation simply
        // appears and any name collision surfaces in the editor.
        fields={[{ name: "due", schema: { type: "string" } }]}
        onChange={vi.fn()}
        createTag="project"
        onAddField={onAddField}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "By date created" }));
    const actions = screen.getAllByRole("menuitem");
    expect(actions.map((a) => a.textContent)).toEqual([
      "Add a date field…You name it; it holds a date on each note.",
    ]);
    fireEvent.click(actions[0]);
    expect(onAddField).toHaveBeenCalledTimes(1);
  });

  it("ON-RAMP while the schema is still loading (schemaReady false): no invitation yet", () => {
    render(
      <DateFieldControl
        value={undefined}
        fields={[]}
        onChange={vi.fn()}
        createTag="project"
        schemaReady={false}
        onAddField={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "By date created" }));
    expect(screen.queryByText(/has no date field/)).toBeNull();
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });

  it("ON-RAMP: a date field already resolves → no invitation, just the value list", () => {
    render(
      <DateFieldControl
        value={undefined}
        fields={FIELDS}
        onChange={vi.fn()}
        createTag="project"
        onAddField={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "By date created" }));
    expect(screen.getByText("Showing by created date")).toBeTruthy();
    expect(screen.getAllByRole("menuitemradio").map((i) => i.textContent)).toEqual(["due"]);
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });
});
