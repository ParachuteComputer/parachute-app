import type { ResolvedField } from "./fields";
import { VIEW_KINDS, type ViewDef, type ViewKind } from "./schema";

// The draft-config layer (views train B) — EXPLORE-THEN-SAVE for a view's
// CONFIG (lens/kind, group-by, date-field, field set). Changing any of it is
// a temporary exploration: the saved `#view` note changes only on an explicit
// Save; Revert discards. The draft lives in the URL (D1) — the same pattern
// the shipped query refinements use (`query.ts` §5): leave = discard
// silently, back-button restores, a shared link carries the exploration.
//
// DATA writes through a view (field chips, board moves — `write.ts`) are the
// OTHER affordance: immediate, never governed by this draft. Don't blur them.

export interface ViewConfigDraft {
  kind?: ViewKind;
  groupBy?: string;
  dateField?: string;
  fields?: string[];
}

export const EMPTY_CONFIG_DRAFT: ViewConfigDraft = {};

export function hasConfigDraft(draft: ViewConfigDraft): boolean {
  return (
    draft.kind !== undefined ||
    draft.groupBy !== undefined ||
    draft.dateField !== undefined ||
    draft.fields !== undefined
  );
}

// --- URL round-trip ----------------------------------------------------
//
// Params: `kind`, `group`, `date`, `fields` — deliberately DISJOINT from the
// refinement params (`tag`, `noExclude`, `search`, `sort` —
// `refinementsToSearchParams`), so both axes share one URL without
// collision. `fields` is comma-joined (an ordered list in one param; field
// names are metadata keys, which don't carry commas in practice).

export function configDraftToSearchParams(draft: ViewConfigDraft): URLSearchParams {
  const params = new URLSearchParams();
  if (draft.kind) params.set("kind", draft.kind);
  if (draft.groupBy) params.set("group", draft.groupBy);
  if (draft.dateField) params.set("date", draft.dateField);
  if (draft.fields && draft.fields.length > 0) params.set("fields", draft.fields.join(","));
  return params;
}

export function searchParamsToConfigDraft(params: URLSearchParams): ViewConfigDraft {
  const draft: ViewConfigDraft = {};
  const kind = params.get("kind");
  if (kind && (VIEW_KINDS as readonly string[]).includes(kind)) draft.kind = kind as ViewKind;
  const group = params.get("group");
  if (group) draft.groupBy = group;
  const date = params.get("date");
  if (date) draft.dateField = date;
  const fields = params.get("fields");
  if (fields) {
    const names = fields
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length > 0) draft.fields = names;
  }
  return draft;
}

// --- The overlay -------------------------------------------------------

/**
 * Pure overlay: the effective ViewDef a draft explores — draft keys win,
 * absent keys keep the saved value. An empty draft returns `def` ITSELF
 * (identity), so memoized consumers see a stable object when nothing is
 * being explored. Never mutates `def`.
 */
export function applyConfig(def: ViewDef, draft: ViewConfigDraft): ViewDef {
  if (!hasConfigDraft(draft)) return def;
  return {
    ...def,
    kind: draft.kind ?? def.kind,
    groupBy: draft.groupBy ?? def.groupBy,
    dateField: draft.dateField ?? def.dateField,
    fields: draft.fields ?? def.fields,
  };
}

function sameFields(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Drop draft keys that equal the saved def's value — setting a control back
 * to the saved state clears that key, so "no divergence" and "no draft" stay
 * the same fact (the save bar's visibility rides on `hasConfigDraft`).
 */
export function normalizeConfigDraft(def: ViewDef, draft: ViewConfigDraft): ViewConfigDraft {
  const next: ViewConfigDraft = {};
  if (draft.kind !== undefined && draft.kind !== def.kind) next.kind = draft.kind;
  if (draft.groupBy !== undefined && draft.groupBy !== def.groupBy) next.groupBy = draft.groupBy;
  if (draft.dateField !== undefined && draft.dateField !== def.dateField) {
    next.dateField = draft.dateField;
  }
  if (draft.fields !== undefined && !sameFields(draft.fields, def.fields)) {
    next.fields = draft.fields;
  }
  return next;
}

// --- Lens switching ----------------------------------------------------

/** The first field whose schema declares an enum — the board's natural default lane field. */
export function firstEnumField(fields: ResolvedField[]): string | undefined {
  return fields.find((f) => (f.schema.enum?.length ?? 0) > 0)?.name;
}

/** The first date-typed field — the calendar's natural default date field. */
export function firstDateField(fields: ResolvedField[]): string | undefined {
  return fields.find((f) => f.schema.type === "date")?.name;
}

/**
 * The draft CANDIDATE after switching the lens to `kind` (callers normalize
 * via `normalizeConfigDraft` before writing it to the URL). When the target
 * lens needs config the effective view lacks, a default is written INTO the
 * draft — board with no group-by takes the first enum-typed resolved field;
 * calendar with no date-field takes the first date-typed one — so the URL
 * carries the full exploration and Save writes exactly what's rendered. No
 * candidate default (schema still loading, or none declared) adds nothing:
 * a board without a group-by falls through to the list; a calendar without
 * a date field renders read-only by createdAt (train F).
 *
 * The symmetric half (review must-fix): when the TARGET kind doesn't use a
 * draft key (`groupBy` off-board, `dateField` off-calendar) AND the saved
 * def never had it, the key is DROPPED — a peek at Board and back to List
 * leaves no residue (no stuck "View modified" bar, no stray `group_by`
 * written on Save). Nothing legitimate is lost: the Group/Date controls are
 * only reachable on board/calendar. A draft override of a key the SAVED def
 * carries survives the switch — that divergence is real.
 */
export function withLens(
  def: ViewDef,
  draft: ViewConfigDraft,
  kind: ViewKind,
  resolved: ResolvedField[],
): ViewConfigDraft {
  const next: ViewConfigDraft = { ...draft, kind };
  if (kind === "board") {
    if (!(draft.groupBy ?? def.groupBy)) {
      const name = firstEnumField(resolved);
      if (name) next.groupBy = name;
    }
  } else if (def.groupBy === undefined) {
    // (Assignment, not `delete` — lint/performance/noDelete. Every consumer
    // treats an undefined-valued key as absent: the `!== undefined` guards
    // in hasConfigDraft/normalizeConfigDraft, truthiness in the URL writer.)
    next.groupBy = undefined;
  }
  if (kind === "calendar") {
    if (!(draft.dateField ?? def.dateField)) {
      const name = firstDateField(resolved);
      if (name) next.dateField = name;
    }
  } else if (def.dateField === undefined) {
    next.dateField = undefined;
  }
  return next;
}

// --- Save payloads (§5's Save sheet, extended to config) ---------------
//
// Wire shapes per the `#view` decoder (`schema.ts`): `group_by` is the
// canonical key (never the legacy `lane_by` alias), `date_field` a plain
// string, `fields` a JSON-string array, `query` a JSON string.

/**
 * Update-mode PATCH metadata: `kind` + `query` (the shipped baseline), plus
 * EXACTLY the config keys the draft overrides. Vault's metadata PATCH merges
 * key-level, so config keys the draft never touched survive on the note
 * untouched. A `null` mergedQuery (the §3 unparseable-query posture) OMITS
 * the `query` key entirely — writing `"{}"` there would silently promote
 * "run nothing" into match-everything; omitting preserves the note's own
 * (still-malformed, still-bannered) query string.
 */
export function draftPatchMetadata(
  def: ViewDef,
  draft: ViewConfigDraft,
  mergedQuery: Record<string, unknown> | null,
): Record<string, string> {
  const eff = applyConfig(def, draft);
  const metadata: Record<string, string> = { kind: eff.kind };
  if (mergedQuery !== null) metadata.query = JSON.stringify(mergedQuery);
  if (draft.groupBy !== undefined) metadata.group_by = draft.groupBy;
  if (draft.dateField !== undefined) metadata.date_field = draft.dateField;
  if (draft.fields !== undefined) metadata.fields = JSON.stringify(draft.fields);
  return metadata;
}

/**
 * Fork-mode metadata: the FULL effective config, not just kind+query — a
 * forked board keeps its lanes, a forked calendar its date field, a forked
 * field-set its columns (the train-B fix: fork used to silently drop
 * `group_by`/`date_field`/`fields`). Same `null`-query rule as
 * `draftPatchMetadata`.
 */
export function fullConfigMetadata(
  eff: ViewDef,
  mergedQuery: Record<string, unknown> | null,
): Record<string, string> {
  const metadata: Record<string, string> = { kind: eff.kind };
  if (mergedQuery !== null) metadata.query = JSON.stringify(mergedQuery);
  if (eff.groupBy !== undefined) metadata.group_by = eff.groupBy;
  if (eff.dateField !== undefined) metadata.date_field = eff.dateField;
  if (eff.fields !== undefined) metadata.fields = JSON.stringify(eff.fields);
  return metadata;
}
