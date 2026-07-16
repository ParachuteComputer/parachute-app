import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// Two mount points, one component: NoteRow mounts the default (compact)
// variant beside its relative-time stamp; NoteView's MetadataPanel mounts
// "detail" after the metadata `<dl>`. describeProvenance's OWN logic (the
// via-label mapping, the differ rule) is covered in note-provenance.test.ts —
// these assert what actually lands in the DOM at each mount point.

describe("ProvenanceBadge — NoteRow's mount point (compact, the default variant)", () => {
  it("renders nothing for a note with no attribution (legacy record) — no 'unknown' noise", () => {
    const { container } = render(<ProvenanceBadge note={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the one short fragment for a created-only note", () => {
    render(<ProvenanceBadge note={{ createdBy: "user:aaron", createdVia: "mcp" }} />);
    expect(screen.getByText("via MCP")).toBeInTheDocument();
  });

  it("renders both sides, compactly, when created/updated differ", () => {
    render(
      <ProvenanceBadge
        note={{
          createdBy: "user:aaron",
          createdVia: "mcp",
          lastUpdatedBy: "agent:writer-1",
          lastUpdatedVia: "api",
        }}
      />,
    );
    expect(screen.getByText("created via MCP · updated via API")).toBeInTheDocument();
  });

  it("keeps the raw principal/channel values reachable via the title attribute, never as visible text", () => {
    render(
      <ProvenanceBadge
        note={{
          createdBy: "user:aaron",
          createdVia: "mcp",
          lastUpdatedBy: "agent:writer-1",
          lastUpdatedVia: "api",
        }}
      />,
    );
    const badge = screen.getByText("created via MCP · updated via API");
    expect(badge).toHaveAttribute(
      "title",
      "createdBy: user:aaron · createdVia: mcp · lastUpdatedBy: agent:writer-1 · lastUpdatedVia: api",
    );
    expect(badge.textContent).not.toContain("user:aaron");
  });
});

describe("ProvenanceBadge — NoteView's mount point (detail variant)", () => {
  it("renders nothing for a note with no attribution", () => {
    const { container } = render(<ProvenanceBadge note={{}} variant="detail" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("created-only: shows just the created line, no empty 'updated' line", () => {
    render(
      <ProvenanceBadge note={{ createdBy: "user:aaron", createdVia: "mcp" }} variant="detail" />,
    );
    expect(screen.getByText("created via MCP")).toBeInTheDocument();
    expect(screen.queryByText(/^updated /)).not.toBeInTheDocument();
  });

  it("created+updated differ: shows the fuller pair, one line each", () => {
    render(
      <ProvenanceBadge
        note={{
          createdBy: "user:aaron",
          createdVia: "mcp",
          lastUpdatedBy: "agent:writer-1",
          lastUpdatedVia: "api",
        }}
        variant="detail"
      />,
    );
    expect(screen.getByText("created via MCP")).toBeInTheDocument();
    expect(screen.getByText("updated via API")).toBeInTheDocument();
  });

  it("same principal re-editing: suppresses the redundant 'updated' line", () => {
    render(
      <ProvenanceBadge
        note={{
          createdBy: "user:aaron",
          createdVia: "mcp",
          lastUpdatedBy: "user:aaron",
          lastUpdatedVia: "mcp",
        }}
        variant="detail"
      />,
    );
    expect(screen.getByText("created via MCP")).toBeInTheDocument();
    expect(screen.queryByText(/^updated /)).not.toBeInTheDocument();
  });
});
