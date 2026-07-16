import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { SLASH_COMMANDS, matchSlashTrigger, matchesQuery } from "./slash-commands";

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
