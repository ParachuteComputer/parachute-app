/**
 * Pins the two properties bigvault is FOR:
 * - deterministic — same params, same plan, byte for byte (a screenshot diff
 *   against the sandbox is meaningless without this);
 * - realistically shaped at any size — power-law counts, slash families,
 *   schemas up to the ceiling, exact note totals.
 */

import { describe, expect, it } from "vitest";
import { DAY_MS, DEFAULT_PARAMS, backdateFor, buildNotePlan, buildTaxonomy } from "./taxonomy.ts";

const ANCHOR = Date.UTC(2026, 6, 25);

describe("buildTaxonomy", () => {
  it("is deterministic: same params, same taxonomy, byte for byte", () => {
    const a = buildTaxonomy(DEFAULT_PARAMS);
    const b = buildTaxonomy(DEFAULT_PARAMS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("defaults to the realistic shape: 47 tags, 2,600 notes, power law", () => {
    const tags = buildTaxonomy(DEFAULT_PARAMS);
    expect(tags).toHaveLength(47);
    expect(tags.reduce((a, t) => a + t.count, 0)).toBe(2600);

    // Power law: a heavy head, a long tail of one-note tags.
    const counts = tags.map((t) => t.count);
    expect(Math.max(...counts)).toBeGreaterThan(300);
    expect(counts.filter((c) => c === 1).length).toBeGreaterThanOrEqual(5);

    // Slash families: several prefixes with 2+ members.
    const families = new Map<string, number>();
    for (const t of tags) {
      const slash = t.name.indexOf("/");
      if (slash > 0) {
        const prefix = t.name.slice(0, slash);
        families.set(prefix, (families.get(prefix) ?? 0) + 1);
      }
    }
    const multi = [...families.values()].filter((n) => n >= 2);
    expect(multi.length).toBeGreaterThanOrEqual(4);

    // Schemas: the default share lands on the 9 curated schemas, 0–9 fields.
    const typed = tags.filter((t) => t.fields);
    expect(typed).toHaveLength(9);
    const widths = typed.map((t) => Object.keys(t.fields ?? {}).length);
    expect(Math.max(...widths)).toBe(9);
  });

  it("scales up: 500 unique tags, exactly 10,000 notes, still deterministic", () => {
    const params = { ...DEFAULT_PARAMS, tags: 500, notes: 10_000 };
    const tags = buildTaxonomy(params);
    expect(tags).toHaveLength(500);
    expect(new Set(tags.map((t) => t.name)).size).toBe(500);
    expect(tags.reduce((a, t) => a + t.count, 0)).toBe(10_000);
    expect(JSON.stringify(buildTaxonomy(params))).toBe(JSON.stringify(tags));
  });

  it("scales down: 10 tags, exactly 200 notes", () => {
    const tags = buildTaxonomy({ ...DEFAULT_PARAMS, tags: 10, notes: 200 });
    expect(tags).toHaveLength(10);
    expect(tags.reduce((a, t) => a + t.count, 0)).toBe(200);
  });

  it("gives every tag at least one note when notes < tags", () => {
    const tags = buildTaxonomy({ ...DEFAULT_PARAMS, tags: 50, notes: 10 });
    expect(tags.every((t) => t.count >= 1)).toBe(true);
  });

  it("honors schema-share at both extremes", () => {
    const none = buildTaxonomy({ ...DEFAULT_PARAMS, schemaShare: 0 });
    expect(none.every((t) => !t.fields)).toBe(true);

    const all = buildTaxonomy({ ...DEFAULT_PARAMS, schemaShare: 1 });
    expect(all.every((t) => t.fields)).toBe(true);
  });

  it("always includes one schema at exactly max-fields (the ceiling case)", () => {
    for (const maxFields of [3, 9, 20]) {
      const tags = buildTaxonomy({ ...DEFAULT_PARAMS, maxFields });
      const widths = tags.filter((t) => t.fields).map((t) => Object.keys(t.fields ?? {}).length);
      expect(Math.max(...widths)).toBe(maxFields);
      expect(widths.every((w) => w <= maxFields)).toBe(true);
    }
  });

  it("rejects nonsense params", () => {
    expect(() => buildTaxonomy({ ...DEFAULT_PARAMS, tags: 0 })).toThrow();
    expect(() => buildTaxonomy({ ...DEFAULT_PARAMS, notes: -5 })).toThrow();
    expect(() => buildTaxonomy({ ...DEFAULT_PARAMS, schemaShare: 1.5 })).toThrow();
    expect(() => buildTaxonomy({ ...DEFAULT_PARAMS, maxFields: 0 })).toThrow();
  });
});

describe("buildNotePlan", () => {
  const taxonomy = buildTaxonomy(DEFAULT_PARAMS);

  it("is deterministic and one job per planned note", () => {
    const a = buildNotePlan(taxonomy, DEFAULT_PARAMS.seed, ANCHOR);
    const b = buildNotePlan(taxonomy, DEFAULT_PARAMS.seed, ANCHOR);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toHaveLength(2600);
  });

  it("makes unique paths and cross-tags a small minority of notes", () => {
    const plan = buildNotePlan(taxonomy, DEFAULT_PARAMS.seed, ANCHOR);
    expect(new Set(plan.map((n) => n.path)).size).toBe(plan.length);
    const crossTagged = plan.filter((n) => n.tags.length > 1).length / plan.length;
    expect(crossTagged).toBeGreaterThan(0.03);
    expect(crossTagged).toBeLessThan(0.15);
  });

  it("fills metadata for schema-bearing tags (sparsely) and never for bare ones", () => {
    const plan = buildNotePlan(taxonomy, DEFAULT_PARAMS.seed, ANCHOR);
    const typedNames = new Set(taxonomy.filter((t) => t.fields).map((t) => t.name));
    const typedNotes = plan.filter((n) => typedNames.has(n.tags[0]));
    expect(typedNotes.filter((n) => n.metadata).length).toBeGreaterThan(typedNotes.length * 0.5);
    const bareNotes = plan.filter((n) => !typedNames.has(n.tags[0]));
    expect(bareNotes.every((n) => n.metadata === undefined)).toBe(true);
  });
});

describe("backdateFor", () => {
  it("is deterministic per path and independent of call order", () => {
    const a = backdateFor("Seed/journal/0001 A note", ANCHOR);
    backdateFor("Seed/task/0002 Another", ANCHOR);
    const b = backdateFor("Seed/journal/0001 A note", ANCHOR);
    expect(b).toEqual(a);
  });

  it("keeps created <= updated <= anchor, within the two-year window", () => {
    for (let i = 0; i < 500; i++) {
      const { createdAtMs, updatedAtMs } = backdateFor(`Seed/tag/${i} note`, ANCHOR);
      expect(createdAtMs).toBeLessThanOrEqual(updatedAtMs);
      expect(updatedAtMs).toBeLessThanOrEqual(ANCHOR);
      expect(ANCHOR - updatedAtMs).toBeLessThanOrEqual(731 * DAY_MS);
    }
  });

  it("clusters touches toward the present (recency weighting)", () => {
    const ages = Array.from(
      { length: 1000 },
      (_, i) => ANCHOR - backdateFor(`Seed/x/${i}`, ANCHOR).updatedAtMs,
    );
    const recent = ages.filter((a) => a < 90 * DAY_MS).length;
    expect(recent).toBeGreaterThan(250); // ~a third within 3 months
  });
});
