import { buildExtensions } from "@/components/CodeMirrorEditor";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

// jsdom doesn't implement Range.getClientRects()/getBoundingClientRect() —
// see the identical guard in CodeMirrorEditor.slash-menu.test.ts (CM6's
// tooltip-positioning path calls these unconditionally, autocompletion() is
// part of the extension set regardless of whether a completion is open).
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

// Exercises the ACTUAL keymap buildExtensions() assembles (POLISH-WAVE PR 5 /
// EDITOR-STUDY §5-6's shared format-commands, wired ahead of defaultKeymap
// the same way Enter/Shift-Enter are — CodeMirrorEditor.newline.test.ts's
// own pattern) against a real headless CM6 EditorView, in BOTH editor modes:
// "used by the toolbar AND new bindings ... in buildExtensions (both modes)"
// per the PR 5b spec.

let host: HTMLDivElement;

afterEach(() => {
  host?.remove();
});

function makeEditor(
  doc: string,
  selection: { anchor: number; head?: number },
  livePreview: boolean,
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const state = EditorState.create({
    doc,
    selection,
    extensions: buildExtensions(
      {
        onChangeRef: { current: () => {} },
        onSaveRef: { current: undefined },
        onCancelRef: { current: undefined },
        onPasteFileRef: { current: undefined },
        onRequestAttachmentRef: { current: undefined },
      },
      { livePreview },
    ),
  });
  return new EditorView({ state, parent: host });
}

// CM6's "Mod-" resolves to Cmd on macOS / Ctrl elsewhere, based on
// `/Mac/.test(navigator.platform)`. jsdom's navigator.platform is "" (not
// "MacIntel"), so `browser.mac` is false here and Mod resolves to Ctrl —
// ctrlKey and metaKey are NOT interchangeable: CM6 builds the matched key
// name by concatenating every held modifier's own prefix (`modifiers()` in
// @codemirror/view), so setting BOTH produces "Meta-Ctrl-b", which matches
// neither a Ctrl-b nor a Meta-b binding. Ctrl-only is what this jsdom
// environment's Mod-b binding actually normalizes to.
function pressMod(view: EditorView, key: string, opts: { shift?: boolean } = {}) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      ctrlKey: true,
      shiftKey: opts.shift ?? false,
      bubbles: true,
      cancelable: true,
    }),
  );
}

for (const mode of [
  { label: "live-preview mode", livePreview: true },
  { label: "raw mode", livePreview: false },
] as const) {
  describe(`format-command keybindings — ${mode.label}`, () => {
    it("Mod-b bolds the selection", () => {
      const view = makeEditor("hello world", { anchor: 0, head: 5 }, mode.livePreview);
      pressMod(view, "b");
      expect(view.state.doc.toString()).toBe("**hello** world");
    });

    it("Mod-i italicizes the selection", () => {
      const view = makeEditor("hello world", { anchor: 0, head: 5 }, mode.livePreview);
      pressMod(view, "i");
      expect(view.state.doc.toString()).toBe("*hello* world");
    });

    it("Mod-Shift-x strikes through the selection", () => {
      const view = makeEditor("hello world", { anchor: 0, head: 5 }, mode.livePreview);
      pressMod(view, "x", { shift: true });
      expect(view.state.doc.toString()).toBe("~~hello~~ world");
    });

    it("Mod-e wraps the selection as inline code", () => {
      const view = makeEditor("hello world", { anchor: 0, head: 5 }, mode.livePreview);
      pressMod(view, "e");
      expect(view.state.doc.toString()).toBe("`hello` world");
    });

    it("Mod-e expands a ragged selection through complete emphasis delimiters (#144)", () => {
      const doc = "a **bold** b `code` d";
      const view = makeEditor(
        doc,
        { anchor: doc.indexOf("bold") + 1, head: doc.indexOf("code") + 2 },
        mode.livePreview,
      );
      pressMod(view, "e");
      expect(view.state.doc.toString()).toBe("a `**bold** b code` d");
    });

    it("Mod-Enter creates a to-do from a caret on a plain line", () => {
      const view = makeEditor("buy milk", { anchor: 0 }, mode.livePreview);
      pressMod(view, "Enter");
      expect(view.state.doc.toString()).toBe("- [ ] buy milk");
    });

    it("Mod-b twice round-trips (wrap then unwrap) — the toggle survives a real keymap dispatch, not just direct command calls", () => {
      const view = makeEditor("hello", { anchor: 0, head: 5 }, mode.livePreview);
      pressMod(view, "b");
      expect(view.state.doc.toString()).toBe("**hello**");
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
      pressMod(view, "b");
      expect(view.state.doc.toString()).toBe("hello");
    });
  });
}

// Review delta — IME safety gap. CM's keymap dispatcher does not itself
// check composition state (verified against @codemirror/view's source: the
// keydown handler runs bound commands regardless of `view.composing`), so
// without an explicit guard in format-commands.ts these bindings could fire
// and mutate the document mid-IME-composition. `.composing` is a read-only
// getter on the real EditorView, backed by actual compositionstart/end
// event tracking — overridden here via defineProperty to simulate an
// in-progress IME session, the same technique
// CodeMirrorEditor.touch-grammar.test.ts uses for the swipe gesture's own
// composing guard.
//
// Mod-Enter's OWN guard is proven precisely at the unit level instead
// (format-commands.test.ts's "IME safety" describe block, which invokes
// `toggleTodo` directly against a `{state, dispatch, composing: true}`
// target and asserts `dispatch` is never called) — a real keydown dispatch
// with the override above doesn't work for Enter specifically: CM6 has its
// own separate "Enter confirms an in-progress IME composition" handling
// (see @codemirror/view's `ignoreDuringComposition` comment), which reacts
// to `defineProperty`'s FAKE composing signal without the real
// compositionstart/end event sequence backing it, and ends up inserting a
// newline through that unrelated code path — confirmed via `defaultPrevented
// === true` on the dispatched event (the keymap guard DID fire and prevent
// default correctly; the stray newline is CM6's own IME-confirm fallback,
// not a gap in this PR's guard). Bold doesn't have that special case, so
// Mod-b's guard is provable both ways below.
describe("IME guard — composing suppresses the keybindings (review delta)", () => {
  it("Mod-b does nothing while composing", () => {
    const view = makeEditor("hello world", { anchor: 0, head: 5 }, true);
    Object.defineProperty(view, "composing", { value: true, configurable: true });
    pressMod(view, "b");
    expect(view.state.doc.toString()).toBe("hello world");
  });

  it("Mod-b works normally again once composing ends", () => {
    const view = makeEditor("hello world", { anchor: 0, head: 5 }, true);
    Object.defineProperty(view, "composing", { value: true, configurable: true });
    pressMod(view, "b");
    expect(view.state.doc.toString()).toBe("hello world"); // suppressed
    Object.defineProperty(view, "composing", { value: false, configurable: true });
    pressMod(view, "b");
    expect(view.state.doc.toString()).toBe("**hello** world"); // now applies
  });
});

describe("Tab/Shift-Tab — list-aware indent, live mode only", () => {
  it("Tab indents a list item in live-preview mode", () => {
    const view = makeEditor("- one\n- two", { anchor: 8 }, true); // cursor on "- two"
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe("- one\n  - two");
  });

  it("Shift-Tab outdents a list item in live-preview mode", () => {
    const view = makeEditor("- one\n  - two", { anchor: 10 }, true);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe("- one\n- two");
  });

  it("Tab off a list line does not indent — native behavior is left alone", () => {
    const view = makeEditor("just prose", { anchor: 4 }, true);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe("just prose");
  });

  it("raw mode: Tab is NOT bound to list-aware indent (raw is the power surface, unaffected)", () => {
    const view = makeEditor("- one\n- two", { anchor: 8 }, false);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
    // No indent applied by our binding in raw mode — the doc is untouched
    // by list-aware indent (defaultKeymap has no Tab handler either).
    expect(view.state.doc.toString()).toBe("- one\n- two");
  });
});
