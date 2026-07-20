import { bottomScrollMargin, buildExtensions } from "@/components/CodeMirrorEditor";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

// jsdom has no layout, so this suite can't measure a real pixel scroll (that's
// an on-device eyeball — see the PR). It pins the CAUSE of the reported jump
// instead: the amount of viewport CM reserves below the caret when it
// auto-scrolls to keep the cursor visible. Regression under guard: the 0.20.17
// Wave-1 editor used `view.dom.clientHeight * 0.3`, reserving ~a third of the
// screen below the caret. Since every keystroke asks CM to scroll the cursor
// into view, that made CM re-scroll the moment the caret passed ~70% of the
// viewport — i.e. on essentially every new visual line — pinning the caret in a
// fixed high band with dead space below (Aaron, morning pages: "always jumping
// to the top of the current paragraph while typing"). The fix ties the
// scroll-off to line-height, so a taller viewport can never inflate it.

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}

let host: HTMLDivElement;
afterEach(() => host?.remove());

function makeEditor(doc = "hello world") {
  host = document.createElement("div");
  document.body.appendChild(host);
  const state = EditorState.create({
    doc,
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

describe("editor scroll-off below the caret (no viewport jump while typing)", () => {
  it("is a small fixed amount tied to line-height, NOT a fraction of the viewport", () => {
    const line = 24;
    // The margin must be identical whether the viewport is 200px or 10000px
    // tall — that viewport-independence is the whole fix. A viewport-scaled
    // margin (the old `clientHeight * 0.3`) would return 60 vs. 3000 here.
    const tall = {
      defaultLineHeight: line,
      dom: { clientHeight: 10_000 },
    } as unknown as EditorView;
    const short = { defaultLineHeight: line, dom: { clientHeight: 200 } } as unknown as EditorView;
    expect(bottomScrollMargin(tall)).toBe(line * 2);
    expect(bottomScrollMargin(short)).toBe(line * 2);
    expect(bottomScrollMargin(tall)).toBe(bottomScrollMargin(short));
    // Unmistakably smaller than the old ~30%-of-viewport reserve.
    expect(bottomScrollMargin(tall)).toBeLessThan(10_000 * 0.3);
  });

  it("wires that small scroll-off as the editor's only bottom scroll margin", () => {
    const view = makeEditor();
    // Deterministic geometry in a layout-less DOM: a large viewport that must
    // NOT inflate the margin, plus a known line height.
    Object.defineProperty(view.dom, "clientHeight", { value: 10_000, configurable: true });
    Object.defineProperty(view, "defaultLineHeight", { value: 24, configurable: true });
    let bottom = 0;
    for (const source of view.state.facet(EditorView.scrollMargins)) {
      const margins = source(view);
      if (margins?.bottom != null) bottom = Math.max(bottom, margins.bottom);
    }
    // Two line-heights, independent of the 10000px viewport (the old code would
    // register 3000 here).
    expect(bottom).toBe(48);
    view.destroy();
  });
});
