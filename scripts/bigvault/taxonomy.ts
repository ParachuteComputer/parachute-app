/**
 * The synthetic taxonomy — a lived-in vault's shape, generated on demand.
 *
 * Why this exists: every walkthrough vault this repo ever tested against had
 * ~15 notes and 3–4 tags, while a real vault runs ~47 tags and thousands of
 * notes. Two shipped bugs (the blind filter panel, the bottomless tag page)
 * were invisible at toy scale. The unevenness here is the point: a few tags
 * on hundreds of notes, a long tail on one or two, slash-namespaced families,
 * schemas from zero fields up to a deliberate ceiling case. Every name and
 * sentence is invented — nothing comes from any real vault.
 *
 * Pure functions only, no I/O: `bigvault.ts` turns the plan into a vault, and
 * the tests pin determinism — same params, same plan, byte for byte.
 */

export type FieldType = "string" | "date" | "number" | "boolean";
export interface FieldSpec {
  type: FieldType;
  enum?: string[];
}
export interface TagSpec {
  name: string;
  count: number;
  fields?: Record<string, FieldSpec>;
}
export interface TaxonomyParams {
  /** How many tags to create. ≤47 truncates the curated head; more generates a tail. */
  tags: number;
  /** Total notes, spread power-law across the tags (every tag gets at least one). */
  notes: number;
  /** Fraction of tags carrying a field schema (0–1). */
  schemaShare: number;
  /** Ceiling schema size; exactly one tag always carries it (unless schemaShare is 0). */
  maxFields: number;
  /** PRNG seed — same seed, same vault. */
  seed: number;
}

/** The realistic defaults — the shape the July 2026 filter-UX study ran at. */
export const DEFAULT_PARAMS: TaxonomyParams = {
  tags: 47,
  notes: 2600,
  schemaShare: 0.19, // → exactly the 9 curated schemas at 47 tags
  maxFields: 9,
  seed: 424242,
};

export const DAY_MS = 24 * 3600_000;

// --- Deterministic PRNG (mulberry32) ----------------------------------------
// Math.imul keeps every step in exact 32-bit space, so the stream is identical
// on every engine. (A naive LCG's multiply exceeds 2^53 and rounds.)
export function makeRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickWith = <T>(rand: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rand() * arr.length)];

function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// --- The curated head: 47 tags, weights shaped like a real vault ------------
// Capture streams and journaling dominate; five slash families; nine schemas
// from one field to nine ("project" is the ceiling case).
const CURATED: ReadonlyArray<[string, number, Record<string, FieldSpec>?]> = [
  ["capture/voice", 620],
  ["journal", 430],
  ["capture/text", 300],
  ["life/day", 260],
  [
    "task",
    170,
    { status: { type: "string", enum: ["todo", "doing", "done"] }, due: { type: "date" } },
  ],
  [
    "work/meeting",
    140,
    { held_on: { type: "date" }, with: { type: "string" }, followup: { type: "boolean" } },
  ],
  ["idea", 95],
  ["quote", 80],
  ["dream", 60],
  [
    "workout",
    55,
    {
      kind: { type: "string", enum: ["run", "swim", "climb", "yoga"] },
      minutes: { type: "number" },
    },
  ],
  [
    "media/book",
    48,
    {
      author: { type: "string" },
      status: { type: "string", enum: ["reading", "finished", "abandoned"] },
      rating: { type: "number" },
      finished: { type: "date" },
    },
  ],
  ["life/week", 40],
  ["recipe", 35, { cuisine: { type: "string" }, tried: { type: "boolean" } }],
  ["walk", 30],
  ["person", 28, { met: { type: "date" }, city: { type: "string" } }],
  ["gratitude", 25],
  ["capture/photo", 22],
  [
    "project",
    20,
    {
      status: { type: "string", enum: ["seed", "active", "paused", "shipped", "compost"] },
      area: { type: "string", enum: ["home", "craft", "community", "money"] },
      priority: { type: "string", enum: ["low", "medium", "high"] },
      owner: { type: "string" },
      effort_days: { type: "number" },
      started: { type: "date" },
      due: { type: "date" },
      reviewed: { type: "date" },
      shared: { type: "boolean" },
    },
  ],
  ["media/film", 18, { director: { type: "string" }, rating: { type: "number" } }],
  ["garden/plot", 15],
  ["sketch", 12],
  ["letter", 10],
  ["life/month", 10],
  ["poem", 9],
  ["media/album", 8],
  ["work/standup", 8],
  [
    "trip",
    7,
    { where: { type: "string" }, departed: { type: "date" }, returned: { type: "date" } },
  ],
  ["song", 6],
  ["review", 6],
  ["budget", 5],
  ["place", 5],
  ["garden/harvest", 4],
  ["repair", 4],
  ["menu", 3],
  ["errand", 3],
  ["class", 3],
  ["bird", 2],
  ["gift", 2],
  ["work/retro", 2],
  ["plant", 2],
  ["appointment", 1],
  ["life/year", 1],
  ["draft", 1],
  ["reading-list", 1],
  ["mushroom", 1],
  ["tide-chart", 1],
  ["kiln", 1],
];

// --- Pools for the generated tail (--tags beyond 47) ------------------------
const FAMILIES = [
  "capture",
  "life",
  "work",
  "media",
  "garden",
  "field",
  "studio",
  "kitchen",
  "trail",
  "shore",
] as const;
const CHILD_WORDS = [
  "log",
  "sketchbook",
  "batch",
  "route",
  "clipping",
  "bench",
  "frame",
  "stall",
  "ledger",
  "roll",
  "index",
  "loop",
  "patch",
  "spool",
  "drift",
] as const;
const STANDALONE_WORDS = [
  "lantern",
  "driftwood",
  "compost",
  "almanac",
  "hymn",
  "postcard",
  "riddle",
  "spice",
  "kelp",
  "ember",
  "thicket",
  "mosaic",
  "pantry",
  "satchel",
  "meadow",
  "pigment",
  "burrow",
  "cairn",
  "dune",
  "eddy",
  "gale",
  "inlet",
  "jetty",
  "knoll",
  "marsh",
  "nook",
  "orchard",
  "quarry",
  "reed",
  "shale",
  "trellis",
  "umber",
  "vine",
  "wharf",
  "yarrow",
  "zephyr",
  "anvil",
  "bramble",
  "cider",
  "dorsal",
  "easel",
  "fern",
  "gravel",
  "hollow",
  "ingot",
  "juniper",
  "kettle",
  "loam",
  "mantel",
  "nettle",
] as const;

// Field vocabulary for generated schemas. Generic on purpose — the app's rule
// is "read what's there, never supply vocabulary", and this tool tests the
// reading side, so the names just need to be plausible, typed, and synthetic.
const FIELD_POOL: ReadonlyArray<[string, FieldSpec]> = [
  ["status", { type: "string", enum: ["open", "settled", "let-go"] }],
  ["kind", { type: "string", enum: ["small", "medium", "large"] }],
  ["stage", { type: "string", enum: ["sprout", "steady", "resting"] }],
  ["rating", { type: "number" }],
  ["minutes", { type: "number" }],
  ["attempts", { type: "number" }],
  ["when", { type: "date" }],
  ["started", { type: "date" }],
  ["wrapped", { type: "date" }],
  ["done", { type: "boolean" }],
  ["shared", { type: "boolean" }],
  ["with", { type: "string" }],
  ["where", { type: "string" }],
  ["source", { type: "string" }],
];

function nextName(rand: () => number, used: Set<string>): string {
  // ~30% slash-family children, like the curated head (15/47).
  for (let attempt = 0; attempt < 40; attempt++) {
    const name =
      rand() < 0.3
        ? `${pickWith(rand, FAMILIES)}/${pickWith(rand, CHILD_WORDS)}`
        : pickWith(rand, STANDALONE_WORDS);
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // Pools exhausted — numbered variants keep names unique at any --tags.
  let n = 2;
  let name = "";
  do {
    name = `${pickWith(rand, STANDALONE_WORDS)}-${n}`;
    n += 1;
  } while (used.has(name));
  used.add(name);
  return name;
}

// Largest-remainder scaling: weights → integer counts summing exactly to
// `total`, every tag at least 1. (If total ≤ tags, everyone gets exactly 1 —
// you asked for more tags than notes.)
function scaleCounts(weights: number[], total: number): number[] {
  if (total <= weights.length) return weights.map(() => 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w * total) / sum);
  const counts = raw.map((r) => Math.max(1, Math.floor(r)));
  let diff = total - counts.reduce((a, b) => a + b, 0);
  if (diff > 0) {
    // Hand the remainder to UNclamped tags only (largest fraction first) —
    // the min-1 clamp already over-served the tail, and bumping a one-note
    // tag to two would erase the long tail the whole tool exists to model.
    const eligible = raw
      .map((r, i) => ({ frac: r - Math.floor(r), i }))
      .filter(({ i }) => raw[i] >= 1)
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    const order = eligible.length > 0 ? eligible : raw.map((_, i) => ({ frac: 0, i }));
    for (let k = 0; diff > 0; k = (k + 1) % order.length) {
      counts[order[k].i] += 1;
      diff -= 1;
    }
  } else if (diff < 0) {
    // The min-1 clamp overshot — take the excess back from the largest tags.
    const order = counts.map((_, i) => i).sort((a, b) => counts[b] - counts[a] || a - b);
    for (let k = 0; diff < 0; k = (k + 1) % order.length) {
      if (counts[order[k]] > 1) {
        counts[order[k]] -= 1;
        diff += 1;
      }
    }
  }
  return counts;
}

function generateSchema(rand: () => number, maxFields: number): Record<string, FieldSpec> {
  // rand² skews small: most generated schemas carry 1–3 fields.
  const n = Math.min(maxFields, 1 + Math.floor(rand() ** 2 * maxFields));
  const pool = [...FIELD_POOL];
  shuffle(pool, rand);
  const fields: Record<string, FieldSpec> = {};
  for (let i = 0; i < n; i++) {
    if (i < pool.length) fields[pool[i][0]] = structuredClone(pool[i][1]);
    else fields[`extra_${i + 1}`] = { type: "number" };
  }
  return fields;
}

const fieldCount = (s: TagSpec): number => (s.fields ? Object.keys(s.fields).length : 0);

export function buildTaxonomy(params: TaxonomyParams): TagSpec[] {
  const { tags, notes, schemaShare, maxFields, seed } = params;
  if (!Number.isInteger(tags) || tags < 1)
    throw new Error(`tags must be a positive integer, got ${tags}`);
  if (!Number.isInteger(notes) || notes < 1)
    throw new Error(`notes must be a positive integer, got ${notes}`);
  if (!(schemaShare >= 0 && schemaShare <= 1))
    throw new Error(`schema-share must be between 0 and 1, got ${schemaShare}`);
  if (!Number.isInteger(maxFields) || maxFields < 1)
    throw new Error(`max-fields must be a positive integer, got ${maxFields}`);
  const rand = makeRand(seed);

  // 1. Names + weights: curated head, generated tail (tail weight 1 — it IS
  //    the long tail).
  const specs: TagSpec[] = CURATED.slice(0, Math.min(tags, CURATED.length)).map(
    ([name, weight, fields]) => ({
      name,
      count: weight,
      fields: fields ? structuredClone(fields) : undefined,
    }),
  );
  const used = new Set(specs.map((s) => s.name));
  while (specs.length < tags) specs.push({ name: nextName(rand, used), count: 1 });

  // 2. Spread the notes power-law across the tags.
  const counts = scaleCounts(
    specs.map((s) => s.count),
    notes,
  );
  specs.forEach((s, i) => {
    s.count = counts[i];
  });

  // 3. Clamp curated schemas to the field ceiling.
  for (const s of specs) {
    if (!s.fields) continue;
    const names = Object.keys(s.fields);
    if (names.length > maxFields) {
      const kept = names.slice(0, maxFields);
      const trimmed: Record<string, FieldSpec> = {};
      for (const n of kept) trimmed[n] = s.fields[n];
      s.fields = trimmed;
    }
  }

  // 4. Hit the schema share: strip from the tail up (keeping the richest
  //    schema for last), or grant generated schemas to a seeded shuffle of the
  //    bare tags.
  const target = Math.round(schemaShare * specs.length);
  const holders = () => specs.filter((s) => s.fields);
  if (holders().length > target) {
    const richest = holders().reduce((a, b) => (fieldCount(b) > fieldCount(a) ? b : a));
    for (let i = specs.length - 1; i >= 0 && holders().length > target; i--) {
      if (specs[i].fields && specs[i] !== richest) specs[i].fields = undefined;
    }
    if (holders().length > target) richest.fields = undefined; // target 0: schema-free vault
  } else if (holders().length < target) {
    const bare = specs.filter((s) => !s.fields);
    shuffle(bare, rand);
    for (const s of bare.slice(0, target - holders().length))
      s.fields = generateSchema(rand, maxFields);
  }

  // 5. The ceiling case: at least one schema always carries exactly maxFields
  //    fields, so the widest table/FieldsControl is always exercised.
  const withFields = holders();
  if (withFields.length > 0 && !withFields.some((s) => fieldCount(s) >= maxFields)) {
    const richest = withFields.reduce((a, b) => (fieldCount(b) > fieldCount(a) ? b : a));
    const fields = richest.fields as Record<string, FieldSpec>;
    for (const [name, spec] of FIELD_POOL) {
      if (Object.keys(fields).length >= maxFields) break;
      if (!fields[name]) fields[name] = structuredClone(spec);
    }
    let i = 1;
    while (Object.keys(fields).length < maxFields) {
      fields[`extra_${i}`] = { type: "number" };
      i += 1;
    }
  }

  return specs;
}

// --- The note plan ----------------------------------------------------------
const OPENERS = [
  "Thinking about",
  "A note on",
  "Quick capture:",
  "Remembering",
  "Something about",
  "Half-formed:",
  "From this morning —",
  "Overheard:",
  "Worth keeping:",
  "On",
] as const;
const SUBJECTS = [
  "the long way home",
  "the kitchen window light",
  "a slower kind of week",
  "what the neighbor said",
  "the unfinished shelf",
  "rain on the skylight",
  "the second draft",
  "a walk before breakfast",
  "the borrowed ladder",
  "the letter I keep not sending",
  "the map on the wall",
  "an easier morning",
  "the yellow bicycle",
  "what stuck from the workshop",
  "the far field",
  "a name for the boat",
  "the third attempt",
  "what the tide left",
  "the hum of the fridge",
  "a better question",
  "the missing screw",
  "the first frost",
  "the bread that worked",
  "a chord that surprised me",
] as const;
const BODIES = [
  "It keeps coming back, so it probably matters. Writing it down to see its shape.",
  "Not sure where this goes yet. Leaving it here for the weekly review.",
  "Three sentences now beats a perfect page never.",
  "Caught this in passing; the details are already blurring at the edges.",
  "Might be nothing. Might be the start of the next thing.",
  "Same thought as last month, but sharper this time.",
  "Filed so the morning version of me can decide.",
  "The interesting part is the second half, if I ever get to it.",
] as const;
const PEOPLE = ["Mara", "Idris", "Petra", "Sol", "the co-op", "Ana", "Theo"] as const;

export interface NotePlan {
  path: string;
  content: string;
  tags: string[];
  metadata?: Record<string, unknown>;
}

function isoDaysBefore(anchorMs: number, days: number): string {
  return new Date(anchorMs - days * DAY_MS).toISOString().slice(0, 10);
}

function metadataFor(
  rand: () => number,
  fields: Record<string, FieldSpec> | undefined,
  anchorMs: number,
): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const md: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(fields)) {
    if (rand() < 0.15) continue; // real vaults are sparse — ~15% of fields empty
    if (spec.enum) md[name] = pickWith(rand, spec.enum);
    else if (spec.type === "date") md[name] = isoDaysBefore(anchorMs, Math.floor(rand() * 400));
    else if (spec.type === "number") md[name] = Math.floor(rand() * 90) + 5;
    else if (spec.type === "boolean") md[name] = rand() < 0.5;
    else md[name] = pickWith(rand, PEOPLE);
  }
  return Object.keys(md).length > 0 ? md : undefined;
}

export function buildNotePlan(taxonomy: TagSpec[], seed: number, anchorMs: number): NotePlan[] {
  const rand = makeRand(seed ^ 0x5eed);
  const total = taxonomy.reduce((a, t) => a + t.count, 0);
  const pad = Math.max(4, String(total).length);
  const plan: NotePlan[] = [];
  let serial = 0;
  for (const tag of taxonomy) {
    for (let i = 0; i < tag.count; i++) {
      const title = `${pickWith(rand, OPENERS)} ${pickWith(rand, SUBJECTS)}`;
      const varied =
        rand() < 0.15 ? `${title}, again` : rand() < 0.1 ? `${title} (${i + 1})` : title;
      const noteTags = [tag.name];
      // ~8% of notes carry a second tag — cross-links exist in real vaults.
      if (rand() < 0.08) {
        const other = pickWith(rand, taxonomy).name;
        if (other !== tag.name) noteTags.push(other);
      }
      serial += 1;
      plan.push({
        path: `Seed/${tag.name.replace(/\//g, "-")}/${String(serial).padStart(pad, "0")} ${varied.slice(0, 60)}`,
        content: `${varied}\n\n${pickWith(rand, BODIES)}`,
        tags: noteTags,
        metadata: metadataFor(rand, tag.fields, anchorMs),
      });
    }
  }
  return plan;
}

// --- Backdating -------------------------------------------------------------
// Keyed off the note PATH, not insert order: concurrent seeding makes row
// order racy, and determinism has to survive that.
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const unit = (s: string): number => fnv1a(s) / 0x100000000;

/**
 * Recency-weighted spread: u^2.2 clusters touches toward the present — about
 * a third of the vault touched in the last ~3 months, a tail stretching back
 * two years. Creation predates the last touch by 1–60 days.
 */
export function backdateFor(
  path: string,
  anchorMs: number,
): { createdAtMs: number; updatedAtMs: number } {
  const ageDays = Math.floor(unit(path) ** 2.2 * 730);
  const createdDays = ageDays + 1 + Math.floor(unit(`${path}#created`) * 60);
  const updatedAtMs = anchorMs - ageDays * DAY_MS - Math.floor(unit(`${path}#updated`) * DAY_MS);
  return { createdAtMs: anchorMs - createdDays * DAY_MS, updatedAtMs };
}
