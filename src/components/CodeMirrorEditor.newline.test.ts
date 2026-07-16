import { buildExtensions } from "@/components/CodeMirrorEditor";
import { startCompletion } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

// jsdom doesn't implement Range.getClientRects() — see the identical guard
// in CodeMirrorEditor.slash-menu.test.ts (same tooltip-positioning call,
// only exercised here by the "menu open" precedence test below).
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () =>
    ({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON() {},
    }) as DOMRect;
}

// Aaron-ratified (2026-07-15): Enter is a context-aware paragraph break,
// Shift+Enter an explicit hard break (src/lib/editor/paragraph-break.ts).
// Exercises the ACTUAL keymap buildExtensions() assembles — Enter/Shift-Enter
// placed ahead of defaultKeymap in the same plain keymap.of([...]) call — not
// a re-description of it, against a real headless CM6 EditorView.

let host: HTMLDivElement;

afterEach(() => {
  host?.remove();
});

function makeEditor(doc: string, cursor: number) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: buildExtensions({
      onChangeRef: { current: () => {} },
      onSaveRef: { current: undefined },
      onCancelRef: { current: undefined },
      onPasteFileRef: { current: undefined },
      onRequestAttachmentRef: { current: undefined },
    }),
  });
  return new EditorView({ state, parent: host });
}

function pressEnter(view: EditorView, shift = false) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

async function flush() {
  await new Promise((r) => setTimeout(r, 80));
}

describe("Enter — context-aware paragraph break", () => {
  it("in prose, inserts a real blank line and lands the cursor on the new paragraph", () => {
    const view = makeEditor("hello world", 11);
    pressEnter(view);
    expect(view.state.doc.toString()).toBe("hello world\n\n");
    expect(view.state.selection.main.head).toBe(13);
  });

  it("in a list item, continues the marker on the next line", () => {
    const view = makeEditor("- one", 5);
    pressEnter(view);
    expect(view.state.doc.toString()).toBe("- one\n- ");
    expect(view.state.selection.main.head).toBe(8);
  });

  it("on an EMPTY list item, exits the list (native insertNewlineContinueMarkup behavior)", () => {
    const view = makeEditor("- ", 2);
    pressEnter(view);
    expect(view.state.doc.toString()).not.toContain("- ");
  });

  it("inside a fenced code block, inserts a single plain newline", () => {
    const view = makeEditor("```js\nconst x = 1\n```", 11);
    pressEnter(view);
    expect(view.state.doc.toString()).toBe("```js\nconst\n x = 1\n```");
    expect(view.state.selection.main.head).toBe(12);
  });

  it("with the slash-menu open, commits the completion instead of inserting a newline", async () => {
    const view = makeEditor("/h1", 3);
    startCompletion(view);
    await flush();
    // Interaction-delay guard the slash-menu test also waits out.
    await new Promise((r) => setTimeout(r, 100));
    pressEnter(view);
    expect(view.state.doc.toString()).toBe("# ");
    expect(view.state.selection.main.head).toBe(2);
  });
});

describe("Shift+Enter — explicit hard break", () => {
  it("in prose, inserts a backslash-before-newline hard break", () => {
    const view = makeEditor("hello", 5);
    pressEnter(view, true);
    expect(view.state.doc.toString()).toBe("hello\\\n");
    expect(view.state.selection.main.head).toBe(7);
  });

  it("inside a fenced code block, inserts a plain newline (no backslash)", () => {
    const view = makeEditor("```js\nconst x = 1\n```", 11);
    pressEnter(view, true);
    expect(view.state.doc.toString()).toBe("```js\nconst\n x = 1\n```");
    expect(view.state.selection.main.head).toBe(12);
  });
});

// A4-SPEC R2 (closes app#35): GFM tables only enter the tree once the editor
// parses with `markdown({ base: markdownLanguage })` (the live-preview
// parser switch) — with that in place, a table row is a single
// pipe-delimited line, so Enter there must behave like a fence: a plain
// newline, never a paragraph break (which would explode a blank line into
// the middle of the table) and never a hard-break backslash either.
describe("Enter / Shift+Enter inside a GFM table row", () => {
  const tableDoc = "| a | b |\n| - | - |\n| 1 | 2 |";

  it("Enter inserts a single plain newline, not a paragraph break", () => {
    const cursor = tableDoc.indexOf("1") + 1; // right after "1" in the last row
    const view = makeEditor(tableDoc, cursor);
    pressEnter(view);
    expect(view.state.doc.toString()).toBe(
      `${tableDoc.slice(0, cursor)}\n${tableDoc.slice(cursor)}`,
    );
    expect(view.state.selection.main.head).toBe(cursor + 1);
  });

  it("Shift+Enter inserts a plain newline too — no backslash hard-break", () => {
    const cursor = tableDoc.indexOf("2") + 1; // right after "2" in the last row
    const view = makeEditor(tableDoc, cursor);
    pressEnter(view, true);
    expect(view.state.doc.toString()).toBe(
      `${tableDoc.slice(0, cursor)}\n${tableDoc.slice(cursor)}`,
    );
    expect(view.state.selection.main.head).toBe(cursor + 1);
  });
});
