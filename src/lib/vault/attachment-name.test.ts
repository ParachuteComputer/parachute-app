import { describe, expect, it } from "vitest";
import { attachmentName } from "./attachment-name";

describe("attachmentName", () => {
  const stored = { id: "a1", path: "2026-11-25/1795635230689-d9bf96f7.csv" };
  it("names a file by the name it was sent with, not its server-made path", () => {
    expect(attachmentName({ ...stored, metadata: { original_name: "seed-inventory.csv" } })).toBe(
      "seed-inventory.csv",
    );
  });
  it("prefers a filename the door sends, and never shows a folder from the original name", () => {
    expect(
      attachmentName({ ...stored, filename: "a.png", metadata: { original_name: "b.png" } }),
    ).toBe("a.png");
    expect(
      attachmentName({ ...stored, metadata: { original_name: "C:\\Users\\sam\\seeds.csv" } }),
    ).toBe("seeds.csv");
  });
  it("falls back to the path's last segment, then the id", () => {
    expect(attachmentName({ ...stored, metadata: { original_name: 42 } })).toBe(
      "1795635230689-d9bf96f7.csv",
    );
    expect(attachmentName({ id: "a2" })).toBe("a2");
  });
});
