import { ControlPill, type ControlPillSection } from "@/components/views/ControlPill";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The shared control-pill primitive (polish V3) — presentational, driven with
// a spy `onSelect`. Asserts the trigger anatomy + aria wiring, open/close
// (toggle, Escape, outside-tap, selection), the ✓-on-current row, the dirty
// border tint, the empty-state note line, and the phone-sheet z-tier classes
// (the z-30 scrim under the z-40 panel — the FieldsControl pattern, which
// clears the z-20 save bar / tab bar).

function renderPill(overrides: {
  current?: string;
  note?: string;
  dirty?: boolean;
  options?: { value: string; label?: string }[];
}) {
  const onSelect = vi.fn();
  render(
    <ControlPill
      label="Group by"
      menuLabel="Group by"
      value="status"
      options={overrides.options ?? [{ value: "status" }, { value: "due" }]}
      current={overrides.current}
      onSelect={onSelect}
      note={overrides.note}
      dirty={overrides.dirty}
    />,
  );
  return onSelect;
}

describe("ControlPill", () => {
  it("trigger anatomy: eyebrow label + value name the button; aria-haspopup and aria-expanded wire up", () => {
    renderPill({ current: "status" });
    const trigger = screen.getByRole("button", { name: "Group by status" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Group by" })).toBeTruthy();
  });

  it("the current option is checked and carries the trailing ✓; the others are not", () => {
    renderPill({ current: "status" });
    fireEvent.click(screen.getByRole("button", { name: "Group by status" }));
    const current = screen.getByRole("menuitemradio", { name: "status" });
    expect(current).toHaveAttribute("aria-checked", "true");
    expect(current.textContent).toContain("✓");
    const other = screen.getByRole("menuitemradio", { name: "due" });
    expect(other).toHaveAttribute("aria-checked", "false");
    expect(other.textContent).not.toContain("✓");
  });

  it("selecting an option reports the value and closes the menu", () => {
    const onSelect = renderPill({ current: "status" });
    fireEvent.click(screen.getByRole("button", { name: "Group by status" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "due" }));
    expect(onSelect).toHaveBeenCalledWith("due");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Escape closes; outside-tap on the backdrop closes", () => {
    renderPill({ current: "status" });
    const trigger = screen.getByRole("button", { name: "Group by status" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    const backdrop = document.querySelector('button[aria-hidden="true"]');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop as Element);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("dirty tints the trigger border via the accent color-mix; clean keeps border-border", () => {
    renderPill({ current: "status", dirty: true });
    expect(screen.getByRole("button", { name: "Group by status" }).className).toContain(
      "color-mix",
    );
  });

  it("clean trigger carries the plain border, not the tint", () => {
    renderPill({ current: "status" });
    const cls = screen.getByRole("button", { name: "Group by status" }).className;
    expect(cls).toContain("border-border");
    expect(cls).not.toContain("color-mix");
  });

  it("the note renders as a non-interactive dim line — even with zero options", () => {
    renderPill({ options: [], note: "Nothing to organize by." });
    fireEvent.click(screen.getByRole("button", { name: "Group by status" }));
    expect(screen.getByText("Nothing to organize by.")).toBeTruthy();
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
  });

  it("phone sheet posture: the panel docks bottom at z-40 over the z-30 scrim (the FieldsControl tier)", () => {
    renderPill({ current: "status" });
    fireEvent.click(screen.getByRole("button", { name: "Group by status" }));
    const panel = screen.getByRole("menu", { name: "Group by" });
    expect(panel.className).toContain("fixed inset-x-0 bottom-0 z-40");
    // sm+ graduates to the anchored popover under the trigger.
    expect(panel.className).toContain("sm:absolute sm:top-full");
    const backdrop = document.querySelector('button[aria-hidden="true"]');
    expect((backdrop as HTMLElement).className).toContain("z-30");
  });
});

// --- Sections + hint — the generic grouping capability (not a GroupBy-only
// hack: any caller can section its options and/or preview a value on a row).

function renderSections(sections: ControlPillSection[], current?: string) {
  const onSelect = vi.fn();
  render(
    <ControlPill
      label="Group by"
      menuLabel="Group by"
      value={current ?? "—"}
      sections={sections}
      current={current}
      onSelect={onSelect}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^Group by/ }));
  return onSelect;
}

describe("ControlPill sections", () => {
  it("renders each section's heading, in array order, with its own rows below it", () => {
    renderSections([
      { heading: "Fields with values", options: [{ value: "status" }, { value: "priority" }] },
      { heading: "Other fields", options: [{ value: "owner" }] },
    ]);
    const menu = screen.getByRole("menu", { name: "Group by" });
    expect(within(menu).getByText("Fields with values")).toBeTruthy();
    expect(within(menu).getByText("Other fields")).toBeTruthy();
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((i) => i.textContent),
    ).toEqual(["status", "priority", "owner"]);
  });

  it("an unheaded lead section renders its row with no heading text above it", () => {
    renderSections([
      { options: [{ value: "legacy_lane" }] },
      { heading: "Fields with values", options: [{ value: "status" }] },
    ]);
    const menu = screen.getByRole("menu", { name: "Group by" });
    // Only ONE heading in the DOM — the lead section is unlabeled.
    expect(within(menu).getAllByText("Fields with values")).toHaveLength(1);
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((i) => i.textContent),
    ).toEqual(["legacy_lane", "status"]);
  });

  it("a row's hint renders as a dim preview on that row; a row with no hint carries none", () => {
    renderSections([
      {
        heading: "Fields with values",
        options: [{ value: "status", hint: "active · done" }, { value: "priority" }],
      },
    ]);
    const menu = screen.getByRole("menu", { name: "Group by" });
    const status = screen.getByRole("menuitemradio", { name: "status" });
    expect(within(status).getByText("active · done")).toBeTruthy();
    const priority = within(menu).getByRole("menuitemradio", { name: "priority" });
    expect(priority.textContent).toBe("priority");
  });

  // jsdom loads no stylesheet (`css: false` in vitest.config.ts) so scrollWidth
  // vs clientWidth is always 0/0 here — className is the only real signal
  // available, matching how the rest of this suite already asserts
  // presentational behavior (e.g. the dirty-border `color-mix` checks above).
  // A long hint used to claim a larger ABSOLUTE reduction under proportional
  // flex-shrink math (bigger flex-basis = bigger raw-pixel cut), which crushed
  // the field's own short name toward zero even though it lost fewer pixels
  // than the hint did. The label must never carry shrink/truncate — the hint
  // alone absorbs the squeeze — so a field's name is legible regardless of how
  // long its value preview runs.
  it("a long hint never shares shrink with the label — the label holds its width, the hint alone truncates", () => {
    renderSections([
      {
        heading: "Fields with values",
        options: [
          {
            value: "status",
            hint: "backlog · in progress · in review · blocked · done · archived",
          },
        ],
      },
    ]);
    const row = screen.getByRole("menuitemradio", { name: /status/ });
    const label = within(row).getByText("status");
    const hint = within(row).getByText(/backlog/);
    expect(label.className).not.toContain("truncate");
    expect(label.className).toContain("shrink-0");
    expect(hint.className).toContain("truncate");
  });

  // A flat, no-hint row (the By-date pill's field-name options, e.g. a
  // vault-defined `estimated_completion_date`) is the ONE caller where the
  // label is the only thing in the row competing for space — shrink-0 with
  // no truncate would let a long user-defined name overflow the menu's fixed
  // sm:w-56 into horizontal scroll/clip, where the original bare-flex-1 shape
  // gave a clean ellipsis instead. The label must keep truncating there.
  it("a row with NO hint keeps its own truncate — nothing else competes for the row's space", () => {
    renderSections([{ options: [{ value: "estimated_completion_date" }] }]);
    const row = screen.getByRole("menuitemradio", { name: "estimated_completion_date" });
    const label = within(row).getByText("estimated_completion_date");
    expect(label.className).toContain("truncate");
    expect(label.className).not.toContain("shrink-0");
  });

  it("selecting a sectioned row reports its value and closes the menu, same as the flat shape", () => {
    const onSelect = renderSections([
      { heading: "Fields with values", options: [{ value: "status" }, { value: "priority" }] },
    ]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "priority" }));
    expect(onSelect).toHaveBeenCalledWith("priority");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
