import type { Note, NoteSummary } from "@/lib/vault/types";

// Human-readable title for a note, shared by every surface that renders a note
// in a list or header (Notes rows, the Recent timeline, QuickSwitch results).
// The mono path stays as dim metadata beside the title, never the headline —
// this helper is what makes the headline human.
//
// The title IS the first non-empty content line (one leading heading marker
// stripped, frontmatter skipped) — the vault's `displayTitle` model (ratified
// 2026-07-17; parachute-vault core `computeDisplayTitle`). `firstLineTitle`
// below is the app's byte-for-byte mirror of that derivation, so the editor
// (its in-place first-line decoration), the read view (this derivation over
// full content), and the list (the vault's wire `displayTitle`) can't disagree
// about which line is the title.
//
// Resolution order:
//   1. the first non-empty line of content (one leading `#{1,6}` marker
//      stripped, any leading frontmatter skipped, 120-codepoint cap);
//   2. else the path leaf (last segment, `.md` stripped);
//   3. else the id.
//
// List rows and the timeline fetch notes WITHOUT content — but the vault sends
// a computed `displayTitle` on that lean shape, so `displayTitle()` prefers it
// (see below) rather than falling to the path. QuickSwitch loads content, so it
// derives from the first line (which also lets search match on a first-line
// title the path doesn't carry).

type TitleSource = Pick<Note, "id" | "path" | "content"> | NoteSummary;

export function noteTitle(note: TitleSource): string {
  const content = (note as { content?: string }).content;
  if (typeof content === "string") {
    const fromContent = firstLineTitle(content);
    if (fromContent) return fromContent;
  }
  if (note.path) {
    const leaf = pathLeaf(note.path);
    if (leaf) return leaf;
  }
  return note.id;
}

// The text of a leading ATX H1 (`# Heading`) when the FIRST non-blank line is
// one, else null. Deliberately strict-first-line so it stays in lockstep with
// `stripLeadingH1`: a header derived from `leadingH1` is exactly the line the
// body strips, so a note is never titled by an H1 that still renders in its
// body (a buried `# …` or one inside a fenced code block is not a title).
// A single `#` + whitespace only; `##`+ are lower headings, not the title.
export function leadingH1(content: string | undefined | null): string | null {
  if (!content) return null;
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length && lines[i]?.trim() === "") i++;
  const first = lines[i];
  if (first === undefined) return null;
  const m = first.match(/^#\s+(.+?)\s*$/);
  return m?.[1] ?? null;
}

// Remove a single leading H1 line (and the blank lines around it) so a note
// whose first line is `# Title` doesn't render the title twice when the title
// is promoted to a page header. Only touches a true leading H1.
export function stripLeadingH1(content: string): string {
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length && lines[i]?.trim() === "") i++;
  if (i < lines.length && /^#\s+\S/.test(lines[i] ?? "")) {
    lines.splice(0, i + 1);
    while (lines.length > 0 && lines[0]?.trim() === "") lines.shift();
    return lines.join("\n");
  }
  return content;
}

// Last path segment without its `.md` extension.
export function pathLeaf(path: string): string {
  const segments = path.split("/");
  const last = segments[segments.length - 1] ?? path;
  return last.replace(/\.md$/i, "");
}

// A note's title, distinguishing a GENUINE title (from content, or an
// operator-chosen path) from an untouched `quickPath()` default — a
// machine-generated timestamp that isn't a name yet. Callers that render
// titles in a list/header use this instead of `noteTitle()` so they can
// render the timestamp variant in metadata voice (muted, placeholder
// weight) rather than as a headline. Storage/paths/wire are untouched —
// this is presentation-only, the same resolution order as `noteTitle()`.
export type DisplayTitle = { kind: "title"; text: string } | { kind: "timestamp"; text: string };

// Matches `quickPath()`'s shape (`lib/capture/recorder.ts`):
// `Notes/YYYY/MM-DD/HH-MM-SS`, optionally leading-slashed and/or
// `.md`-suffixed. Anchored to the FULL path, not the leaf alone — the
// human-readable stamp needs the year/month/day the leaf doesn't carry.
const QUICK_PATH_RE = /^\/?Notes\/(\d{4})\/(\d{2})-(\d{2})\/(\d{2})-(\d{2})-(\d{2})(?:\.md)?$/i;

// The path-only half of `displayTitle()`'s resolution, exported separately so
// `NoteView` — which derives its own content title via `firstLineTitle` and
// strips that line from the body — can still share this one path-timestamp
// fallback rule rather than re-deriving it.
export function pathDisplayTitle(path: string): DisplayTitle {
  const m = path.match(QUICK_PATH_RE);
  if (m) {
    const [, yyyy, mm, dd, hh, mi] = m;
    // Local-time construction mirrors quickPath()'s own local getFullYear/
    // getMonth/… reads, so the digits round-trip to the same wall-clock
    // moment the note was captured at, not a UTC reinterpretation of them.
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi));
    if (!Number.isNaN(date.getTime())) {
      const day = date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
      const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      return { kind: "timestamp", text: `${day} · ${time}` };
    }
  }
  return { kind: "title", text: pathLeaf(path) };
}

export function displayTitle(note: TitleSource): DisplayTitle {
  // The lean list shape carries the vault's own computed `displayTitle` (the
  // canonical first-line derivation) — prefer it so the list agrees with the
  // vault by construction, without paying to fetch full content per row.
  const wire = (note as { displayTitle?: string | null }).displayTitle;
  if (typeof wire === "string" && wire.length > 0) return { kind: "title", text: wire };
  // `wire === null` is the vault saying "no first-line title" (empty note) —
  // fall through to the path/timestamp voice. `wire === undefined` means the
  // field wasn't sent (a full-content fetch, or a pre-`displayTitle` vault), so
  // derive from content when we have it — the same first-line rule the vault
  // itself applies.
  if (wire === undefined) {
    const content = (note as { content?: string }).content;
    if (typeof content === "string") {
      const fromContent = firstLineTitle(content);
      if (fromContent) return { kind: "title", text: fromContent };
    }
  }
  if (note.path) return pathDisplayTitle(note.path);
  return { kind: "title", text: note.id };
}

// Max code points in a first-line title, and the bounded scan for a leading
// frontmatter block's closing fence — both mirror parachute-vault core
// (`DISPLAY_TITLE_MAX_LEN` / `FRONTMATTER_SCAN_LINES` in `notes.ts`) so this
// derivation stays byte-for-byte aligned with the `displayTitle` the vault
// computes for the list shape.
const DISPLAY_TITLE_MAX_LEN = 120;
const FRONTMATTER_SCAN_LINES = 100;

// Index of the first line that counts as the start of the DOCUMENT body: after
// a leading, closed YAML frontmatter block when `content` opens with one, else
// 0. Normal ingestion strips frontmatter into metadata before a note is stored,
// so this only bites a raw MCP/REST create that pasted frontmatter-bearing
// text — but skipping it keeps the title off the `---` fence, matching the
// vault. An unterminated opening `---` falls back to scanning from line 0.
function bodyStartLine(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  const scanLimit = Math.min(lines.length, FRONTMATTER_SCAN_LINES);
  for (let i = 1; i < scanLimit; i++) {
    if (lines[i]?.trim() === "---") return i + 1;
  }
  return 0;
}

// A line's title text: its content with one leading `#{1,6}` marker + trailing
// whitespace stripped, trimmed. Empty when the line is blank OR a bare heading
// marker with no text (`#`, `## `). `firstLineTitle` and `stripFirstTitleLine`
// both use this to decide which leading lines to SKIP, so the two agree on the
// exact line that is the title — a bare marker line before real content is
// skipped by BOTH, never left behind as a body double of the promoted title.
function titleTextOf(line: string): string {
  return line.replace(/^#{1,6}\s*/, "").trim();
}

// The app's mirror of the vault's `computeDisplayTitle`: the first non-empty
// content line (after any leading frontmatter), one leading `#{1,6}` marker and
// its trailing whitespace stripped, truncated to DISPLAY_TITLE_MAX_LEN code
// points. `null` when there's no non-empty line (empty / whitespace-only /
// frontmatter-only / bare-marker-only note) — callers decide the fallback voice
// (path/timestamp).
export function firstLineTitle(content: string | null | undefined): string | null {
  if (!content) return null;
  const lines = content.split("\n");
  for (let i = bodyStartLine(lines); i < lines.length; i++) {
    const stripped = titleTextOf(lines[i]!);
    if (stripped === "") continue;
    // Code-point iteration so a truncation can't split a surrogate pair.
    const codePoints = Array.from(stripped);
    return codePoints.length > DISPLAY_TITLE_MAX_LEN
      ? codePoints.slice(0, DISPLAY_TITLE_MAX_LEN).join("")
      : stripped;
  }
  return null;
}

// Remove the first non-empty content line — the exact line `firstLineTitle`
// lifts into a page header — plus the blank / bare-marker lines that preceded
// it and the blank lines that trailed it, so a read view that promotes the
// first line to its title doesn't render that line twice. The leading-skip
// predicate is `titleTextOf` (NOT a raw trim) so it lands on the same line
// `firstLineTitle` chose: a bare `#` before real content is skipped here too,
// rather than removed alone and leaving the title text in the body. Any leading
// frontmatter is preserved but skipped when locating the title line. Returns
// `content` unchanged when there's no title line to lift (empty / whitespace /
// bare-marker-only / frontmatter-only note).
export function stripFirstTitleLine(content: string): string {
  const lines = content.split("\n");
  const start = bodyStartLine(lines);
  let i = start;
  while (i < lines.length && titleTextOf(lines[i]!) === "") i++;
  if (i >= lines.length) return content; // no title line to lift
  // Drop everything from the body start through the title line (any blank or
  // bare-marker lines that preceded it, then the line itself) plus the blanks
  // that trailed it, so the body opens cleanly on the next real content. The
  // trailing skip is a raw trim — a bare marker AFTER the title is real body
  // content (a heading), not part of the title region.
  let end = i + 1;
  while (end < lines.length && lines[end]!.trim() === "") end++;
  lines.splice(start, end - start);
  return lines.join("\n");
}
