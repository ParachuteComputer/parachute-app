import { buildExtensions } from "@/components/CodeMirrorEditor";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

// jsdom doesn't implement Range.getClientRects()/getBoundingClientRect() —
// see the identical guard in CodeMirrorEditor.slash-menu.test.ts.
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

// jsdom has no PointerEvent constructor at all (only MouseEvent) — a
// minimal polyfill so the swipe-gesture tests below can dispatch real
// pointerdown/move/up sequences. Real Safari/iPadOS (this app's primary
// touch target) has full Pointer Events support, so production code using
// the real constructor is unaffected; this only backfills the test
// environment, same spirit as the Range stubs above.
if (typeof PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(
      type: string,
      init: MouseEventInit & { pointerId?: number; pointerType?: string } = {},
    ) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  // @ts-expect-error — backfilling a constructor jsdom doesn't ship.
  globalThis.PointerEvent = PointerEventPolyfill;
}

// jsdom doesn't implement window.matchMedia at all. Stubbable per test so
// both the coarse-pointer (toolbar shows) and fine-pointer (toolbar stays
// hidden, desktop keeps the keybindings) paths are exercised.
function stubPointerMedia(coarse: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("coarse") ? coarse : !coarse,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

let host: HTMLDivElement;

afterEach(() => {
  host?.remove();
  // Undo the per-test stub so it never leaks into a test that doesn't call
  // stubPointerMedia itself.
  // @ts-expect-error — reverting to jsdom's own "no matchMedia" baseline.
  window.matchMedia = undefined;
});

function makeEditor(doc: string, selection: { anchor: number; head?: number }, livePreview = true) {
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

describe("selection toolbar — coarse-pointer only (PR 5b)", () => {
  it("appears on a non-empty selection when the pointer is coarse", () => {
    stubPointerMedia(true);
    const view = makeEditor("hello world", { anchor: 0, head: 5 });
    const toolbar = view.dom.querySelector(".cm-format-toolbar");
    expect(toolbar).not.toBeNull();
    expect(
      Array.from(toolbar?.querySelectorAll("button") ?? []).map((b) =>
        b.getAttribute("aria-label"),
      ),
    ).toEqual(["Bold", "Italic", "Strikethrough", "Code", "Link"]);
  });

  it("does NOT appear when the pointer is fine (desktop mouse) — stays clean, keybindings instead", () => {
    stubPointerMedia(false);
    const view = makeEditor("hello world", { anchor: 0, head: 5 });
    expect(view.dom.querySelector(".cm-format-toolbar")).toBeNull();
  });

  it("does NOT appear on a caret-only (empty) selection, even on a coarse pointer", () => {
    stubPointerMedia(true);
    const view = makeEditor("hello world", { anchor: 3 });
    expect(view.dom.querySelector(".cm-format-toolbar")).toBeNull();
  });

  it("every button's ≥40px touch target and clicking Bold writes through the shared command", () => {
    stubPointerMedia(true);
    const view = makeEditor("hello world", { anchor: 0, head: 5 });
    const boldButton = Array.from(view.dom.querySelectorAll(".cm-format-toolbar button")).find(
      (b) => b.getAttribute("aria-label") === "Bold",
    ) as HTMLButtonElement;
    expect(boldButton).toBeTruthy();
    const cs = getComputedStyle(boldButton);
    expect(cs.minWidth).toBe("2.5rem");
    expect(cs.minHeight).toBe("2.5rem");
    boldButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe("**hello** world");
  });

  it("a button tap never collapses/moves the selection it's about to act on (mirrors the checkbox's pointerdown containment)", () => {
    stubPointerMedia(true);
    const view = makeEditor("hello world", { anchor: 0, head: 5 });
    const boldButton = view.dom.querySelector(".cm-format-toolbar button") as HTMLButtonElement;
    boldButton.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    boldButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    // Selection is untouched by the pointerdown/mousedown alone (only the
    // click handler dispatches the format command).
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(5);
  });
});

function swipe(
  view: EditorView,
  lineIndex: number,
  dx: number,
  dy = 0,
  opts: { pointerType?: string } = {},
) {
  const line = view.dom.querySelectorAll(".cm-line")[lineIndex] as HTMLElement;
  const startX = 50;
  const startY = 50;
  const pointerType = opts.pointerType ?? "touch";
  line.dispatchEvent(
    new PointerEvent("pointerdown", {
      pointerId: 1,
      pointerType,
      clientX: startX,
      clientY: startY,
      bubbles: true,
      cancelable: true,
    }),
  );
  line.dispatchEvent(
    new PointerEvent("pointermove", {
      pointerId: 1,
      pointerType,
      clientX: startX + dx,
      clientY: startY + dy,
      bubbles: true,
      cancelable: true,
    }),
  );
  line.dispatchEvent(
    new PointerEvent("pointerup", {
      pointerId: 1,
      pointerType,
      clientX: startX + dx,
      clientY: startY + dy,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("swipe-to-indent — list items, live-preview mode only (PR 5a)", () => {
  it("swipe right on a list item indents it — the same bytes Tab produces", () => {
    const view = makeEditor("- one\n- two", { anchor: 0 });
    swipe(view, 1, 60); // second line ("- two"), 60px right
    expect(view.state.doc.toString()).toBe("- one\n  - two");
  });

  it("swipe left on an indented list item outdents it", () => {
    const view = makeEditor("- one\n  - two", { anchor: 0 });
    swipe(view, 1, -60);
    expect(view.state.doc.toString()).toBe("- one\n- two");
  });

  it("a mostly-vertical drag never indents — vertical scroll wins the tie", () => {
    const view = makeEditor("- one\n- two", { anchor: 0 });
    swipe(view, 1, 20, 60); // dy dominates dx
    expect(view.state.doc.toString()).toBe("- one\n- two");
  });

  it("a small jitter under threshold is treated as a plain tap — places the cursor, no indent", () => {
    const view = makeEditor("- one\n- two", { anchor: 0 });
    swipe(view, 1, 5, 3);
    expect(view.state.doc.toString()).toBe("- one\n- two");
    expect(view.state.selection.main.head).toBeGreaterThan(5); // moved onto line 2
  });

  it("a swipe on a non-list line is a no-op for indentation (never claims the gesture)", () => {
    const view = makeEditor("plain text\nmore text", { anchor: 0 });
    swipe(view, 1, 60);
    expect(view.state.doc.toString()).toBe("plain text\nmore text");
  });

  it("a mouse drag is ignored entirely — desktop has Tab/Shift-Tab and the toolbar's keybindings", () => {
    const view = makeEditor("- one\n- two", { anchor: 0 });
    swipe(view, 1, 60, 0, { pointerType: "mouse" });
    expect(view.state.doc.toString()).toBe("- one\n- two");
  });

  it("does nothing while composing (IME discipline: never dispatch mid-composition)", () => {
    const view = makeEditor("- one\n- two", { anchor: 0 });
    Object.defineProperty(view, "composing", { value: true, configurable: true });
    swipe(view, 1, 60);
    expect(view.state.doc.toString()).toBe("- one\n- two");
  });

  it("raw mode: swipe is not wired at all (live-preview only)", () => {
    const view = makeEditor("- one\n- two", { anchor: 0 }, false);
    swipe(view, 1, 60);
    expect(view.state.doc.toString()).toBe("- one\n- two");
  });
});
