import { describe, expect, it } from "vitest";
import {
  displayTitle,
  leadingH1,
  noteTitle,
  pathDisplayTitle,
  pathLeaf,
  stripLeadingH1,
} from "./note-title";

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

  it("truncates a very long first line with an ellipsis", () => {
    const long = "x".repeat(200);
    const title = noteTitle({ id: "a", content: long });
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith("…")).toBe(true);
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
