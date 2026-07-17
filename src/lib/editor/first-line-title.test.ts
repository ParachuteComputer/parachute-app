import { buildExtensions } from "@/components/CodeMirrorEditor";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

// jsdom doesn't implement Range measurement — the same stubs the sibling
// editor tests (live-preview.test.ts, CodeMirrorEditor.touch-grammar.test.ts)
// install so a headless EditorView can render lines.
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

let host: HTMLDivElement;
let view: EditorView;

afterEach(() => {
  view?.destroy();
  host?.remove();
});

// Built through the REAL `buildExtensions` wiring (not the extension in
// isolation) so the tests prove the decoration is actually wired into the
// editor. Raw mode (the default) — the decoration is mode-agnostic.
function make(doc: string, livePreview = false) {
  host = document.createElement("div");
  document.body.appendChild(host);
  view = new EditorView({
    state: EditorState.create({
      doc,
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
    }),
    parent: host,
  });
  return view;
}

function titleLine(v: EditorView): HTMLElement | null {
  return v.dom.querySelector(".cm-line.cm-first-line-title");
}

describe("first-line title decoration (FIX 3, 0.20.14)", () => {
  it("styles the first non-empty line as a title — and writes no markdown into the note", () => {
    const v = make("My great note\n\nbody text");
    const line = titleLine(v);
    expect(line).not.toBeNull();
    expect(line?.textContent).toBe("My great note");
    // Pure decoration: the bytes are untouched, no `# ` inserted.
    expect(v.state.doc.toString()).toBe("My great note\n\nbody text");
  });

  it("does NOT stack on an explicit ATX heading — the editor's heading styling covers it", () => {
    const v = make("# Already a heading\n\nbody");
    expect(titleLine(v)).toBeNull();
  });

  it("also styles the first line in live-preview mode", () => {
    const v = make("A plain title line\n\nbody", true);
    expect(titleLine(v)?.textContent).toBe("A plain title line");
  });

  it("skips YAML frontmatter — the title is the first line AFTER the closing ---", () => {
    const v = make("---\ntitle: x\ntags: [a, b]\n---\nThe real first line\n\nbody");
    expect(titleLine(v)?.textContent).toBe("The real first line");
  });

  it("skips leading blank lines to the first non-empty line", () => {
    const v = make("\n\n  \nActual title\nbody");
    expect(titleLine(v)?.textContent).toBe("Actual title");
  });

  it("tracks the moving first line live — deleting the first line promotes the next", () => {
    const v = make("First line\nSecond line");
    expect(titleLine(v)?.textContent).toBe("First line");
    // Delete the whole first line plus its trailing newline.
    v.dispatch({ changes: { from: 0, to: v.state.doc.line(2).from } });
    expect(titleLine(v)?.textContent).toBe("Second line");
    expect(v.state.doc.toString()).toBe("Second line");
  });
});
