import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BARE_CUSTOM_PROPERTY_ARBITRARY_VALUE = new RegExp(String.raw`-\[${"--"}[A-Za-z0-9_-]+\]`);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:css|ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("Tailwind custom-property syntax", () => {
  it("recognizes utility-shaped bare properties without flagging decrement expressions", () => {
    expect(BARE_CUSTOM_PROPERTY_ARBITRARY_VALUE.test(`text-[${"--"}color-fg]`)).toBe(true);
    expect(BARE_CUSTOM_PROPERTY_ARBITRARY_VALUE.test("arr[--i]")).toBe(false);
  });

  it("limits Tailwind discovery to application inputs", () => {
    const tailwindEntry = readFileSync("src/styles/tailwind.css", "utf8");
    expect(tailwindEntry.match(/@import\s+"tailwindcss"[^;]+;/g)).toEqual([
      '@import "tailwindcss" source("../");',
    ]);
    expect(JSON.parse(readFileSync("biome.json", "utf8")).files.ignore).toContain(
      "src/styles/tailwind.css",
    );
  });

  it("contains no bare custom property in scanned application inputs", () => {
    const offenders = sourceFiles("src").filter((path) =>
      BARE_CUSTOM_PROPERTY_ARBITRARY_VALUE.test(readFileSync(path, "utf8")),
    );

    expect(offenders).toEqual([]);
  });
});
