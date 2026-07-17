import { syntaxTree } from "@codemirror/language";
import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type StateCommand,
} from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

// POLISH-WAVE PR 5 / EDITOR-STUDY §5-6 — the shared format-command module.
// Every wrap/unwrap and the to-do toggle write the SAME bytes typing would
// produce (markdown-true, per the wave charter): `**`/`*`/`~~`/`` ` ``
// wrappers, `[text]()`, `- [ ] `. This module is the single place those
// bytes get written; the selection toolbar and the keybindings below both
// call straight into it rather than each re-implementing the transform —
// "one grammar, [several] doors" (POLISH-WAVE PR 5, EDITOR-STUDY §6).

// ---------------------------------------------------------------------------
// Toggle-aware wrap/unwrap (bold/italic/strikethrough/code)

// Finds the smallest ancestor of `nodeName` whose range fully covers
// [from, to] — i.e. the selection sits entirely inside (or exactly spans) an
// existing mark. Tree-based rather than string-prefix matching so bold
// ("**") and italic ("*") never get confused with each other the way naive
// character counting would (lezer has already disambiguated them).
function findMarkNode(
  state: EditorState,
  from: number,
  to: number,
  nodeName: string,
): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, from === to ? -1 : 1);
  for (; node; node = node.parent) {
    if (node.name === nodeName && node.from <= from && node.to >= to) return node;
  }
  return null;
}

function markInnerRange(
  node: SyntaxNode,
  markChildName: string,
): { outerFrom: number; outerTo: number; innerFrom: number; innerTo: number } | null {
  const marks = node.getChildren(markChildName);
  if (marks.length < 2) return null;
  const open = marks[0];
  const close = marks[marks.length - 1];
  return { outerFrom: node.from, outerTo: node.to, innerFrom: open.to, innerTo: close.from };
}

// One factory for bold/italic/strikethrough/code — each is "wrap the
// selection in `marker` on both sides, or unwrap if it's already wrapped."
function makeToggleWrap(nodeName: string, markChildName: string, marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const tr = state.changeByRange((range) => {
      const { from, to } = range;
      const node = findMarkNode(state, from, to, nodeName);
      if (node) {
        const bounds = markInnerRange(node, markChildName);
        if (bounds) {
          const inner = state.doc.sliceString(bounds.innerFrom, bounds.innerTo);
          return {
            changes: { from: bounds.outerFrom, to: bounds.outerTo, insert: inner },
            range: EditorSelection.range(bounds.outerFrom, bounds.outerFrom + inner.length),
          };
        }
      }
      // An empty wrap ("**|**") never parses as a mark node — CommonMark
      // emphasis/code spans require content between the delimiters — so the
      // tree check above can't see it. Narrow string fallback for exactly
      // that caret-adjacent case, so pressing the shortcut twice on an
      // empty pair collapses it instead of nesting more markers around it.
      if (from === to) {
        const before = state.doc.sliceString(Math.max(0, from - marker.length), from);
        const after = state.doc.sliceString(to, Math.min(state.doc.length, to + marker.length));
        if (before === marker && after === marker) {
          return {
            changes: [
              { from: from - marker.length, to: from, insert: "" },
              { from: to, to: to + marker.length, insert: "" },
            ],
            range: EditorSelection.cursor(from - marker.length),
          };
        }
      }
      const selected = state.doc.sliceString(from, to);
      return {
        changes: { from, to, insert: marker + selected + marker },
        range:
          from === to
            ? EditorSelection.cursor(from + marker.length)
            : EditorSelection.range(from + marker.length, to + marker.length),
      };
    });
    dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

export const toggleBold = makeToggleWrap("StrongEmphasis", "EmphasisMark", "**");
export const toggleItalic = makeToggleWrap("Emphasis", "EmphasisMark", "*");
export const toggleStrikethrough = makeToggleWrap("Strikethrough", "StrikethroughMark", "~~");
export const toggleCode = makeToggleWrap("InlineCode", "CodeMark", "`");

// Link is NOT toggle-aware (POLISH-WAVE PR 5b: "wraps [selection]() and
// parks the cursor inside the parens") — always wraps, cursor lands ready
// to type the URL.
export const wrapLink: StateCommand = ({ state, dispatch }) => {
  const tr = state.changeByRange((range) => {
    const { from, to } = range;
    const selected = state.doc.sliceString(from, to);
    const insert = `[${selected}]()`;
    return {
      changes: { from, to, insert },
      range: EditorSelection.cursor(from + insert.length - 1), // inside the parens
    };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

// ---------------------------------------------------------------------------
// Mod-Enter — create/toggle to-do (EDITOR-STUDY §5, Jon Bo's Obsidian
// pro-tip). Multi-line selections apply per line — the same "every touched
// line" idiom as live-preview's reveal rule.

function touchedLines(state: EditorState) {
  const byNumber = new Map<number, ReturnType<EditorState["doc"]["line"]>>();
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let l = startLine; l <= endLine; l++) byNumber.set(l, state.doc.line(l));
  }
  return [...byNumber.values()].sort((a, b) => a.from - b.from);
}

function enclosingListItem(state: EditorState, pos: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
  for (; node; node = node.parent) {
    if (node.name === "ListItem") return node;
  }
  return null;
}

function todoChangeForLine(
  state: EditorState,
  line: ReturnType<EditorState["doc"]["line"]>,
  listItem: SyntaxNode | null,
): ChangeSpec {
  const doc = state.doc;
  // GFM tree shape (mirrors live-preview.ts's Task case): ListMark ("-") and
  // Task (whose first child is TaskMarker, "[ ]"/"[x]") are SIBLINGS under
  // ListItem, not parent/child — so an already-task line is found via the
  // ListItem's own Task child, not by walking up from inside it.
  const task = listItem?.getChild("Task");
  const taskMarker = task?.getChild("TaskMarker");
  if (taskMarker) {
    const isChecked = /[xX]/.test(doc.sliceString(taskMarker.from + 1, taskMarker.from + 2));
    return { from: taskMarker.from + 1, to: taskMarker.from + 2, insert: isChecked ? " " : "x" };
  }
  const listMark = listItem?.getChild("ListMark");
  if (listMark) {
    let insertAt = listMark.to;
    if (doc.sliceString(insertAt, insertAt + 1) === " ") insertAt += 1;
    return { from: insertAt, to: insertAt, insert: "[ ] " };
  }
  // Plain prose line — turn it into a brand-new to-do item, keeping any
  // existing leading whitespace before the new marker.
  const leading = /^\s*/.exec(line.text)?.[0] ?? "";
  const at = line.from + leading.length;
  return { from: at, to: at, insert: "- [ ] " };
}

export const toggleTodo: StateCommand = ({ state, dispatch }) => {
  const changes: ChangeSpec[] = [];
  // CommonMark lazy continuation: a marker-less line right after list
  // content (no blank line between) stays part of the SAME ListItem as a
  // multi-line paragraph — so a multi-line selection spanning both can
  // resolve two DIFFERENT touched lines to the ONE underlying ListItem node.
  // Dedup by node identity so that item gets exactly one change, not two
  // colliding writes to the same TaskMarker/ListMark position.
  const handledListItems = new Set<SyntaxNode>();
  for (const line of touchedLines(state)) {
    if (line.text.trim() === "") continue; // nothing to convert on a blank line
    const listItem = enclosingListItem(state, line.from);
    if (listItem) {
      if (handledListItems.has(listItem)) continue;
      handledListItems.add(listItem);
    }
    changes.push(todoChangeForLine(state, line, listItem));
  }
  if (changes.length === 0) return true; // selection was blank line(s) only — handled, no-op
  dispatch(state.update({ changes }, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

// ---------------------------------------------------------------------------
// The selection toolbar's button list — one source of truth for id/label/
// glyph/command so the toolbar never re-describes what these commands do.

export interface FormatCommandDescriptor {
  id: string;
  label: string;
  glyph: string;
  run: StateCommand;
}

export const FORMAT_COMMANDS: readonly FormatCommandDescriptor[] = [
  { id: "bold", label: "Bold", glyph: "B", run: toggleBold },
  { id: "italic", label: "Italic", glyph: "I", run: toggleItalic },
  { id: "strikethrough", label: "Strikethrough", glyph: "S", run: toggleStrikethrough },
  { id: "code", label: "Code", glyph: "<>", run: toggleCode },
  { id: "link", label: "Link", glyph: "🔗", run: wrapLink },
];
