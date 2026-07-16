import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { SLASH_COMMANDS, matchSlashTrigger, matchesQuery } from "./slash-commands";

// N3 (from PR #33, closed now that the live-preview parser change put the
// syntax tree in play — see slash-commands.ts:153): a "/" inside a fenced or
// indented code block, or inline code, isn't "starting a line" in the
// markdown sense — it's a literal character in the code's content. Gate the
// completion SOURCE on block context here rather than teaching
// `matchSlashTrigger` about the tree (keeps that matcher pure-string,
// testable without an EditorState). Applies in both editor modes — the tree
// is available regardless of live-preview being on.
const CODE_CONTEXT_NODE_NAMES = new Set(["FencedCode", "CodeBlock", "InlineCode", "CodeText"]);

function isInCodeContext(state: EditorState, pos: number): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  for (; node; node = node.parent) {
    if (CODE_CONTEXT_NODE_NAMES.has(node.name)) return true;
  }
  return false;
}

// The `@codemirror/autocomplete` completion source for the "/"-command
// menu. Passed as the sole entry in `autocompletion({ override: [...] })`
// (CodeMirrorEditor.tsx) — `override` means this is the ONLY completion
// source in the editor, so it only has to worry about its own trigger.
//
// No `validFor` on the result: without one, CM re-queries this source on
// every relevant keystroke instead of reusing a stale option list, which is
// exactly what we want since `matchSlashTrigger` is cheap and always
// reflects the current line. `filter: false` because we've already done our
// own filtering — CM's built-in fuzzy filter would just re-sort against
// options it didn't choose.
export function createSlashCompletionSource(onRequestAttachment: () => void) {
  return function slashCompletionSource(context: CompletionContext): CompletionResult | null {
    const { state, pos } = context;
    const line = state.doc.lineAt(pos);
    const before = line.text.slice(0, pos - line.from);
    const trigger = matchSlashTrigger(before);
    if (!trigger) return null;
    if (isInCodeContext(state, pos)) return null;

    const options: Completion[] = SLASH_COMMANDS.filter((cmd) =>
      matchesQuery(cmd, trigger.query),
    ).map((cmd) => ({
      label: cmd.label,
      detail: cmd.hint,
      apply: (view: EditorView, _completion: Completion, applyFrom: number, applyTo: number) => {
        cmd.apply(view, applyFrom, applyTo, onRequestAttachment);
      },
    }));
    if (options.length === 0) return null;

    return {
      from: line.from + trigger.leadingWhitespace.length,
      to: pos,
      options,
      filter: false,
    };
  };
}
