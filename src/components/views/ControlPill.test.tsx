import { ControlPill } from "@/components/views/ControlPill";
import { fireEvent, render, screen } from "@testing-library/react";
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
