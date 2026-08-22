import { pathLeaf } from "@/lib/note-title";
import type { Note } from "@/lib/vault/types";

// The canonical view module (VIEWS-RENDER-SPEC §1) — the ONE decoder every
// renderer and the Rail band consume. A view is a note tagged `#view` whose
// metadata IS the definition; the note body is prose for people. Ground
// truth: vault `core/src/seed-packs.ts` (#605).
//
// The spec's §8 (a legacy `{kind:"saved-view",filters}` adapter for old
// `UI/Views/` notes) is VOID — that feature is unused in practice (Aaron,
// 2026-07-17); this module never decodes that shape. The old writer has been
// retired; the predicate below only keeps already-existing notes out of the
// canonical Views band.

// "table" (views train D) is additive on the wire: any decoder that predates
// it — old app versions included — hits the unknown-kind branch below and
// renders the view as a list. No breakage, by the same §1 rule that makes
// every unknown kind safe.
export const VIEW_KINDS = ["list", "board", "calendar", "gallery", "table"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

function isViewKind(x: unknown): x is ViewKind {
  return typeof x === "string" && (VIEW_KINDS as readonly string[]).includes(x);
}

export interface ViewProblem {
  code: "invalid_query_json" | "unsupported_query_key";
  /** Plain-language, ready to render in the problems banner (§3). */
  message: string;
}

export interface ViewDef {
  noteId: string;
  path?: string;
  /** From the note's path basename. */
  title: string;
  kind: ViewKind;
  /**
   * The parsed, unvalidated MCP-grammar query object. `null` only when the
   * note's `query` metadata failed to parse — §3's "run nothing" posture,
   * not an empty-object "everything" query (which would lie about what a
   * malformed view means).
   */
  query: Record<string, unknown> | null;
  /**
   * The metadata field a view GROUPS by — the board renders it as lanes, but
   * grouping is the general gesture (view-experience wave: "the lens's
   * organizing gesture writes the field"). Decoded from the canonical
   * `group_by` key, falling back to the PERMANENT `lane_by` alias so no
   * pre-rename `#view` note breaks.
   */
  groupBy?: string;
  dateField?: string;
  /**
   * The ORDERED field names a view shows/edits (Part B) — an optional
   * per-view override of the primary tag's declared schema fields. Decoded
   * from the `fields` metadata key (a JSON-string array); absent/malformed
   * degrades to the tag-schema default (see `resolveViewFields`).
   */
  fields?: string[];
  problems: ViewProblem[];
}

const UNPARSEABLE_QUERY_PROBLEM: ViewProblem = {
  code: "invalid_query_json",
  message:
    "This view's query didn't parse — nothing is being filtered out or shown. Open the note to fix it.",
};

function titleFor(note: Note): string {
  return note.path ? pathLeaf(note.path) : note.id;
}

/**
 * Decode a `#view`-tagged note into a `ViewDef`. Never throws, never
 * returns null — a view is never wrong to render as a list (§1:
 * unknown/absent `kind` degrades silently, no problem recorded).
 */
export function decodeViewDef(note: Note): ViewDef {
  const meta = (note.metadata ?? {}) as Record<string, unknown>;

  const kind: ViewKind = isViewKind(meta.kind) ? meta.kind : "list";
  const problems: ViewProblem[] = [];
  let query: Record<string, unknown> | null = {};

  if (typeof meta.query === "string" && meta.query.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(meta.query);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        query = parsed as Record<string, unknown>;
      } else {
        query = null;
        problems.push(UNPARSEABLE_QUERY_PROBLEM);
      }
    } catch {
      query = null;
      problems.push(UNPARSEABLE_QUERY_PROBLEM);
    }
  } else if (meta.query !== undefined && meta.query !== null && typeof meta.query !== "string") {
    // The wire format says `query` is a JSON STRING (§0/§1) — a note whose
    // metadata carries a raw object/array/number there is also malformed,
    // just via a different mistake (e.g. a client that skipped the
    // JSON.stringify step) than a syntax error inside the string.
    query = null;
    problems.push(UNPARSEABLE_QUERY_PROBLEM);
  }

  return {
    noteId: note.id,
    path: note.path,
    title: titleFor(note),
    kind,
    query,
    // `group_by` is canonical; `lane_by` is a permanent decoder alias so
    // every board authored before the rename still groups.
    groupBy:
      typeof meta.group_by === "string"
        ? meta.group_by
        : typeof meta.lane_by === "string"
          ? meta.lane_by
          : undefined,
    dateField: typeof meta.date_field === "string" ? meta.date_field : undefined,
    fields: decodeFieldsList(meta.fields),
    problems,
  };
}

/**
 * Decode the optional `fields` key — an ORDERED list of metadata field names
 * a view shows/edits. The wire format is a JSON-string array (mirroring
 * `query`); a raw string[] is also accepted for tolerance. Anything else
 * (missing, malformed JSON, non-string entries) degrades to `undefined` —
 * the view falls back to its primary tag's schema fields, today's behavior.
 * Unlike `query`, a malformed `fields` records NO problem: it only ever adds
 * an optional band, so silence is the graceful posture.
 */
function decodeFieldsList(value: unknown): string[] | undefined {
  let raw: unknown = value;
  if (typeof value === "string") {
    if (value.trim().length === 0) return undefined;
    try {
      raw = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(raw)) return undefined;
  const names = raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return names.length > 0 ? names : undefined;
}

/** True when the note carries the vault's `view` role tag. */
export function isViewNote(note: Note, viewTag: string): boolean {
  return (note.tags ?? []).includes(viewTag);
}

/**
 * True for the legacy `{kind:"saved-view", filters}` shape (§8, void) —
 * used only to keep such notes OUT of the Rail band (VIEWS-RENDER-SPEC
 * scope cut, 2026-07-17: "no legacy notes in the Rail band"), not to
 * decode or reconcile them.
 */
export function isLegacySavedView(note: Note): boolean {
  const meta = note.metadata as { kind?: unknown } | undefined;
  return meta?.kind === "saved-view";
}
