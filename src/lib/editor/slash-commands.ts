import type { EditorView } from "@codemirror/view";

// The "/"-command menu's vocabulary (EDITOR-RESEARCH.md §4, v1 set). Every
// `apply()` is a direct buffer edit — literal markdown characters written
// into the doc, the same primitive `CodeMirrorEditorHandle.insertAtCursor`
// already uses for uploads — never a structured object that gets serialized
// afterward. That's what keeps the editor "markdown underneath": there's
// only ever one representation of the note, so there's nothing for a
// second implementation to drift out of sync with.
export interface SlashCommand {
  id: string;
  label: string;
  hint: string;
  // Extra terms `matchesQuery` checks beyond the label itself.
  keywords: string[];
  // `from`/`to` bracket the "/query" text being replaced (the query itself
  // was already consumed by `matchSlashTrigger` — this is just the commit
  // step). `onRequestAttachment` is read only by the image command; every
  // other command ignores its third argument.
  apply(view: EditorView, from: number, to: number, onRequestAttachment?: () => void): void;
}

function replaceWithCursor(
  view: EditorView,
  from: number,
  to: number,
  insert: string,
  cursorOffset: number,
) {
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + cursorOffset },
  });
  view.focus();
}

// Most commands are "delete the /query, type this prefix, leave the cursor
// right after it" — a heading marker, a list marker, a blockquote marker.
function prefixCommand(
  id: string,
  label: string,
  hint: string,
  keywords: string[],
  prefix: string,
): SlashCommand {
  return {
    id,
    label,
    hint,
    keywords,
    apply(view, from, to) {
      replaceWithCursor(view, from, to, prefix, prefix.length);
    },
  };
}

export const SLASH_COMMANDS: SlashCommand[] = [
  prefixCommand("h1", "Heading 1", "Big section heading", ["h1", "heading1", "title"], "# "),
  prefixCommand(
    "h2",
    "Heading 2",
    "Medium section heading",
    ["h2", "heading2", "subheading"],
    "## ",
  ),
  prefixCommand("h3", "Heading 3", "Small section heading", ["h3", "heading3"], "### "),
  prefixCommand(
    "bulleted-list",
    "Bulleted list",
    "Simple bullet point",
    ["bullet", "list", "ul"],
    "- ",
  ),
  prefixCommand(
    "numbered-list",
    "Numbered list",
    "List with numbers",
    ["number", "numbered", "ol"],
    "1. ",
  ),
  prefixCommand("todo", "To-do", "Checkbox task item", ["todo", "task", "checkbox"], "- [ ] "),
  prefixCommand("quote", "Quote", "Blockquote", ["quote", "blockquote"], "> "),
  {
    id: "code",
    label: "Code block",
    hint: "Fenced code block",
    keywords: ["code", "fence", "snippet"],
    apply(view, from, to) {
      // Cursor lands on the blank line between the fences, ready to type.
      replaceWithCursor(view, from, to, "```\n\n```", 4);
    },
  },
  {
    id: "divider",
    label: "Divider",
    hint: "Horizontal rule",
    keywords: ["divider", "hr", "rule", "separator"],
    apply(view, from, to) {
      // A bare "---" immediately under a line of text isn't just a divider
      // to CommonMark — it's a Setext H2 underline ("Heading\n---" renders
      // as <h2>Heading</h2>). Pad with a blank line on either side that
      // doesn't already have one, so the divider can't be reinterpreted.
      const { state } = view;
      const line = state.doc.lineAt(from);
      const prevLine = line.number > 1 ? state.doc.line(line.number - 1) : null;
      const nextLine = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
      const needsLeadingBlank = prevLine !== null && prevLine.text.trim() !== "";
      const nextLineHasContent = nextLine !== null && nextLine.text.trim() !== "";
      const atEnd = nextLine === null;
      // A "\n" right after "---" is only ours to add when nothing already
      // follows it: if there IS a next line (blank or not), the untouched
      // remainder past `to` already starts with the original line break
      // that separated the divider's line from it — inserting a second one
      // here would double the blank-line pad (see the trailing-content
      // case below).
      const insert = `${needsLeadingBlank ? "\n" : ""}---${nextLineHasContent ? "\n" : ""}${atEnd ? "\n" : ""}`;
      // Cursor ALWAYS lands on the line after the divider, never appended
      // straight onto "---" (that would read "---text" the instant the
      // user keeps typing). When our own insert supplied the separating
      // "\n" (padding a real next line, or at EOF), landing right after it
      // is enough. When it didn't (the next line was already blank), that
      // separator lives in the remainder just past `to` — step one more
      // character into it so the cursor sits unambiguously on that
      // pre-existing blank line rather than the boundary CM still
      // attributes to the divider's own line.
      const cursorOffset = insert.length + (nextLineHasContent || atEnd ? 0 : 1);
      replaceWithCursor(view, from, to, insert, cursorOffset);
    },
  },
  {
    id: "image",
    label: "Image / attachment",
    hint: "Upload a file",
    keywords: ["image", "attachment", "file", "upload", "photo", "picture"],
    apply(view, from, to, onRequestAttachment) {
      // Just clear the "/query" text — the upload flow writes its own
      // markdown via CodeMirrorEditorHandle.insertAtCursor once a file
      // lands (useAttachmentUploader's onInsert), same path a paste or
      // drop already takes. No duplicate upload logic here.
      replaceWithCursor(view, from, to, "", 0);
      onRequestAttachment?.();
    },
  },
];

// Does the current line, sliced to the cursor, look like an active "/"
// trigger? `/` must open at the start of a line or after only whitespace —
// never mid-word ("and/or" must never open the menu). `query` is whatever
// word-characters follow the "/" so far, used to filter the list live.
export function matchSlashTrigger(
  lineTextBeforeCursor: string,
): { leadingWhitespace: string; query: string } | null {
  // Known edge, deliberately deferred: 4+ leading spaces is a CommonMark
  // indented code block, where "/" isn't really "starting a line" in the
  // markdown sense — this regex still opens the menu there. Left alone
  // until the live-preview phase, which is what actually needs to reason
  // about block-type context per line.
  const match = /^(\s*)\/(\w*)$/.exec(lineTextBeforeCursor);
  if (!match) return null;
  const [, leadingWhitespace, query] = match;
  return { leadingWhitespace, query };
}

// Empty query matches everything (the menu right after typing bare "/").
// Otherwise: does the label contain it, or does any keyword start with it?
export function matchesQuery(command: SlashCommand, query: string): boolean {
  if (query === "") return true;
  const q = query.toLowerCase();
  if (command.label.toLowerCase().includes(q)) return true;
  return command.keywords.some((k) => k.startsWith(q));
}
