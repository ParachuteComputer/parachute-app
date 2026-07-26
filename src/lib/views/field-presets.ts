import type { TagFieldSchema, TagUpsertPayload } from "@/lib/vault/types";

// The one-click field on-ramp — the fix for views' worst onboarding
// dead-end. A fresh vault seeds only `capture` + `guide`, and NEITHER carries
// a field schema (`parachute-vault/core/src/seed-packs.ts`: the
// schema-carrying `starter-ontology` pack is deliberately opt-in). Since view
// fields resolve from tag schemas alone (`fields.ts:resolveViewFields`), a
// board's Group-by pill had nothing to offer and could only EXPLAIN the
// absence — and the only recovery (Tags → filter → +Schema → add field →
// Save → back) is a path nobody discovers.
//
// So the empty control now offers to CREATE the field it needs. One click, no
// form, no wizard: a preset writes ONE field into the view's primary tag
// schema and the view immediately organizes by it. Renaming, retyping, and
// re-valuing all stay available in the shipped tag-schema editor (the
// "Something else…" escape routes straight there).
//
// TWO ETHOS RULES this module exists to hold:
//
//   1. Nothing is seeded but the field the user explicitly asked for. We do
//      not provision an ontology, a starter pack, or a second field "while
//      we're here" — Parachute's shape is the user's, not ours.
//   2. No `default` on any preset field — and NOT for the reason it looks like.
//      A `default` does not touch the EXISTING corpus: `applySchemaDefaults`
//      (parachute-vault `core/src/mcp.ts`) runs only on note WRITES (create /
//      add-tag), never from the tag PUT this on-ramp calls, so old notes are
//      left absent either way. What a `default` WOULD do is stamp the value
//      onto every FUTURE note that gains the tag — which is exactly what makes
//      `exists:false` meaningless: "never set" and "set to the default" stop
//      being distinguishable states. Keeping the field genuinely absent until
//      the user sets it is the guarantee vault#553 Decision B established, and
//      it's what lands existing notes in the board's uncategorized lane, where
//      the shipped Move / drag affordances assign the first value deliberately,
//      one note at a time.

/** A one-click field offer: what gets written, and how the menu row reads. */
export interface FieldPreset {
  /** The metadata key — written to the tag schema AND into the view's draft config. */
  name: string;
  /** The menu row's label (the field name, as it will appear everywhere after). */
  label: string;
  /** A one-line preview of the shape this field will carry. */
  hint: string;
  /** The declaration sent to `update-tag`. Never carries a `default` (see above). */
  schema: TagFieldSchema;
}

/**
 * Group-by offers (board). Both are enum fields, deliberately: a declared
 * `enum` is what makes the board's lanes render even while EMPTY
 * (`BoardView`'s declared-lanes pass), so the very first note can be dragged
 * out of "No status" into a real lane. A bare string field would produce a
 * single uncategorized column with nowhere to move to.
 *
 * Values are Title Case sentences, not slugs — they are shown verbatim as
 * lane headers and chip values, and the user can rewrite them in the tag
 * editor. Sensible defaults over configurability.
 */
export const GROUP_BY_PRESETS: readonly FieldPreset[] = [
  {
    name: "status",
    label: "status",
    hint: "To do · In progress · Done",
    schema: { type: "string", enum: ["To do", "In progress", "Done"] },
  },
  {
    name: "priority",
    label: "priority",
    hint: "Low · Medium · High",
    schema: { type: "string", enum: ["Low", "Medium", "High"] },
  },
];

/**
 * By-date offers (calendar). One preset — a `due` date — because that's the
 * field a calendar without one is almost always missing. A date-typed field
 * is what graduates the calendar out of its read-only createdAt fallback
 * (train F), so notes become draggable across days.
 */
export const DATE_PRESETS: readonly FieldPreset[] = [
  {
    name: "due",
    label: "due",
    hint: "A date on each note",
    schema: { type: "date" },
  },
];

/**
 * The `update-tag` payload that ADDS one preset field to a tag — the exact
 * body sent to `PUT /api/tags/:name` (through the shipped `useUpdateTag`
 * mutation; this surface hand-rolls no second writer).
 *
 * `fields` alone, and no `replace_fields`: vault's PUT is merge-on-write at
 * the field-key level (verified in `parachute-vault/src/routes.ts` and
 * `parachute-cloud/workers/vault/src/rest/tags.ts` — identical on both
 * doors), so a tag that already declares other fields keeps every one of
 * them. Omitting `description`/`parent_names` likewise preserves whatever the
 * tag already had; when the tag has no identity row yet, this creates one
 * carrying just the field the user asked for.
 */
export function fieldPresetPayload(preset: FieldPreset): TagUpsertPayload {
  return { fields: { [preset.name]: preset.schema } };
}
