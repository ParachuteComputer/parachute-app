// The one-line preview under a note's title in a list (NoteRow, NoteCard).
//
// The vault's lean list shape carries `preview`: the raw markdown body,
// whitespace-collapsed and cut at 120 code points (parachute-vault core
// `toNoteIndex`). Rendered as-is it shows syntax — "# Getting Started This is
// the **start-here guide**…" — and repeats the title, which is that body's
// first line. This turns it into the plain words a reader expects: the
// title's line dropped, markdown markers removed, the text kept.
//
// Presentation only. The body is collapsed to one line before it reaches us,
// so block syntax can only be recognised at the start or after a space; a
// marker that can't be told from prose (a "-" bullet mid-line) stays.

export function plainPreview(
  preview: string | null | undefined,
  title?: string | null,
): string | null {
  if (!preview) return null;
  let text = preview.trim().replace(/^#{1,6}\s+/, "");
  // The title is the body's first meaningful line, so the preview opens with
  // it. Drop it only on a whole-word match, so "Plan" doesn't cut "Planning".
  if (title && text.startsWith(title) && /^(\s|$)/.test(text.slice(title.length))) {
    text = text.slice(title.length);
  }
  text = text
    // Embeds (`![[audio.webm]]`) are attachments, not words.
    .replace(/!\[\[[^\]]*\]\]/g, "")
    // Wikilinks: the alias when there is one, else the target.
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    // Images and links keep their text; the URL may be cut off by the
    // 120-point limit, so the closing paren is optional.
    .replace(/!?\[([^\]]*)\]\([^)]*\)?/g, "$1")
    // Headings, quotes, list and task markers at the start of a former line.
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/^(?:>\s*)+/, "")
    .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/(^|\s)\[[ xX]\]\s+/g, "$1")
    // Code fences and inline code.
    .replace(/```\S*/g, "")
    .replace(/`([^`]*)`/g, "$1")
    // Bold, italic, strikethrough. Underscores only at word edges, so
    // snake_case survives; a bold cut open by the limit loses its marker.
    .replace(/(\*\*|__|~~)(?=\S)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*]+?)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w])_(?=\S)([^_]+?)_(?!\w)/g, "$1$2")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}
