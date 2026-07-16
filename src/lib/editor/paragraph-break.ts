import { insertNewline } from "@codemirror/commands";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, StateCommand } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

// Aaron-ratified (2026-07-15): Enter is a context-aware paragraph break
// (the Typora school), Shift+Enter is an explicit hard break. Both commands
// sit at the editor's DEFAULT keymap precedence — CodeMirrorEditor's
// slash-menu (`autocompletion()`'s own keymap, `Prec.highest` in
// `@codemirror/autocomplete`) is tried first, so Enter while the menu is
// open commits the selected command and never reaches here.

const CODE_NODE_NAMES = new Set(["FencedCode", "CodeBlock"]);
const MARKUP_NODE_NAMES = new Set(["ListItem", "BulletList", "OrderedList", "Blockquote"]);
// GFM tables (only in the tree once the editor parses with
// `markdown({ base: markdownLanguage })` — the live-preview parser switch,
// CodeMirrorEditor.tsx). A table row is one pipe-delimited line; treat Enter
// there like a fence — a plain newline, never a paragraph break (which would
// explode a blank line into the middle of the table) and never a hard-break
// backslash (which the GFM table grammar doesn't tolerate mid-row either).
// Closes app#35.
const TABLE_NODE_NAMES = new Set(["Table"]);

type LineContext = "code" | "table" | "markup" | "prose";

// Walk the syntax tree up from the cursor to classify where it sits. `-1`
// side on resolveInner prefers the node ENDING at pos (the line just typed),
// matching how lang-markdown's own getContext looks at what you're leaving,
// not what comes next.
function lineContextAt(state: EditorState, pos: number): LineContext {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  for (; node; node = node.parent) {
    if (CODE_NODE_NAMES.has(node.name)) return "code";
    if (TABLE_NODE_NAMES.has(node.name)) return "table";
    if (MARKUP_NODE_NAMES.has(node.name)) return "markup";
  }
  return "prose";
}

// Enter: in a list/quote, delegate to lang-markdown's own continuation
// command (it already handles marker-continue AND empty-item-exits-list —
// nothing to reproduce). In a fence, a plain single newline — exploding a
// blank line into code would corrupt it. Everywhere else (prose), a REAL
// blank line: two newlines, so the file stays unambiguous CommonMark (a
// lone \n is a soft break inside the same paragraph, not a new one).
export const insertParagraphBreak: StateCommand = ({ state, dispatch }) => {
  const context = lineContextAt(state, state.selection.main.head);

  if (context === "markup" && insertNewlineContinueMarkup({ state, dispatch })) {
    return true;
  }
  if (context === "code" || context === "table") {
    return insertNewline({ state, dispatch });
  }

  const breakText = state.lineBreak + state.lineBreak;
  dispatch(
    state.update(state.replaceSelection(breakText), {
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};

// Shift+Enter: an explicit hard break in prose — backslash-before-newline
// (survives whitespace trimming; deliberately NOT the trailing-two-spaces
// convention, which round-trips badly through formatters). In lists/quotes/
// fences a bare backslash-newline would land on a marker-less continuation
// line and misparse, or corrupt a fence's literal bytes — plain newline
// there instead, no continuation.
export const insertHardOrPlainBreak: StateCommand = ({ state, dispatch }) => {
  const context = lineContextAt(state, state.selection.main.head);
  if (context !== "prose") {
    return insertNewline({ state, dispatch });
  }

  dispatch(
    state.update(state.replaceSelection(`\\${state.lineBreak}`), {
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};
