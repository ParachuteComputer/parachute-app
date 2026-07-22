import { todayKey } from "@/lib/dates";
import type { TagFieldSchema } from "@/lib/vault/types";
import type { Note } from "@/lib/vault/types";

// The shared grouping/placement engine (Views Wave 2b; generalized in the
// view-experience wave) — the pure half of the board / calendar renderers,
// split out so the "which note lands where" decisions are testable without a
// DOM. `groupIntoLanes`/`resolveLaneOrder` are the general grouping engine a
// view drives with its `group_by` field (the board renders that grouping as
// lanes); `placeOnCalendar` is its date-placement counterpart. The renderers
// in `src/components/views/` are the thin presentational shell over these.

// ---------------------------------------------------------------------------
// Grouping — bucket result notes by the distinct values of a `group_by`
// metadata field (the board renders each bucket as a lane/column).
// ---------------------------------------------------------------------------

export interface Lane {
  /** The distinct field value this lane collects — `""` for uncategorized. */
  key: string;
  /** Column header text — the value itself, or "No {field}" for uncategorized. */
  label: string;
  notes: Note[];
  /** True for the trailing "missing the field" lane (rendered last, muted). */
  uncategorized: boolean;
  /**
   * The ORIGINAL typed metadata value the lane's notes carry (a number/boolean
   * stays a number/boolean; a string stays a string) — taken from the first
   * note that fell into the lane. `null` for the uncategorized lane. This is the
   * value a tap-to-move write MUST send: `key`/`label` are stringified for
   * grouping (a numeric/boolean status still lanes), but writing a STRING back
   * to an `indexed` integer/boolean field is hard-rejected by the vault, so the
   * mutation writes `value`, not `key`. Moving to the uncategorized lane writes
   * `null` (vault's null-as-delete clears the field).
   */
  value: unknown;
}

/**
 * The lane value a note falls into for `field`, or `null` when the note has
 * no usable value there (missing, empty, or a non-scalar — arrays/objects
 * aren't lane keys). Scalars stringify so a numeric/boolean status still
 * lanes; strings are trimmed and empty-after-trim counts as absent.
 */
function laneValue(note: Note, field: string): string | null {
  const v = note.metadata?.[field];
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const trimmed = v.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/**
 * A small built-in ordering for common lane fields, used only when the tag's
 * own schema doesn't declare an `enum` for the field (`resolveLaneOrder`).
 * The canonical order is always the vault's schema when present; this is the
 * graceful fallback so a `status` board reads active→archived rather than
 * alphabetical even against a vault with no schema row.
 */
const KNOWN_LANE_ORDER: Record<string, string[]> = {
  status: ["active", "incubating", "dormant", "paused", "archived", "done", "shipped", "dropped"],
  priority: ["high", "medium", "low"],
};

/**
 * The preferred lane order for `field`: the tag schema's declared `enum`
 * (the authored "known enum order") when present, else a built-in default
 * for common fields, else `[]` (pure alphabetical). Values the notes don't
 * actually use are harmless — `groupIntoLanes` only emits lanes that have
 * notes.
 */
export function resolveLaneOrder(
  field: string,
  tagFields?: Record<string, TagFieldSchema> | null,
): string[] {
  const declared = tagFields?.[field]?.enum;
  if (declared && declared.length > 0) return declared;
  return KNOWN_LANE_ORDER[field] ?? [];
}

/**
 * Group `notes` into board lanes by the distinct values of the `field`
 * metadata key. Lane order: values named in `order` first (in that order,
 * only those actually present), then any remaining values alphabetically;
 * the uncategorized lane (notes missing the field) is always last. Empty
 * lanes are never emitted — a value in `order` that no note carries produces
 * no column.
 */
export function groupIntoLanes(notes: Note[], field: string, order: string[] = []): Lane[] {
  const byKey = new Map<string, Note[]>();
  // The original typed value per key — captured from the first note in each
  // lane so a tap-to-move write can send the value with its authored type
  // (number 3, not the string "3"), which is what an `indexed` field requires.
  const rawByKey = new Map<string, unknown>();
  const uncategorized: Note[] = [];

  for (const note of notes) {
    const value = laneValue(note, field);
    if (value === null) {
      uncategorized.push(note);
      continue;
    }
    const bucket = byKey.get(value);
    if (bucket) {
      bucket.push(note);
    } else {
      byKey.set(value, [note]);
      rawByKey.set(value, note.metadata?.[field]);
    }
  }

  const ordered = order.filter((k) => byKey.has(k));
  const orderedSet = new Set(ordered);
  const remaining = [...byKey.keys()]
    .filter((k) => !orderedSet.has(k))
    .sort((a, b) => a.localeCompare(b));

  const lanes: Lane[] = [...ordered, ...remaining].map((key) => ({
    key,
    label: key,
    notes: byKey.get(key) ?? [],
    uncategorized: false,
    value: rawByKey.get(key),
  }));

  if (uncategorized.length > 0) {
    lanes.push({
      key: "",
      label: `No ${field}`,
      notes: uncategorized,
      uncategorized: true,
      value: null,
    });
  }
  return lanes;
}

// ---------------------------------------------------------------------------
// Calendar placement — plot notes on days by a `dateField` metadata value.
// Day keys and the month grid come from `@/lib/dates` (the same local-time
// `YYYY-MM-DD` / 1-based-month vocabulary the /calendar route uses), so a
// note lands on the same cell both surfaces would draw.
// ---------------------------------------------------------------------------

/**
 * Parse a metadata date value defensively into a local Date, or `null` when
 * it isn't a usable date. An ISO-leading string (`YYYY-MM-DD` optionally
 * followed by a time) is read by its wall-clock date digits and constructed
 * as a LOCAL date — so a `meeting_date` lands on the day the author wrote,
 * never a timezone-shifted neighbor. Any other non-empty string falls back
 * to the platform `Date` parser; non-strings are undated.
 */
export function parseNoteDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface CalendarPlacement {
  /** `YYYY-MM-DD` day key (`@/lib/dates`) → the notes on that day, in order. */
  byDay: Map<string, Note[]>;
  /** Notes whose `dateField` was missing or unparseable — omitted from the grid. */
  undated: Note[];
  /** noteId → parsed Date, for choosing the default month to open on. */
  dates: Map<string, Date>;
}

/** Bucket `notes` by their `dateField` day; collect the undated separately. */
export function placeOnCalendar(notes: Note[], dateField: string): CalendarPlacement {
  const byDay = new Map<string, Note[]>();
  const undated: Note[] = [];
  const dates = new Map<string, Date>();

  for (const note of notes) {
    const d = parseNoteDate(note.metadata?.[dateField]);
    if (!d) {
      undated.push(note);
      continue;
    }
    dates.set(note.id, d);
    const key = todayKey(d);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(note);
    else byDay.set(key, [note]);
  }
  return { byDay, undated, dates };
}

/**
 * The month to open the calendar on (1-based month, matching `@/lib/dates`):
 * the month of the most RECENT dated note (so a meetings calendar lands where
 * the meetings are), or `fallback`'s month when nothing is dated.
 */
export function defaultMonth(
  dates: Iterable<Date>,
  fallback: Date = new Date(),
): { year: number; month: number } {
  let latest: Date | null = null;
  for (const d of dates) {
    if (!latest || d.getTime() > latest.getTime()) latest = d;
  }
  const base = latest ?? fallback;
  return { year: base.getFullYear(), month: base.getMonth() + 1 };
}
