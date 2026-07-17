import {
  FORMAT_COMMANDS,
  toggleBold,
  toggleCode,
  toggleItalic,
  toggleStrikethrough,
  toggleTodo,
  wrapLink,
} from "@/lib/editor/format-commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState, type StateCommand } from "@codemirror/state";
import { describe, expect, it } from "vitest";

// Pure StateCommand testing — no EditorView/DOM needed, same pattern the
// commands themselves use (`{state, dispatch}`). The markdown language
// extension is required so the syntax tree these commands walk is actually
// populated (bare EditorState has no parser).
function apply(cmd: StateCommand, doc: string, selection: { anchor: number; head?: number }) {
  let state = EditorState.create({
    doc,
    selection,
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

describe("toggleBold", () => {
  it("wraps a selection in **", () => {
    const { state } = apply(toggleBold, "hello world", { anchor: 0, head: 5 });
    expect(state.doc.toString()).toBe("**hello** world");
    expect(state.selection.main.from).toBe(2);
    expect(state.selection.main.to).toBe(7);
  });

  it("unwraps when the selection exactly spans an existing bold node", () => {
    const { state } = apply(toggleBold, "**hello** world", { anchor: 0, head: 9 });
    expect(state.doc.toString()).toBe("hello world");
  });

  it("unwraps when the selection is the inner text, markers outside it", () => {
    const doc = "say **hello** now";
    const from = doc.indexOf("hello");
    const to = from + "hello".length;
    const { state } = apply(toggleBold, doc, { anchor: from, head: to });
    expect(state.doc.toString()).toBe("say hello now");
  });

  it("does not confuse bold with italic on a **wrapped** selection (tree-based, not char-counting)", () => {
    // A naive single-"*" prefix/suffix check would also "match" this and
    // strip one asterisk from each side — the tree lookup must find
    // StrongEmphasis specifically, not just any run of asterisks.
    const { state } = apply(toggleItalic, "**bold**", { anchor: 0, head: 8 });
    expect(state.doc.toString()).toBe("***bold***");
  });

  it("caret-only: inserts an empty pair and parks the cursor inside", () => {
    const { state } = apply(toggleBold, "hello", { anchor: 5 });
    expect(state.doc.toString()).toBe("hello****");
    expect(state.selection.main.head).toBe(7);
  });

  it("caret-only twice: the second press collapses the empty pair instead of nesting", () => {
    const first = apply(toggleBold, "hello", { anchor: 5 });
    expect(first.state.doc.toString()).toBe("hello****");
    const second = apply(toggleBold, first.state.doc.toString(), {
      anchor: first.state.selection.main.head,
    });
    expect(second.state.doc.toString()).toBe("hello");
  });

  it("multi-line selection wraps the whole span, newline included", () => {
    const doc = "one\ntwo";
    const { state } = apply(toggleBold, doc, { anchor: 0, head: doc.length });
    expect(state.doc.toString()).toBe("**one\ntwo**");
  });
});

describe("toggleItalic / toggleStrikethrough / toggleCode", () => {
  it("italic wraps and unwraps with a single '*'", () => {
    const wrapped = apply(toggleItalic, "hello world", { anchor: 0, head: 5 });
    expect(wrapped.state.doc.toString()).toBe("*hello* world");
    const unwrapped = apply(toggleItalic, wrapped.state.doc.toString(), { anchor: 0, head: 7 });
    expect(unwrapped.state.doc.toString()).toBe("hello world");
  });

  it("strikethrough wraps and unwraps with '~~'", () => {
    const wrapped = apply(toggleStrikethrough, "hello world", { anchor: 0, head: 5 });
    expect(wrapped.state.doc.toString()).toBe("~~hello~~ world");
    const unwrapped = apply(toggleStrikethrough, wrapped.state.doc.toString(), {
      anchor: 0,
      head: 9,
    });
    expect(unwrapped.state.doc.toString()).toBe("hello world");
  });

  it("code wraps and unwraps with a single backtick", () => {
    const wrapped = apply(toggleCode, "const x = 1", { anchor: 0, head: 5 });
    expect(wrapped.state.doc.toString()).toBe("`const` x = 1");
    const unwrapped = apply(toggleCode, wrapped.state.doc.toString(), { anchor: 0, head: 7 });
    expect(unwrapped.state.doc.toString()).toBe("const x = 1");
  });
});

describe("wrapLink", () => {
  it("wraps a selection as [text]() and parks the cursor inside the parens", () => {
    const { state } = apply(wrapLink, "see docs here", { anchor: 4, head: 8 });
    expect(state.doc.toString()).toBe("see [docs]() here");
    expect(state.selection.main.head).toBe(state.doc.toString().indexOf("()") + 1);
  });

  it("caret-only: inserts empty brackets/parens with the cursor inside the brackets", () => {
    const { state } = apply(wrapLink, "hello", { anchor: 5 });
    expect(state.doc.toString()).toBe("hello[]()");
  });
});

describe("toggleTodo (Mod-Enter)", () => {
  it("caret-only on a plain prose line: creates a new to-do item", () => {
    const { state } = apply(toggleTodo, "buy milk", { anchor: 0 });
    expect(state.doc.toString()).toBe("- [ ] buy milk");
  });

  it("on a plain list item (no checkbox yet): adds the checkbox", () => {
    const { state } = apply(toggleTodo, "- buy milk", { anchor: 2 });
    expect(state.doc.toString()).toBe("- [ ] buy milk");
  });

  it("on an unchecked to-do: checks it (same one-character write the tap-toggle uses)", () => {
    const { state } = apply(toggleTodo, "- [ ] buy milk", { anchor: 2 });
    expect(state.doc.toString()).toBe("- [x] buy milk");
  });

  it("on a checked to-do: unchecks it", () => {
    const { state } = apply(toggleTodo, "- [x] buy milk", { anchor: 2 });
    expect(state.doc.toString()).toBe("- [ ] buy milk");
  });

  it("multi-line selection: converts every non-blank touched line independently", () => {
    const doc = "milk\neggs\n\nbread";
    const { state } = apply(toggleTodo, doc, { anchor: 0, head: doc.length });
    expect(state.doc.toString()).toBe("- [ ] milk\n- [ ] eggs\n\n- [ ] bread");
  });

  it("multi-line selection across two SEPARATE (blank-line-divided) items: each gets its own correct transform", () => {
    const doc = "- [ ] milk\n\neggs";
    const { state } = apply(toggleTodo, doc, { anchor: 0, head: doc.length });
    expect(state.doc.toString()).toBe("- [x] milk\n\n- [ ] eggs");
  });

  it("a lazy-continuation line (no marker, no blank line) is part of the SAME item — one change, not two colliding writes", () => {
    // CommonMark lazy continuation: "eggs" right under "- [ ] milk" with no
    // blank line and no marker of its own stays part of that ONE list
    // item's paragraph, same rule live-preview.ts's blockquote handling
    // documents (N3). A naive per-touched-LINE loop would resolve both
    // lines to the same Task node and emit two overlapping changes at the
    // same TaskMarker position — regression coverage for that bug.
    const doc = "- [ ] milk\neggs";
    const { state } = apply(toggleTodo, doc, { anchor: 0, head: doc.length });
    expect(state.doc.toString()).toBe("- [x] milk\neggs");
  });
});

describe("FORMAT_COMMANDS", () => {
  it("lists exactly the five toolbar buttons, each wired to the real command", () => {
    expect(FORMAT_COMMANDS.map((c) => c.id)).toEqual([
      "bold",
      "italic",
      "strikethrough",
      "code",
      "link",
    ]);
    expect(FORMAT_COMMANDS.find((c) => c.id === "bold")?.run).toBe(toggleBold);
    expect(FORMAT_COMMANDS.find((c) => c.id === "link")?.run).toBe(wrapLink);
  });
});
