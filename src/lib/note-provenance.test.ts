import { describeProvenance } from "@/lib/note-provenance";
import { describe, expect, it } from "vitest";

// vault#298 write-attribution → display text. Factual-only: a channel
// mapped to a friendly noun, never a human-vs-AI guess; the principal
// (createdBy/lastUpdatedBy) never appears in the visible label, only in
// `raw` (the tooltip).

describe("describeProvenance", () => {
  it("returns null when there's no attribution at all (legacy record)", () => {
    expect(describeProvenance({})).toBeNull();
    expect(
      describeProvenance({
        createdBy: null,
        createdVia: null,
        lastUpdatedBy: null,
        lastUpdatedVia: null,
      }),
    ).toBeNull();
  });

  it("created-only: a fresh note that's never been updated by a different principal", () => {
    const parts = describeProvenance({ createdBy: "user:aaron", createdVia: "mcp" });
    expect(parts).not.toBeNull();
    expect(parts?.created).toBe("via MCP");
    expect(parts?.updated).toBeNull();
    expect(parts?.differs).toBe(false);
    expect(parts?.compact).toBe("via MCP");
  });

  it("same principal edits again via the same channel: still one fragment, not two", () => {
    const parts = describeProvenance({
      createdBy: "user:aaron",
      createdVia: "mcp",
      lastUpdatedBy: "user:aaron",
      lastUpdatedVia: "mcp",
    });
    expect(parts?.differs).toBe(false);
    expect(parts?.compact).toBe("via MCP");
  });

  it("created and updated by DIFFERENT principals: compact shows both sides", () => {
    const parts = describeProvenance({
      createdBy: "user:aaron",
      createdVia: "mcp",
      lastUpdatedBy: "agent:writer-1",
      lastUpdatedVia: "api",
    });
    expect(parts?.differs).toBe(true);
    expect(parts?.created).toBe("via MCP");
    expect(parts?.updated).toBe("via API");
    expect(parts?.compact).toBe("created via MCP · updated via API");
  });

  it("raw carries every present field, joined, for the tooltip — never shown as the label", () => {
    const parts = describeProvenance({
      createdBy: "user:aaron",
      createdVia: "mcp",
      lastUpdatedBy: "agent:writer-1",
      lastUpdatedVia: "api",
    });
    expect(parts?.raw).toBe(
      "createdBy: user:aaron · createdVia: mcp · lastUpdatedBy: agent:writer-1 · lastUpdatedVia: api",
    );
    expect(parts?.compact).not.toContain("user:aaron");
    expect(parts?.compact).not.toContain("agent:writer-1");
  });

  describe("friendly via-channel mapping (factual only, no human-vs-AI guess)", () => {
    it.each([
      ["mcp", "via MCP"],
      ["api", "via API"],
      ["cli", "via CLI"],
      ["operator", "via operator"],
      ["agent:writer-1", "via agent"],
      ["surface:notes", "via Notes"],
      ["some-future-channel", "via some-future-channel"],
    ])("createdVia %s → %s", (via, expected) => {
      const parts = describeProvenance({ createdVia: via });
      expect(parts?.compact).toBe(expected);
    });
  });
});
