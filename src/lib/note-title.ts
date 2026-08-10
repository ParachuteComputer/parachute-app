import {
  PENDING_MARKER_RE,
  UNAVAILABLE_MARKER_RE,
  VOICE_LIMIT_MARKER_RE,
} from "@/lib/transcription-status";
import type { Note, NoteSummary } from "@/lib/vault/types";

// Human-readable title for a note, shared by every surface that renders a note
// in a list or header (Notes rows, the Recent timeline, QuickSwitch results).
// The mono path stays as dim metadata beside the title, never the headline —
// this helper is what makes the headline human.
//
// The title IS the first meaningful content line (one leading heading marker
// stripped, frontmatter skipped) — the vault's `displayTitle` model (ratified
// 2026-07-17; parachute-vault core `computeDisplayTitle`). `firstLineTitle`
// below is the app's byte-for-byte mirror of that derivation, so the editor
// (its in-place first-line decoration), the read view (this derivation over
// full content), and the list (the vault's wire `displayTitle`) can't disagree
// about which line is the title. Transcription-status markers and bare
// attachment embeds are not meaningful titles while a voice note is pending
// or has no transcript yet.
//
// Resolution order:
//   1. the first meaningful line of content (one leading `#{1,6}` marker
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

/**
 * True when a derived content title is just the note's storage identity.
 * These values remain valid path/id fallbacks, but must not be promoted as a
 * human title when content happens to repeat them verbatim.
 */
export function isRawPathOrId(text: string, note: { id: string; path?: string }): boolean {
  if (text === note.id) return true;
  if (!note.path) return false;
  return text === note.path || text === pathLeaf(note.path);
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
  // canonical first-meaningful-line derivation) — prefer it so the list agrees
  // with the vault by construction, without paying to fetch full content per
  // row. A null/undefined or meaningless wire value means "no title yet";
  // older or in-flight vault data can still carry a placeholder marker here,
  // so it must fall through just like a missing value.
  const wire = (note as { displayTitle?: string | null }).displayTitle;
  if (
    typeof wire === "string" &&
    wire.length > 0 &&
    !isMeaninglessTitleCandidate(wire) &&
    !isRawPathOrId(wire, note)
  ) {
    return { kind: "title", text: wire };
  }
  // `wire === null` is the vault saying "no first-line title" and
  // `wire === undefined` means the field was not sent (a full-content fetch or
  // a pre-`displayTitle` vault). A blank, placeholder, or raw-identity wire
  // value is the same display-side "no title yet" state, so derive from content
  // whenever it is present before falling through to the path/timestamp voice.
  const content = (note as { content?: string }).content;
  if (typeof content === "string") {
    const fromContent = firstLineTitle(content);
    if (fromContent && !isRawPathOrId(fromContent, note)) {
      return { kind: "title", text: fromContent };
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

// The transcription-status module owns the marker vocabulary. Anchor its
// regexes here because title derivation skips a marker only when the whole
// candidate line is that marker, never when marker text appears in prose.
const TRANSCRIPTION_PLACEHOLDER_RE = new RegExp(
  `^(?:${PENDING_MARKER_RE.source}|${UNAVAILABLE_MARKER_RE.source}|${VOICE_LIMIT_MARKER_RE.source})$`,
);
// Voice captures write wiki embeds; imported/storage-rewritten attachments can
// arrive as ordinary Markdown image embeds. Either syntax alone is not a
// meaningful title until some real note text exists.
const BARE_ATTACHMENT_RE = /^(?:!\[\[[^\n]+\]\]|!\[[^\n]*\]\([^\n]*\))$/;

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

function isMeaninglessTitleCandidate(text: string): boolean {
  const candidate = text.trim();
  return (
    candidate === "" ||
    TRANSCRIPTION_PLACEHOLDER_RE.test(candidate) ||
    BARE_ATTACHMENT_RE.test(candidate)
  );
}

// The app's mirror of the vault's `computeDisplayTitle`: the first meaningful
// content line (after any leading frontmatter), one leading `#{1,6}` marker and
// its trailing whitespace stripped, truncated to DISPLAY_TITLE_MAX_LEN code
// points. `null` when there's no meaningful line (empty / whitespace-only /
// frontmatter-only / bare-marker-only / transcription-placeholder-only /
// attachment-only note) — callers decide the fallback voice (path/timestamp).
export function firstLineTitle(content: string | null | undefined): string | null {
  if (!content) return null;
  const lines = content.split("\n");
  for (let i = bodyStartLine(lines); i < lines.length; i++) {
    const stripped = titleTextOf(lines[i]!);
    if (isMeaninglessTitleCandidate(stripped)) continue;
    // Code-point iteration so a truncation can't split a surrogate pair.
    const codePoints = Array.from(stripped);
    return codePoints.length > DISPLAY_TITLE_MAX_LEN
      ? codePoints.slice(0, DISPLAY_TITLE_MAX_LEN).join("")
      : stripped;
  }
  return null;
}

// Remove the first meaningful content line — the exact line `firstLineTitle`
// lifts into a page header — plus the blank / bare-marker lines that preceded
// it and the blank lines that trailed it, so a read view that promotes the
// first line to its title doesn't render that line twice. The leading-skip
// predicate is `isMeaninglessTitleCandidate(titleTextOf(...))` (NOT a raw trim)
// so it lands on the same line `firstLineTitle` chose: a bare `#`,
// transcription marker, or attachment embed before real content is skipped
// here too, rather than removed alone and leaving the title text in the body.
// Any leading frontmatter is preserved but skipped when locating the title
// line. Returns `content` unchanged when there's no title line to lift (empty /
// whitespace / bare-marker-only / placeholder-only / attachment-only /
// frontmatter-only note).
export function stripFirstTitleLine(content: string): string {
  const lines = content.split("\n");
  const start = bodyStartLine(lines);
  let i = start;
  while (i < lines.length && isMeaninglessTitleCandidate(titleTextOf(lines[i]!))) i++;
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
