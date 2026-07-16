import { buildExtensions } from "@/components/CodeMirrorEditor";
import { closeCompletion, currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom doesn't implement Range.getClientRects() (text-node measurement),
// which CM6's tooltip-positioning pass calls unconditionally the moment a
// completion "opens" — a real DOM measurement CM6 always schedules, not
// something these tests choose to trigger. Stub a zero-rect list; these
// tests assert completion STATE (what's open, what the doc says), not
// tooltip pixel placement.
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

// Exercises the ACTUAL extension wiring buildExtensions() assembles (the
// autocompletion() override + the plain keymap.of([...defaultKeymap,
// Mod-s, Escape])), not a re-description of it — this is the wiring the
// component mounts verbatim. Runs against a real, headless CM6 EditorView;
// no React rendering needed since the slash menu lives entirely in
// CodeMirror's own state/keymap machinery.

interface Handlers {
  onChange?: (next: string) => void;
  onSave?: () => void;
  onCancel?: () => void;
  onPasteFile?: (files: File[]) => boolean;
  onRequestAttachment?: () => void;
}

let host: HTMLDivElement;

afterEach(() => {
  host?.remove();
});

function makeEditor(doc: string, cursor: number, handlers: Handlers = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: buildExtensions({
      onChangeRef: { current: handlers.onChange ?? (() => {}) },
      onSaveRef: { current: handlers.onSave },
      onCancelRef: { current: handlers.onCancel },
      onPasteFileRef: { current: handlers.onPasteFile },
      onRequestAttachmentRef: { current: handlers.onRequestAttachment },
    }),
  });
  return new EditorView({ state, parent: host });
}

// Even an explicit startCompletion() goes through a real ~50ms internal
// debounce before CM6 queries any source (see completionPlugin.update's
// `pendingStart` branch) — a shorter wait or a microtask-only flush isn't
// enough. Real timer, not fake: CM6's own scheduling uses actual
// setTimeout/requestAnimationFrame calls that fake timers don't drive.
async function flush() {
  await new Promise((r) => setTimeout(r, 80));
}

describe("the slash menu, wired the same way CodeMirrorEditor mounts it", () => {
  it("opens with all 10 commands on a bare '/' at the start of a line", async () => {
    const view = makeEditor("/", 1);
    startCompletion(view);
    await flush();
    const options = currentCompletions(view.state);
    expect(options.map((o) => o.label)).toEqual([
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Bulleted list",
      "Numbered list",
      "To-do",
      "Quote",
      "Code block",
      "Divider",
      "Image / attachment",
    ]);
  });

  it("does NOT open mid-word — 'and/or' never triggers the menu", async () => {
    const view = makeEditor("and/or", 4); // cursor right after "and/"
    startCompletion(view);
    await flush();
    expect(currentCompletions(view.state)).toEqual([]);
  });

  it("narrows the list as the query is typed", async () => {
    const view = makeEditor("/quo", 4);
    startCompletion(view);
    await flush();
    const options = currentCompletions(view.state);
    expect(options.map((o) => o.label)).toEqual(["Quote"]);
  });

  it("committing a heading replaces the /query text with '# ' and leaves the cursor after it", async () => {
    const onChange = vi.fn();
    const view = makeEditor("/h1", 3, { onChange });
    startCompletion(view);
    await flush();
    // First option (Heading 1) is pre-selected — accept it the same way a
    // real Enter keypress does once the interaction-delay guard clears.
    await new Promise((r) => setTimeout(r, 100));
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe("# ");
    expect(view.state.selection.main.head).toBe(2);
    expect(onChange).toHaveBeenLastCalledWith("# ");
  });

  it("Image/attachment invokes onRequestAttachment and clears the /query text", async () => {
    const onRequestAttachment = vi.fn();
    const view = makeEditor("/image", 6, { onRequestAttachment });
    startCompletion(view);
    await flush();
    const options = currentCompletions(view.state);
    const image = options.find((o) => o.label === "Image / attachment");
    expect(image).toBeTruthy();
    if (!image || typeof image.apply !== "function") throw new Error("image.apply missing");
    image.apply(view, image, 0, 6);
    expect(view.state.doc.toString()).toBe("");
    expect(onRequestAttachment).toHaveBeenCalledOnce();
  });

  describe("Escape layering — closes the menu first, cancels the editor second", () => {
    it("first Escape closes an open menu without calling onCancel", async () => {
      const onCancel = vi.fn();
      const view = makeEditor("/", 1, { onCancel });
      startCompletion(view);
      await flush();
      expect(currentCompletions(view.state).length).toBeGreaterThan(0);

      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );

      expect(currentCompletions(view.state)).toEqual([]);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("second Escape (menu already closed) falls through to onCancel", async () => {
      const onCancel = vi.fn();
      const view = makeEditor("/", 1, { onCancel });
      startCompletion(view);
      await flush();

      // Close it directly (mirrors the first Escape in the test above).
      closeCompletion(view);
      expect(currentCompletions(view.state)).toEqual([]);

      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("Escape with no menu open goes straight to onCancel", () => {
      const onCancel = vi.fn();
      const view = makeEditor("some text", 4, { onCancel });
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });
});

// N3 (from PR #33's `slash-commands.ts:153` comment, closed by A4's parser
// switch putting the syntax tree in play): "/" inside code isn't "starting a
// line" in the markdown sense. Gated on the tree in slash-completion.ts,
// applies in BOTH editor modes (the tree is available regardless of
// live-preview) — this file's `makeEditor` builds without `livePreview`, so
// these cases prove the raw-mode side of that claim.
describe("N3 — the slash menu never opens inside code", () => {
  it("does not open on '/' at the start of a line inside a fenced code block", async () => {
    const doc = "```js\n/\n```";
    const view = makeEditor(doc, 7); // cursor right after the "/" on the fence's second line
    startCompletion(view);
    await flush();
    expect(currentCompletions(view.state)).toEqual([]);
  });

  it("does not open inside a 4-space indented code block", async () => {
    const doc = "para\n\n    /\n";
    const view = makeEditor(doc, 11); // cursor right after the indented "/"
    startCompletion(view);
    await flush();
    expect(currentCompletions(view.state)).toEqual([]);
  });

  it("does not open inside inline code", async () => {
    const doc = "text `/` more";
    const view = makeEditor(doc, 7); // cursor right after the "/" inside the backticks
    startCompletion(view);
    await flush();
    expect(currentCompletions(view.state)).toEqual([]);
  });

  it("still opens at a plain line start, unaffected by the gate", async () => {
    const view = makeEditor("/", 1);
    startCompletion(view);
    await flush();
    expect(currentCompletions(view.state).length).toBeGreaterThan(0);
  });

  it("still opens on a 4-space-indented line that's a LIST continuation, not an indented code block — the tree gate gets this right where the old regex couldn't (A4-SPEC §9)", async () => {
    // "- top item" then a continuation line indented 4 spaces resolves to
    // Paragraph > ListItem > BulletList to lezer, NOT CodeBlock — list
    // context wins over the indent threshold.
    const view = makeEditor("- top item\n    /\n", 16);
    startCompletion(view);
    await flush();
    expect(currentCompletions(view.state).length).toBeGreaterThan(0);
  });
});
