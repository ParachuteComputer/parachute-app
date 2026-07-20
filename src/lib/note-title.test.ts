import { describe, expect, it } from "vitest";
import {
  displayTitle,
  firstLineTitle,
  leadingH1,
  noteTitle,
  pathDisplayTitle,
  pathLeaf,
  stripFirstTitleLine,
  stripLeadingH1,
} from "./note-title";

// The lean list shape carries a `displayTitle` (computed server-side) that the
// surface-client Note type doesn't declare — model that untyped wire field
// with a cast so the wire-preference path can be exercised.
function leanNote(fields: {
  id: string;
  path?: string;
  displayTitle: string | null;
}): Parameters<typeof displayTitle>[0] {
  return fields as unknown as Parameters<typeof displayTitle>[0];
}

describe("noteTitle", () => {
  it("prefers a leading H1 in the content", () => {
    expect(noteTitle({ id: "a", content: "# Meeting notes\n\nbody" })).toBe("Meeting notes");
  });

  it("uses the first prose line when the H1 is buried (consistent with the body strip)", () => {
    // Strict-first-line: a `# …` that isn't the leading line is NOT the title,
    // so NoteView never titles a note by a heading that still renders in-body.
    expect(noteTitle({ id: "a", content: "intro line\n\n# The heading\n\nmore" })).toBe(
      "intro line",
    );
  });

  it("uses the first non-empty line when there is no H1", () => {
    expect(noteTitle({ id: "a", content: "Hello world\n\nmore text" })).toBe("Hello world");
  });

  it("strips leading markdown heading hashes on the first-line fallback", () => {
    expect(noteTitle({ id: "a", content: "### Deep" })).toBe("Deep");
  });

  it("skips leading blank lines", () => {
    expect(noteTitle({ id: "a", content: "\n\n\nfirst real line" })).toBe("first real line");
  });

  it("truncates a very long first line to a hard 120-codepoint cap (matching the vault, no ellipsis)", () => {
    const long = "x".repeat(200);
    const title = noteTitle({ id: "a", content: long });
    expect(title).toHaveLength(120);
    expect(title.endsWith("…")).toBe(false);
  });

  it("falls back to the last path segment without .md", () => {
    expect(noteTitle({ id: "abc", path: "Canon/Aaron.md" })).toBe("Aaron");
    expect(noteTitle({ id: "abc", path: "notes/journal/day.md" })).toBe("day");
  });

  it("strips .md case-insensitively", () => {
    expect(noteTitle({ id: "abc", path: "Foo.MD" })).toBe("Foo");
  });

  it("falls back to id when there is nothing else", () => {
    expect(noteTitle({ id: "abc" })).toBe("abc");
  });

  it("prefers content over path when both exist", () => {
    expect(noteTitle({ id: "x", path: "Some/Path.md", content: "Content wins" })).toBe(
      "Content wins",
    );
  });
});

describe("leadingH1", () => {
  it("returns the H1 text when it's the leading line", () => {
    expect(leadingH1("# Title\n\nbody")).toBe("Title");
    expect(leadingH1("\n\n# Title\nbody")).toBe("Title");
  });

  it("returns null when the first non-blank line is prose (a buried H1 is not a title)", () => {
    expect(leadingH1("prose\n# Later")).toBeNull();
  });

  it("returns null when the leading line opens a fenced code block", () => {
    // A `# comment` inside a code fence must not become the title.
    expect(leadingH1("```\n# comment\n```")).toBeNull();
  });

  it("ignores h2+ headings", () => {
    expect(leadingH1("## Not a title")).toBeNull();
    expect(leadingH1("### Deep")).toBeNull();
  });

  it("returns null for empty or missing content", () => {
    expect(leadingH1("")).toBeNull();
    expect(leadingH1(undefined)).toBeNull();
    expect(leadingH1(null)).toBeNull();
  });
});

describe("stripLeadingH1", () => {
  it("removes a leading H1 and the blank lines around it", () => {
    expect(stripLeadingH1("# Title\n\nHello.")).toBe("Hello.");
  });

  it("removes a leading H1 preceded by blank lines", () => {
    expect(stripLeadingH1("\n\n# Title\nbody")).toBe("body");
  });

  it("leaves content without a leading H1 untouched", () => {
    expect(stripLeadingH1("Just prose.\n# Later heading")).toBe("Just prose.\n# Later heading");
    expect(stripLeadingH1("## Subheading first")).toBe("## Subheading first");
  });
});

describe("firstLineTitle (mirror of the vault's computeDisplayTitle)", () => {
  it("returns the first non-empty line", () => {
    expect(firstLineTitle("Hello world\n\nmore")).toBe("Hello world");
  });

  it("strips one leading heading marker at any level", () => {
    expect(firstLineTitle("# Title\n\nbody")).toBe("Title");
    expect(firstLineTitle("### Deep\n\nbody")).toBe("Deep");
  });

  it("promotes a plain first line even when a heading is buried below", () => {
    expect(firstLineTitle("intro line\n\n# Buried\n\nmore")).toBe("intro line");
  });

  it("skips a leading bare heading marker line and titles by the next real line", () => {
    expect(firstLineTitle("#\nActual title\n\nbody")).toBe("Actual title");
    expect(firstLineTitle("## \nActual title")).toBe("Actual title");
  });

  it("skips leading blank lines", () => {
    expect(firstLineTitle("\n\n\nfirst real line")).toBe("first real line");
  });

  it("skips a leading YAML frontmatter block before deriving", () => {
    expect(firstLineTitle("---\ntitle: X\n---\n# Real Title\n\nbody")).toBe("Real Title");
  });

  it("treats an unterminated leading --- as ordinary content, not frontmatter", () => {
    expect(firstLineTitle("---\nnot frontmatter")).toBe("---");
  });

  it("truncates to a hard 120 code points, no ellipsis (matches the vault)", () => {
    const t = firstLineTitle("y".repeat(200));
    expect(t).toHaveLength(120);
    expect(t?.endsWith("…")).toBe(false);
  });

  it("returns null for empty, whitespace-only, or heading-marker-only content", () => {
    expect(firstLineTitle("")).toBeNull();
    expect(firstLineTitle("   \n\n\t")).toBeNull();
    expect(firstLineTitle("#\n##")).toBeNull();
    expect(firstLineTitle(undefined)).toBeNull();
    expect(firstLineTitle(null)).toBeNull();
  });
});

describe("stripFirstTitleLine", () => {
  it("removes a plain first line and the blank lines after it", () => {
    expect(stripFirstTitleLine("Groceries\n\n- milk\n- eggs")).toBe("- milk\n- eggs");
  });

  it("removes a leading heading line the same way", () => {
    expect(stripFirstTitleLine("# Title\n\nHello.")).toBe("Hello.");
  });

  it("lifts only the first line, leaving a buried heading in the body", () => {
    expect(stripFirstTitleLine("Some intro paragraph.\n\n# Buried Title\n\nMore body.")).toBe(
      "# Buried Title\n\nMore body.",
    );
  });

  it("skips a leading bare marker line so the promoted title isn't left in the body", () => {
    // `firstLineTitle` skips the bare `#` and titles by "Actual title"; the
    // strip must remove BOTH lines so the body doesn't double-render the title.
    expect(stripFirstTitleLine("#\nActual title\n\nbody")).toBe("body");
    expect(stripFirstTitleLine("#\nActual title")).toBe("");
  });

  it("removes leading blank lines that preceded the first line", () => {
    expect(stripFirstTitleLine("\n\nTitle\n\nbody")).toBe("body");
  });

  it("returns empty when the whole note is a single title line", () => {
    expect(stripFirstTitleLine("Just a title")).toBe("");
  });

  it("leaves an empty / whitespace-only note unchanged (nothing to lift)", () => {
    expect(stripFirstTitleLine("")).toBe("");
    expect(stripFirstTitleLine("   \n\n")).toBe("   \n\n");
  });

  it("preserves a leading frontmatter block, lifting the first body line", () => {
    expect(stripFirstTitleLine("---\ntitle: X\n---\n\n# Real\n\nbody")).toBe(
      "---\ntitle: X\n---\nbody",
    );
  });
});

describe("pathLeaf", () => {
  it("returns the last segment without .md", () => {
    expect(pathLeaf("a/b/c.md")).toBe("c");
    expect(pathLeaf("bare")).toBe("bare");
  });
});

describe("pathDisplayTitle", () => {
  it("renders a quickPath()-shaped path as a timestamp (metadata voice)", () => {
    const result = pathDisplayTitle("Notes/2026/07-16/22-10-48");
    expect(result.kind).toBe("timestamp");
    expect(result.text).toMatch(/July/i);
    expect(result.text).toMatch(/16/);
    expect(result.text).toMatch(/10:10/); // HH-MM (22-10) is 10:10 PM
    expect(result.text).toContain("·");
  });

  it("tolerates a leading slash and a .md suffix on the quickPath shape", () => {
    expect(pathDisplayTitle("/Notes/2026/07-16/22-10-48").kind).toBe("timestamp");
    expect(pathDisplayTitle("Notes/2026/07-16/22-10-48.md").kind).toBe("timestamp");
  });

  it("falls back to the plain path leaf for anything that isn't quickPath-shaped", () => {
    expect(pathDisplayTitle("Canon/Aaron.md")).toEqual({ kind: "title", text: "Aaron" });
    // Same folder, wrong depth/shape — still just a title, not a timestamp.
    expect(pathDisplayTitle("Notes/2026/07-16/not-a-time")).toEqual({
      kind: "title",
      text: "not-a-time",
    });
    expect(pathDisplayTitle("Memos/2026/07-16/22-10-48")).toEqual({
      kind: "title",
      text: "22-10-48",
    });
  });
});

describe("displayTitle", () => {
  it("prefers the vault's wire displayTitle (lean list shape) over the path", () => {
    // The lean list shape carries no content but a server-computed displayTitle
    // — the list must render THAT as the title, not fall to the quickPath stamp.
    expect(
      displayTitle(
        leanNote({
          id: "a",
          path: "Notes/2026/07-16/22-10-48",
          displayTitle: "Groceries for the week",
        }),
      ),
    ).toEqual({ kind: "title", text: "Groceries for the week" });
  });

  it("falls to the timestamp voice when the vault reports displayTitle: null (empty note)", () => {
    const result = displayTitle(
      leanNote({ id: "a", path: "Notes/2026/07-16/22-10-48", displayTitle: null }),
    );
    expect(result.kind).toBe("timestamp");
    expect(result.text).toMatch(/July 16/);
  });

  it("derives from content when no wire displayTitle was sent (full-shape fetch)", () => {
    expect(displayTitle({ id: "a", path: "Some/Path.md", content: "First line\n\nbody" })).toEqual({
      kind: "title",
      text: "First line",
    });
  });

  it("prefers content over the quickPath timestamp, same as noteTitle()", () => {
    expect(
      displayTitle({ id: "a", path: "Notes/2026/07-16/22-10-48", content: "# Real title" }),
    ).toEqual({ kind: "title", text: "Real title" });
  });

  it("renders an untouched quickPath() default as a timestamp when there's no content", () => {
    const result = displayTitle({ id: "a", path: "Notes/2026/07-16/22-10-48" });
    expect(result.kind).toBe("timestamp");
    expect(result.text).toMatch(/July 16/);
  });

  it("falls back to noteTitle()'s plain title behavior for a non-quickPath path", () => {
    expect(displayTitle({ id: "abc", path: "Canon/Aaron.md" })).toEqual({
      kind: "title",
      text: "Aaron",
    });
  });

  it("falls back to id when there is nothing else", () => {
    expect(displayTitle({ id: "abc" })).toEqual({ kind: "title", text: "abc" });
  });
});
