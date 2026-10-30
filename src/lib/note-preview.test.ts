import { plainPreview } from "@/lib/note-preview";
import { describe, expect, it } from "vitest";

// The vault's lean `preview` is the raw body, whitespace-collapsed to one line
// and cut at 120 code points. These inputs are in that shape.

describe("plainPreview", () => {
  it("drops the title line it opens with, and the heading marker", () => {
    expect(
      plainPreview(
        "# Getting Started This is the **start-here guide** for this vault",
        "Getting Started",
      ),
    ).toBe("This is the start-here guide for this vault");
  });

  it("drops a plain first-line title too, and returns null when that was all", () => {
    expect(plainPreview("Buy milk and eggs Also bread", "Buy milk and eggs")).toBe("Also bread");
    expect(plainPreview("Buy milk and eggs", "Buy milk and eggs")).toBeNull();
  });

  it("keeps the text when the title is only a word prefix, or doesn't match", () => {
    expect(plainPreview("Planning the week ahead", "Plan")).toBe("Planning the week ahead");
    expect(plainPreview("Something else entirely", "Title")).toBe("Something else entirely");
    expect(plainPreview("No title given")).toBe("No title given");
  });

  it("removes emphasis markers, keeps snake_case and lone asterisks", () => {
    expect(plainPreview("a **bold** and *italic* and _under_ and ~~gone~~ word")).toBe(
      "a bold and italic and under and gone word",
    );
    expect(plainPreview("set my_var_name to 2 * 3")).toBe("set my_var_name to 2 * 3");
  });

  it("keeps link and image text, drops URLs, even when the URL was cut off", () => {
    expect(plainPreview("see [the docs](https://x.dev/a) and ![a cat](cat.png)")).toBe(
      "see the docs and a cat",
    );
    expect(plainPreview("read [this page](https://example.com/very/lo")).toBe("read this page");
  });

  it("wikilinks show their alias or target; attachment embeds go", () => {
    expect(plainPreview("ask [[Aaron]] about [[people/sam|Sam]] ![[audio.webm]] ok")).toBe(
      "ask Aaron about Sam ok",
    );
  });

  it("strips later heading markers, leading list/quote markers, task boxes and code ticks", () => {
    expect(plainPreview("Intro ## Part two more")).toBe("Intro Part two more");
    expect(plainPreview("- [ ] call mom - [x] pay rent")).toBe("call mom - pay rent");
    expect(plainPreview("> quoted line")).toBe("quoted line");
    expect(plainPreview("run `bun test` now ```ts const a = 1")).toBe(
      "run bun test now const a = 1",
    );
  });

  it("drops a bold marker left open by the 120-point cut", () => {
    expect(plainPreview("intro **how to onboard the per")).toBe("intro how to onboard the per");
  });

  it("returns null for nothing to show", () => {
    expect(plainPreview(undefined)).toBeNull();
    expect(plainPreview("")).toBeNull();
    expect(plainPreview("![[voice.webm]]")).toBeNull();
  });

  it("leaves hashtags alone (no space after #)", () => {
    expect(plainPreview("idea for #work later")).toBe("idea for #work later");
  });
});
