import { SLASH_COMMANDS, matchSlashTrigger, matchesQuery } from "@/lib/editor/slash-commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("matchSlashTrigger", () => {
  it("matches a bare / at the start of a line", () => {
    expect(matchSlashTrigger("/")).toEqual({ leadingWhitespace: "", query: "" });
  });

  it("matches / with a partial query", () => {
    expect(matchSlashTrigger("/head")).toEqual({ leadingWhitespace: "", query: "head" });
  });

  it("matches / preceded by only whitespace on the line", () => {
    expect(matchSlashTrigger("   /todo")).toEqual({ leadingWhitespace: "   ", query: "todo" });
  });

  it("does NOT match / mid-word — 'and/or' must never open the menu", () => {
    expect(matchSlashTrigger("and/or")).toBeNull();
    expect(matchSlashTrigger("and/")).toBeNull();
    expect(matchSlashTrigger("and/o")).toBeNull();
  });

  it("does not match once a space follows the query (the trigger closed)", () => {
    expect(matchSlashTrigger("/head ")).toBeNull();
  });

  it("does not match a line with no slash at all", () => {
    expect(matchSlashTrigger("just typing")).toBeNull();
  });
});

describe("matchesQuery", () => {
  const heading1 = SLASH_COMMANDS.find((c) => c.id === "h1");
  if (!heading1) throw new Error("h1 command missing");

  it("matches everything on an empty query", () => {
    expect(matchesQuery(heading1, "")).toBe(true);
  });

  it("matches on a label substring, case-insensitively", () => {
    expect(matchesQuery(heading1, "heading")).toBe(true);
    expect(matchesQuery(heading1, "HEADING")).toBe(true);
  });

  it("matches on a keyword prefix", () => {
    expect(matchesQuery(heading1, "h1")).toBe(true);
  });

  it("does not match an unrelated query", () => {
    expect(matchesQuery(heading1, "divider")).toBe(false);
  });
});

// Exercises each command's apply() against a real (headless) CM6 EditorView
// so assertions are the actual document text CodeMirror produces, not a
// hand-simulated string.
describe("SLASH_COMMANDS apply()", () => {
  let host: HTMLDivElement;

  afterEach(() => {
    host?.remove();
  });

  function makeView(doc: string, cursor: number) {
    host = document.createElement("div");
    document.body.appendChild(host);
    const state = EditorState.create({ doc, selection: { anchor: cursor } });
    return new EditorView({ state, parent: host });
  }

  function command(id: string) {
    const cmd = SLASH_COMMANDS.find((c) => c.id === id);
    if (!cmd) throw new Error(`missing command ${id}`);
    return cmd;
  }

  it("Heading 1/2/3 insert the marker and place the cursor right after it", () => {
    for (const [id, prefix] of [
      ["h1", "# "],
      ["h2", "## "],
      ["h3", "### "],
    ] as const) {
      const view = makeView("/h", 2);
      command(id).apply(view, 0, 2);
      expect(view.state.doc.toString()).toBe(prefix);
      expect(view.state.selection.main.head).toBe(prefix.length);
      view.destroy();
    }
  });

  it("Bulleted list inserts '- '", () => {
    const view = makeView("/bullet", 7);
    command("bulleted-list").apply(view, 0, 7);
    expect(view.state.doc.toString()).toBe("- ");
    expect(view.state.selection.main.head).toBe(2);
  });

  it("Numbered list inserts '1. '", () => {
    const view = makeView("/number", 7);
    command("numbered-list").apply(view, 0, 7);
    expect(view.state.doc.toString()).toBe("1. ");
    expect(view.state.selection.main.head).toBe(3);
  });

  it("To-do inserts a GFM task-list marker", () => {
    const view = makeView("/todo", 5);
    command("todo").apply(view, 0, 5);
    expect(view.state.doc.toString()).toBe("- [ ] ");
    expect(view.state.selection.main.head).toBe(6);
  });

  it("Quote inserts a blockquote marker", () => {
    const view = makeView("/quote", 6);
    command("quote").apply(view, 0, 6);
    expect(view.state.doc.toString()).toBe("> ");
    expect(view.state.selection.main.head).toBe(2);
  });

  it("Code block inserts a fenced pair with the cursor on the blank line inside", () => {
    const view = makeView("/code", 5);
    command("code").apply(view, 0, 5);
    expect(view.state.doc.toString()).toBe("```\n\n```");
    expect(view.state.selection.main.head).toBe(4);
    // Cursor sits on the empty middle line.
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("");
  });

  // The cursor must ALWAYS land on the line after the divider — never
  // appended straight onto "---" itself (that would read "---text" the
  // instant the user keeps typing). Every case below asserts this via
  // `lineAt(cursor)` rather than a raw offset, so it reads as "which line
  // is the cursor actually on" regardless of how the padding math shifts
  // the absolute position.

  it("Divider on an otherwise-empty doc inserts '---' followed by a newline, cursor on the line after", () => {
    const view = makeView("/hr", 3);
    command("divider").apply(view, 0, 3);
    expect(view.state.doc.toString()).toBe("---\n");
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("");
  });

  it("Divider pads a leading blank line when the previous line has content (Setext-heading guard)", () => {
    // Doc: "Some heading\n/hr" — "/hr" is the whole second line.
    const view = makeView("Some heading\n/hr", 16);
    command("divider").apply(view, 13, 16);
    expect(view.state.doc.toString()).toBe("Some heading\n\n---\n");
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("");
  });

  it("Divider pads a trailing blank line when the next line has content", () => {
    // Doc: "/hr\nMore text" — "/hr" is the whole first line.
    const view = makeView("/hr\nMore text", 3);
    command("divider").apply(view, 0, 3);
    expect(view.state.doc.toString()).toBe("---\n\nMore text");
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("");
  });

  it("Divider pads both sides when squeezed between two lines of content", () => {
    const view = makeView("Above\n/hr\nBelow", 9);
    command("divider").apply(view, 6, 9);
    expect(view.state.doc.toString()).toBe("Above\n\n---\n\nBelow");
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("");
  });

  it("Divider does NOT double-pad when the next line is already blank — cursor still lands there, not on '---'", () => {
    // Doc: "/hr\n\nBelow" — "/hr" is the whole first line, line 2 is
    // already blank. No padding is needed (one already exists), but the
    // cursor still has to move off the divider's own line onto it.
    const view = makeView("/hr\n\nBelow", 3);
    command("divider").apply(view, 0, 3);
    expect(view.state.doc.toString()).toBe("---\n\nBelow");
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("");
  });

  it("Image/attachment clears the query text and calls onRequestAttachment, without inserting markdown itself", () => {
    const view = makeView("/image", 6);
    const onRequestAttachment = vi.fn();
    command("image").apply(view, 0, 6, onRequestAttachment);
    expect(view.state.doc.toString()).toBe("");
    expect(onRequestAttachment).toHaveBeenCalledOnce();
  });

  it("Image/attachment is a no-op safely when no callback is wired", () => {
    const view = makeView("/image", 6);
    expect(() => command("image").apply(view, 0, 6)).not.toThrow();
    expect(view.state.doc.toString()).toBe("");
  });
});
