import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:css|ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("Tailwind custom-property syntax", () => {
  it("contains no bare custom property in arbitrary-value brackets", () => {
    // Tailwind scans source text, including comments and tests. Construct the
    // forbidden token so this regression test cannot flag its own source.
    const forbidden = `[${"--"}`;
    const offenders = [...sourceFiles("src"), "STYLE.md"].filter((path) =>
      readFileSync(path, "utf8").includes(forbidden),
    );

    expect(offenders).toEqual([]);
  });
});
