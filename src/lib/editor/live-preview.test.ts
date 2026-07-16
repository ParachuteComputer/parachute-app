import { readFileSync } from "node:fs";
import { buildExtensions } from "@/components/CodeMirrorEditor";
import { buildDecorations } from "@/lib/editor/live-preview";
import { undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

// Real, headless `EditorView` against the ACTUAL `buildExtensions` wiring
// (`{ livePreview: true }`) — the same pattern CodeMirrorEditor.slash-menu
// test.ts uses for the slash menu. Same jsdom `Range` gaps as those files
// (CM6's tooltip-positioning path calls these even when nothing here opens
// a tooltip, since `autocompletion()` is still part of the extension set).
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
afterEach(() => {
  host?.remove();
});

function makeEditor(doc: string, cursor: number | { anchor: number; head: number } = 0) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const state = EditorState.create({
    doc,
    selection: typeof cursor === "number" ? { anchor: cursor } : cursor,
    extensions: buildExtensions(
      {
        onChangeRef: { current: () => {} },
        onSaveRef: { current: undefined },
        onCancelRef: { current: undefined },
        onPasteFileRef: { current: undefined },
        onRequestAttachmentRef: { current: undefined },
      },
      { livePreview: true },
    ),
  });
  return new EditorView({ state, parent: host });
}

// jsdom reports zero real layout, so CM's own viewport heuristic clamps
// `visibleRanges` to roughly its first ~1000-char estimate rather than the
// whole doc (confirmed empirically against the 11k+-char morning-pages
// fixture below) — exactly the viewport-only behavior the production path
// wants. The perf test (§10.5) explicitly wants the WHOLE doc as its worst
// case, so it builds against a duck-typed view exposing the full range
// instead of relying on a real (and here, irrelevant) viewport measurement.
function fullRangeView(view: EditorView): EditorView {
  return {
    state: view.state,
    visibleRanges: [{ from: 0, to: view.state.doc.length }],
    composing: false,
  } as unknown as EditorView;
}

function fixture(name: string): string {
  return readFileSync(`src/lib/editor/__fixtures__/corpus/${name}`, "utf8");
}

const CORPUS_FIXTURES = [
  "voice-transcript.md",
  "wikilink-dense.md",
  "fence-heavy.md",
  "morning-pages.md",
  "edge-cases.md",
];

describe("live-preview — invariant 1: decorations never mutate the document", () => {
  for (const name of CORPUS_FIXTURES) {
    it(`${name}: cursor walk, multi-line selections, and a rebuild never change the buffer`, () => {
      const content = fixture(name);
      const view = makeEditor(content, 0);

      // Walk the cursor line-by-line through the whole doc.
      for (let lineNo = 1; lineNo <= view.state.doc.lines; lineNo++) {
        const line = view.state.doc.line(lineNo);
        view.dispatch({ selection: { anchor: line.from } });
        expect(view.state.doc.toString()).toBe(content);
        view.dispatch({ selection: { anchor: line.to } });
        expect(view.state.doc.toString()).toBe(content);
      }

      // Make and clear a few multi-line selections.
      const lastLine = view.state.doc.line(view.state.doc.lines);
      view.dispatch({ selection: { anchor: 0, head: lastLine.to } });
      expect(view.state.doc.toString()).toBe(content);
      view.dispatch({ selection: { anchor: 0 } });
      expect(view.state.doc.toString()).toBe(content);

      // "Scroll" — force a decoration rebuild directly (§10 doesn't require
      // real pixel scrolling, just that a rebuild is provably a no-op on
      // the buffer).
      buildDecorations(fullRangeView(view));
      expect(view.state.doc.toString()).toBe(content);
    });
  }
});

describe("live-preview — invariant 2 & reveal correctness", () => {
  it("heading keeps its font-size line class whether revealed or not", () => {
    const doc = "# Hello\n\nSome text\n";
    // Cursor away from the heading line — it's NOT revealed.
    const hidden = makeEditor(doc, 10);
    const hiddenHeading = hidden.dom.querySelector(".cm-line.cm-lp-heading.cm-lp-h1");
    expect(hiddenHeading).not.toBeNull();
    expect(hiddenHeading?.textContent).toBe("Hello"); // "# " hidden

    // Cursor ON the heading line — it IS revealed.
    const revealed = makeEditor(doc, 3);
    const revealedHeading = revealed.dom.querySelector(".cm-line.cm-lp-heading.cm-lp-h1");
    expect(revealedHeading).not.toBeNull(); // invariant 2: class applies regardless
    expect(revealedHeading?.textContent).toBe("# Hello"); // but the marker shows
  });

  it("a selection spanning multiple lines reveals every touched line", () => {
    const doc = "# One\n# Two\n# Three\n";
    const view = makeEditor(doc, { anchor: 0, head: doc.indexOf("Two") });
    const text = view.dom.querySelector(".cm-content")?.textContent ?? "";
    // Lines 1 and 2 are touched by the selection — both reveal their "#".
    // Line 3 is untouched — its "#" stays hidden.
    expect(text).toContain("# One");
    expect(text).toContain("# Two");
    expect(text).not.toContain("# Three");
    expect(text).toContain("Three");
  });

  it("decorations elsewhere stay intact while one line is revealed", () => {
    const doc = "# Heading\n\nSome **bold** text.\n";
    const view = makeEditor(doc, 3); // cursor on the heading line
    const text = view.dom.querySelector(".cm-content")?.textContent ?? "";
    expect(text).toContain("# Heading"); // revealed
    expect(text).toContain("Some bold text."); // "**" still hidden elsewhere
    expect(text).not.toContain("**");
  });
});

describe("live-preview — checkbox toggle exactness (A4-SPEC §4)", () => {
  it("toggling an unchecked box writes exactly one 'x', doc otherwise byte-identical", () => {
    const doc = "intro\n\n- [ ] buy milk\n";
    const view = makeEditor(doc, 0); // cursor away from the todo line
    const box = view.dom.querySelector(".cm-lp-checkbox") as HTMLInputElement | null;
    expect(box).not.toBeNull();
    expect(box?.checked).toBe(false);

    box?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(view.state.doc.toString()).toBe("intro\n\n- [x] buy milk\n");
  });

  it("toggling a checked box writes exactly one ' ', doc otherwise byte-identical", () => {
    const doc = "intro\n\n- [x] buy milk\n";
    const view = makeEditor(doc, 0);
    const box = view.dom.querySelector(".cm-lp-checkbox") as HTMLInputElement | null;
    expect(box?.checked).toBe(true);

    box?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(view.state.doc.toString()).toBe("intro\n\n- [ ] buy milk\n");
  });

  it("the toggle is undoable — it goes through the normal transaction flow, not a bypass", () => {
    const doc = "intro\n\n- [ ] buy milk\n";
    const view = makeEditor(doc, 0); // cursor away from the todo line
    const box = view.dom.querySelector(".cm-lp-checkbox") as HTMLInputElement | null;
    box?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe("intro\n\n- [x] buy milk\n");

    const undid = undo(view);
    expect(undid).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("the toggle's onChange fires exactly once", async () => {
    let changeCount = 0;
    let lastValue = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    const state = EditorState.create({
      doc: "intro\n\n- [ ] buy milk\n",
      selection: { anchor: 0 }, // cursor away from the todo line
      extensions: buildExtensions(
        {
          onChangeRef: {
            current: (next: string) => {
              changeCount++;
              lastValue = next;
            },
          },
          onSaveRef: { current: undefined },
          onCancelRef: { current: undefined },
          onPasteFileRef: { current: undefined },
          onRequestAttachmentRef: { current: undefined },
        },
        { livePreview: true },
      ),
    });
    const view = new EditorView({ state, parent: host });
    const box = view.dom.querySelector(".cm-lp-checkbox") as HTMLInputElement | null;
    box?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(changeCount).toBe(1);
    expect(lastValue).toBe("intro\n\n- [x] buy milk\n");
  });

  it("tapping the checkbox never places the cursor on that line (reveal never eats the tap)", () => {
    const doc = "intro\n\n- [ ] buy milk\n";
    const view = makeEditor(doc, 0);
    const box = view.dom.querySelector(".cm-lp-checkbox") as HTMLInputElement | null;
    box?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    box?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    box?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    // Selection is untouched by the toggle transaction (only `changes` was
    // dispatched) — the todo line never became revealed by this tap.
    expect(view.state.selection.main.head).toBe(0);
    const todoLineText = view.dom.querySelectorAll(".cm-line")[2]?.textContent ?? "";
    expect(todoLineText).not.toContain("[");
  });

  it("tapping the todo TEXT (not the checkbox) reveals the line normally — no widget placed", () => {
    const doc = "- [ ] buy milk\n";
    const view = makeEditor(doc, doc.indexOf("buy"));
    expect(view.dom.querySelector(".cm-lp-checkbox")).toBeNull();
    expect(view.dom.querySelector(".cm-content")?.textContent).toBe("- [ ] buy milk");
  });
});

describe("live-preview — touch target (A4-SPEC §4/§6, ≥2.5rem)", () => {
  it("the checkbox's hit area (wrap padding + visual box) totals 2.5rem square", () => {
    const view = makeEditor("intro\n\n- [ ] todo\n", 0);
    const wrap = view.dom.querySelector(".cm-lp-checkbox-wrap") as HTMLElement | null;
    expect(wrap).not.toBeNull();
    const cs = getComputedStyle(wrap as HTMLElement);
    // Visual box 1.25rem + 0.625rem padding on each side = 2.5rem hit area;
    // the matching negative margin keeps surrounding text position stable.
    expect(cs.width).toBe("1.25rem");
    expect(cs.padding).toBe("0.625rem");
    expect(cs.margin).toContain("-0.625rem");
  });
});

describe("live-preview — fence / indented-code / table sanctity (A4-SPEC §10.4)", () => {
  it("markdown-looking content inside a fenced code block is provably undecorated", () => {
    const content = fixture("fence-heavy.md");
    const view = makeEditor(content, 0);
    const text = view.dom.querySelector(".cm-content")?.textContent ?? "";
    expect(text).toContain('echo "- [ ] not a checkbox"');
    expect(text).toContain('echo "**not bold**"');
    expect(text).toContain('echo "[[not a wikilink]]"');
    expect(text).toContain("// [[also not a wikilink]]");
    expect(text).toContain('const heading = "# not a heading either";');
    // The indented block, same rule.
    expect(text).toContain("# still not a heading");
    expect(text).toContain("- [ ] still not a checkbox");
    expect(text).toContain("**still not bold**");
    // Zero heading/checkbox/bullet decoration fired anywhere in the doc's
    // fenced/indented regions (the one real heading is "# Snippets").
    expect(view.dom.querySelectorAll(".cm-lp-heading").length).toBe(1);
    expect(view.dom.querySelector(".cm-lp-checkbox")).toBeNull();
    expect(view.dom.querySelector(".cm-lp-bullet")).toBeNull();
  });

  it("a table renders raw and undamaged", () => {
    // A small standalone doc rather than the big edge-cases.md fixture —
    // jsdom's zero-layout viewport heuristic clamps rendered lines to
    // roughly the first ~30 regardless of char count (confirmed against
    // the invariant-test fixtures), which would put edge-cases.md's table
    // (line 33) outside the rendered DOM for reasons unrelated to this
    // assertion. The invariant test above already covers edge-cases.md's
    // buffer-immutability at every position, table included.
    const doc =
      "intro\n\n| Name | Role     |\n| ---- | -------- |\n| Ada  | Engineer |\n| Issa | Poet     |\n";
    const view = makeEditor(doc, 0);
    const text = view.dom.querySelector(".cm-content")?.textContent ?? "";
    expect(text).toContain("| Name | Role     |");
    expect(text).toContain("| ---- | -------- |");
    expect(text).toContain("| Ada  | Engineer |");
    expect(text).toContain("| Issa | Poet     |");
  });

  it("the Setext-underline trap: a bare '---' right under a paragraph is NOT a horizontal rule", () => {
    const content = fixture("edge-cases.md");
    const view = makeEditor(content, 0);
    // Only ONE real horizontal rule in the fixture (the blank-line-separated
    // one) — the Setext-heading underline must not also render as an <hr>.
    expect(view.dom.querySelectorAll(".cm-lp-hr").length).toBe(1);
  });
});

describe("live-preview — frontmatter guard (A4-SPEC §10.8)", () => {
  it("frontmatter renders raw — no HR widget on its dashes, no heading decoration on its keys", () => {
    const content = fixture("edge-cases.md");
    const view = makeEditor(content, 0);
    const lines = Array.from(view.dom.querySelectorAll(".cm-line"));
    // The frontmatter's opening/closing "---" lines are the first and
    // fourth lines of the fixture — neither should carry the HR widget.
    expect(lines[0]?.querySelector(".cm-lp-hr")).toBeNull();
    expect(lines[3]?.querySelector(".cm-lp-hr")).toBeNull();
    expect(lines[0]?.textContent).toBe("---");
    expect(lines[1]?.textContent).toBe("title: Edge cases");
  });

  it("a minimal frontmatter doc decorates only what follows the closing '---'", () => {
    const doc = "---\ntitle: x\n---\n\n# Real heading\n";
    const view = makeEditor(doc, 0);
    expect(view.dom.querySelectorAll(".cm-lp-hr").length).toBe(0);
    expect(view.dom.querySelectorAll(".cm-lp-heading").length).toBe(1);
  });
});

describe("live-preview — wikilinks and embeds", () => {
  it("a plain wikilink is decorated as ONE construct, not double-decorated by an incidental Link-node parse", () => {
    // Regression: `[[Wikilink]]`'s inner `[Wikilink]` looks like a valid
    // shortcut-reference Link to lezer — without the containment check in
    // buildDecorations, both the Link-node handler and the wikilink-regex
    // handler would decorate the same span (nested `cm-lp-link` +
    // `wikilink` spans instead of just `wikilink`).
    const view = makeEditor("intro\n\nSee [[Wikilink]] here.\n", 0); // cursor away from the wikilink's line
    const el = view.dom.querySelector(".wikilink");
    expect(el).not.toBeNull();
    expect(el?.className.trim()).toBe("wikilink");
    expect(view.dom.querySelector(".cm-lp-link")).toBeNull();
    expect(view.dom.querySelector(".cm-content")?.textContent).toBe("introSee Wikilink here.");
  });

  it("an aliased wikilink shows only the alias", () => {
    const view = makeEditor("intro\n\n[[Slow Productivity|the slow-productivity idea]]\n", 0);
    expect(view.dom.querySelector(".cm-content")?.textContent).toBe(
      "introthe slow-productivity idea",
    );
  });

  it("unicode wikilink targets round-trip through decoration untouched", () => {
    const doc = "intro\n\n[[小林 一茶|Issa]] and [[Владимир Набоков]]\n";
    const view = makeEditor(doc, 0);
    const text = view.dom.querySelector(".cm-content")?.textContent ?? "";
    expect(text).toBe("introIssa and Владимир Набоков");
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("an embed renders a placeholder chip, not the raw syntax", () => {
    const view = makeEditor("intro\n\n![[voice-note.m4a]]\n", 0);
    const chip = view.dom.querySelector(".cm-lp-embed-chip");
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("voice-note.m4a");
  });

  it("wikilink syntax inside inline code stays literal (not decorated)", () => {
    const view = makeEditor("intro\n\nUse `[[this]]` to link.\n", 0);
    expect(view.dom.querySelector(".wikilink")).toBeNull();
    expect(view.dom.querySelector(".cm-content")?.textContent).toBe("introUse [[this]] to link.");
  });
});

describe("live-preview — performance bound (A4-SPEC §10.5)", () => {
  it("a full decoration build over the whole ~11k-char morning-pages corpus note is under 50ms", () => {
    const content = fixture("morning-pages.md");
    expect(content.length).toBeGreaterThan(10_000);
    const view = makeEditor(content, 0);
    const full = fullRangeView(view);

    buildDecorations(full); // warm up (JIT, first-parse)
    const start = performance.now();
    buildDecorations(full);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
  });
});
