import { TagBrowser } from "@/components/TagBrowser";
import { stubPointer } from "@/test/dnd";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("TagBrowser", () => {
  const baseProps = {
    onToggle: () => {},
    onClear: () => {},
  };

  it("renders tags sorted by count descending by default", () => {
    render(
      <TagBrowser
        {...baseProps}
        tags={[
          { name: "idea", count: 2 },
          { name: "journal", count: 8 },
          { name: "project", count: 5 },
        ]}
        pinnedTags={[]}
        selected={[]}
      />,
    );
    const buttons = screen.getAllByRole("button").filter((b) => b.title?.startsWith("#"));
    expect(buttons.map((b) => b.title)).toEqual(["#journal", "#project", "#idea"]);
  });

  it("floats pinned tags to the top regardless of count", () => {
    render(
      <TagBrowser
        {...baseProps}
        tags={[
          { name: "big", count: 100 },
          { name: "small", count: 1 },
        ]}
        pinnedTags={["small"]}
        selected={[]}
      />,
    );
    const buttons = screen.getAllByRole("button").filter((b) => b.title?.startsWith("#"));
    expect(buttons[0]?.title).toBe("#small");
  });

  it("groups slash-delimited tags under a collapsible parent", () => {
    render(
      <TagBrowser
        {...baseProps}
        tags={[
          { name: "summary/daily", count: 10 },
          { name: "summary/weekly", count: 3 },
        ]}
        pinnedTags={[]}
        selected={[]}
      />,
    );
    // Group is collapsed by default — children hidden.
    expect(screen.queryByTitle("#summary/daily")).toBeNull();
    const expand = screen.getByRole("button", { name: /Expand summary/i });
    fireEvent.click(expand);
    expect(screen.getByTitle("#summary/daily")).toBeInTheDocument();
    expect(screen.getByTitle("#summary/weekly")).toBeInTheDocument();
  });

  it("fires onToggle with the tag name on click", () => {
    const onToggle = vi.fn();
    render(
      <TagBrowser
        {...baseProps}
        onToggle={onToggle}
        tags={[{ name: "journal", count: 3 }]}
        pinnedTags={[]}
        selected={[]}
      />,
    );
    fireEvent.click(screen.getByTitle("#journal"));
    expect(onToggle).toHaveBeenCalledWith("journal");
  });

  it("auto-expands a group when one of its children is selected", () => {
    render(
      <TagBrowser
        {...baseProps}
        tags={[
          { name: "summary/daily", count: 10 },
          { name: "summary/weekly", count: 3 },
        ]}
        pinnedTags={[]}
        selected={["summary/daily"]}
      />,
    );
    const daily = screen.getByTitle("#summary/daily");
    expect(daily).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a Clear button when selection is non-empty", () => {
    const onClear = vi.fn();
    render(
      <TagBrowser
        {...baseProps}
        onClear={onClear}
        tags={[{ name: "idea", count: 2 }]}
        pinnedTags={[]}
        selected={["idea"]}
      />,
    );
    const clear = screen.getByRole("button", { name: /clear/i });
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("group badge shows the sum of child tag counts", () => {
    render(
      <TagBrowser
        {...baseProps}
        tags={[
          { name: "summary/daily", count: 10 },
          { name: "summary/weekly", count: 3 },
          { name: "summary/monthly", count: 2 },
        ]}
        pinnedTags={[]}
        selected={[]}
      />,
    );
    // The collapsed group's "Expand summary" button has the prefix label and
    // the running total of its children — no need to expand to see the count.
    const expand = screen.getByRole("button", { name: /Expand summary/i });
    const groupRow = expand.parentElement!;
    expect(within(groupRow).getByText("#summary/")).toBeInTheDocument();
    expect(within(groupRow).getByText("15")).toBeInTheDocument();
  });

  it("group row shows the family TOTAL, not the parent's own count, when the parent tag exists", () => {
    render(
      <TagBrowser
        {...baseProps}
        tags={[
          { name: "summary", count: 4 },
          { name: "summary/daily", count: 10 },
          { name: "summary/weekly", count: 3 },
        ]}
        pinnedTags={[]}
        selected={[]}
      />,
    );
    // When the parent tag exists, the row renders as a TagRow (not the
    // expand-button label) — but the badge is the family total (4+10+3=17),
    // not the parent's own bare count (4). This is the bug a real vault hits
    // hardest: a heavy family whose parent has zero notes of its own would
    // otherwise render as "#family 0" (see the regression test below).
    const parent = screen.getByTitle("#summary");
    expect(within(parent).getByText("17")).toBeInTheDocument();
    expect(within(parent).queryByText("4")).not.toBeInTheDocument();
    // Expand and check the leaf counts stay their own.
    fireEvent.click(screen.getByRole("button", { name: /Expand summary/i }));
    expect(within(screen.getByTitle("#summary/daily")).getByText("10")).toBeInTheDocument();
    expect(within(screen.getByTitle("#summary/weekly")).getByText("3")).toBeInTheDocument();
  });

  it("regression: a collapsed family with a zero-count parent shows the total, not '#family 0'", () => {
    // Real-vault shape (bigvault fixture): #capture itself tags zero notes
    // directly, but is the heaviest family once its children are counted.
    render(
      <TagBrowser
        {...baseProps}
        tags={[
          { name: "capture", count: 0 },
          { name: "capture/voice", count: 622 },
          { name: "capture/text", count: 304 },
          { name: "capture/photo", count: 25 },
        ]}
        pinnedTags={[]}
        selected={[]}
      />,
    );
    const parent = screen.getByTitle("#capture");
    expect(within(parent).getByText("951")).toBeInTheDocument();
    expect(within(parent).queryByText("0")).not.toBeInTheDocument();
  });

  it("renders the tag-browser nav with Tags heading at the top of the sidebar", () => {
    render(
      <TagBrowser
        {...baseProps}
        tags={[{ name: "idea", count: 2 }]}
        pinnedTags={[]}
        selected={[]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: /browse by tag/i });
    expect(within(nav).getByText(/^Tags$/)).toBeInTheDocument();
  });

  describe("typeahead", () => {
    it("filters by name-contains match, count-ranked, and Enter toggles the top match", () => {
      const onToggle = vi.fn();
      render(
        <TagBrowser
          {...baseProps}
          onToggle={onToggle}
          tags={[
            { name: "plant", count: 5 },
            { name: "place", count: 10 },
            { name: "idea", count: 2 },
          ]}
          pinnedTags={[]}
          selected={[]}
        />,
      );
      const input = screen.getByRole("searchbox", { name: /filter tags/i });
      fireEvent.change(input, { target: { value: "pla" } });
      // Both "place" and "plant" contain "pla"; "idea" doesn't match and
      // drops out entirely.
      expect(screen.getByTitle("#place")).toBeInTheDocument();
      expect(screen.getByTitle("#plant")).toBeInTheDocument();
      expect(screen.queryByTitle("#idea")).not.toBeInTheDocument();
      // Count-ranked: "place" (10) outranks "plant" (5) — Enter toggles the
      // top match, "place", not "plant".
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onToggle).toHaveBeenCalledWith("place");
    });

    it("does nothing on Enter when the query matches no tag", () => {
      const onToggle = vi.fn();
      render(
        <TagBrowser
          {...baseProps}
          onToggle={onToggle}
          tags={[{ name: "idea", count: 2 }]}
          pinnedTags={[]}
          selected={[]}
        />,
      );
      const input = screen.getByRole("searchbox", { name: /filter tags/i });
      fireEvent.change(input, { target: { value: "zzz" } });
      expect(screen.getByText(/no tags match/i)).toBeInTheDocument();
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onToggle).not.toHaveBeenCalled();
    });

    it("autofocuses the filter input on a fine-pointer (desktop) device", () => {
      const restore = stubPointer("fine");
      render(
        <TagBrowser
          {...baseProps}
          tags={[{ name: "idea", count: 2 }]}
          pinnedTags={[]}
          selected={[]}
        />,
      );
      expect(screen.getByRole("searchbox", { name: /filter tags/i })).toHaveFocus();
      restore();
    });

    it("does not autofocus on a coarse-pointer (phone) device — it would cover the list with the keyboard", () => {
      const restore = stubPointer("coarse");
      render(
        <TagBrowser
          {...baseProps}
          tags={[{ name: "idea", count: 2 }]}
          pinnedTags={[]}
          selected={[]}
        />,
      );
      expect(screen.getByRole("searchbox", { name: /filter tags/i })).not.toHaveFocus();
      restore();
    });
  });

  describe("shortlist + disclosure", () => {
    const manyTags = Array.from({ length: 15 }, (_, i) => ({
      name: `tag${i}`,
      count: 15 - i,
    }));

    it("caps the default view at ~10 rows, hiding the tail behind a disclosure", () => {
      render(<TagBrowser {...baseProps} tags={manyTags} pinnedTags={[]} selected={[]} />);
      const shortlist = screen.getByRole("list", { name: /shortlist/i });
      expect(within(shortlist).getAllByRole("listitem")).toHaveLength(10);
      // The lowest-count tags are below the fold by default.
      expect(screen.queryByTitle("#tag14")).not.toBeInTheDocument();
      expect(screen.queryByTitle("#tag13")).not.toBeInTheDocument();
    });

    it("reveals the full grouped tree when the 'All N tags' disclosure is opened", () => {
      render(<TagBrowser {...baseProps} tags={manyTags} pinnedTags={[]} selected={[]} />);
      const disclosure = screen.getByRole("button", { name: /all 15 tags/i });
      expect(screen.queryByTitle("#tag14")).not.toBeInTheDocument();
      fireEvent.click(disclosure);
      expect(screen.getByTitle("#tag14")).toBeInTheDocument();
    });

    it("does not render the disclosure when every tag already fits in the shortlist", () => {
      render(
        <TagBrowser
          {...baseProps}
          tags={[{ name: "idea", count: 2 }]}
          pinnedTags={[]}
          selected={[]}
        />,
      );
      expect(screen.queryByRole("button", { name: /all \d+ tags/i })).not.toBeInTheDocument();
    });

    it("orders the shortlist as selected, then pinned, then top-by-count", () => {
      render(
        <TagBrowser
          {...baseProps}
          tags={[
            { name: "heavy", count: 100 },
            { name: "picked", count: 1 },
            { name: "starred", count: 2 },
          ]}
          pinnedTags={["starred"]}
          selected={["picked"]}
        />,
      );
      const shortlist = screen.getByRole("list", { name: /shortlist/i });
      const rows = within(shortlist)
        .getAllByRole("button")
        .filter((b) => b.title?.startsWith("#"));
      expect(rows.map((r) => r.title)).toEqual(["#picked", "#starred", "#heavy"]);
    });
  });

  describe("typed-tag schema marker", () => {
    it("shows a field-count glyph on tags carrying a schema", () => {
      render(
        <TagBrowser
          {...baseProps}
          tags={[
            {
              name: "task",
              count: 5,
              fields: { due: { type: "date" }, priority: { type: "string" } },
            },
            { name: "idea", count: 2 },
          ]}
          pinnedTags={[]}
          selected={[]}
        />,
      );
      expect(within(screen.getByTitle("#task")).getByText("⊞ 2")).toBeInTheDocument();
      expect(within(screen.getByTitle("#idea")).queryByText(/⊞/)).not.toBeInTheDocument();
    });
  });
});
