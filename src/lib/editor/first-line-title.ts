import { type EditorState, type Extension, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { frontmatterEnd } from "./live-preview";

// FIX 3 (0.20.14) — the Bear / Apple Notes move: a note's first non-empty
// content line IS its title (the vault's `display_title`: first line, leading
// `#` stripped, frontmatter skipped — vault 0.7.3-rc), so the editor RENDERS
// that line at title scale. Pure decoration — NOT one byte of `# ` or any
// structure is written into the note; the title look is a CodeMirror line
// decoration and nothing more. It mirrors `display_title`'s frontmatter-skip,
// tracks the moving first line live, and never stacks on an explicit heading
// (which the editor's own heading styling already covers).

const titleLine = Decoration.line({ class: "cm-first-line-title" });

// An ATX heading the user typed themselves (`# `, `## `, … up to 3 leading
// spaces per CommonMark, a space or line-end after the hashes). We leave those
// alone: in live mode the editor's own `.cm-lp-h*` already styles them, and in
// raw mode blowing up the literal `# ` markers would read worse than leaving
// the line at body size. `#tag` (no space) is NOT a heading and stays a
// plain-text title.
const ATX_HEADING = /^ {0,3}#{1,6}(?: |$)/;

function firstTitleLineDeco(state: EditorState): DecorationSet {
  const doc = state.doc;
  // Skip YAML frontmatter exactly as `display_title` does — shared helper so
  // the two never drift. `frontmatterEnd` returns the closing `---` line's end
  // offset, or 0 when there's no (terminated) frontmatter.
  const fmEnd = frontmatterEnd(doc);
  const first = fmEnd > 0 ? doc.lineAt(fmEnd).number + 1 : 1;
  for (let n = first; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.text.trim() === "") continue; // the first NON-EMPTY line is the title
    if (ATX_HEADING.test(line.text)) return Decoration.none; // rule (b): don't stack
    return Decoration.set(titleLine.range(line.from));
  }
  return Decoration.none;
}

const firstLineTitleField = StateField.define<DecorationSet>({
  create: firstTitleLineDeco,
  update(deco, tr) {
    // Only a document change can move the title line (promote the next line
    // when the first is deleted, demote when a line is inserted above). A
    // selection-only transaction leaves the old positions valid, so recompute
    // solely on `docChanged` — cheap, and keeps the styling tracking live.
    return tr.docChanged ? firstTitleLineDeco(tr.state) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Matches the editor's own H1 (live mode's `.cm-lp-h1`): serif, the top of the
// shared type ramp, title weight — so a plain first line reads as exactly the
// title it is, in both raw and live modes. Serif-accent-in-a-mono-editor has
// precedent in the `.cm-placeholder` (index.css). Editor-scoped theme (not a
// global class) so the styling is co-located with the extension and stays
// assertable the same way the live-preview heading sizes are.
const firstLineTitleTheme = EditorView.theme({
  ".cm-first-line-title": {
    fontFamily: "var(--font-serif)",
    fontSize: "var(--text-3xl)",
    fontWeight: "650",
    lineHeight: "1.25",
  },
});

export function firstLineTitle(): Extension {
  return [firstLineTitleField, firstLineTitleTheme];
}
