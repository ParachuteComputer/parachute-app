import { isListItemLine, listAwareIndent, listAwareOutdent } from "@/lib/editor/list-indent";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState, type StateCommand } from "@codemirror/state";
import { describe, expect, it } from "vitest";

// Pure StateCommand testing — mirrors format-commands.test.ts's harness. The
// gesture (swipe) side of this module needs a real DOM/EditorView and is
// covered in src/components/CodeMirrorEditor.touch-grammar.test.ts instead.
function apply(cmd: StateCommand, doc: string, anchor: number) {
  let state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [markdown({ base: markdownLanguage })],
  });
  const handled = cmd({
    state,
    dispatch: (tr) => {
      state = tr.state;
    },
  });
  return { state, handled };
}

describe("isListItemLine", () => {
  it("true on a bullet list item line", () => {
    const state = EditorState.create({
      doc: "- one\n- two",
      extensions: [markdown({ base: markdownLanguage })],
    });
    expect(isListItemLine(state, 2)).toBe(true);
  });

  it("false on a plain prose line", () => {
    const state = EditorState.create({
      doc: "just some text",
      extensions: [markdown({ base: markdownLanguage })],
    });
    expect(isListItemLine(state, 3)).toBe(false);
  });

  it("false on a heading line", () => {
    const state = EditorState.create({
      doc: "# Heading",
      extensions: [markdown({ base: markdownLanguage })],
    });
    expect(isListItemLine(state, 3)).toBe(false);
  });
});

describe("listAwareIndent / listAwareOutdent", () => {
  it("indents a list item — the same bytes indentMore/Tab would produce", () => {
    const { state, handled } = apply(listAwareIndent, "- one\n- two", 8); // cursor on "- two"
    expect(handled).toBe(true);
    expect(state.doc.toString()).toBe("- one\n  - two");
  });

  it("outdents an already-indented list item", () => {
    const { state, handled } = apply(listAwareOutdent, "- one\n  - two", 10); // cursor inside "  - two"
    expect(handled).toBe(true);
    expect(state.doc.toString()).toBe("- one\n- two");
  });

  it("returns false (falls through) off a list line — does not touch prose", () => {
    const { state, handled } = apply(listAwareIndent, "just prose", 4);
    expect(handled).toBe(false);
    expect(state.doc.toString()).toBe("just prose");
  });

  it("returns false inside a fenced code block, even one that looks list-ish", () => {
    const doc = "```\n- not a list\n```";
    const pos = doc.indexOf("not");
    const { state, handled } = apply(listAwareIndent, doc, pos);
    expect(handled).toBe(false);
    expect(state.doc.toString()).toBe(doc);
  });
});
