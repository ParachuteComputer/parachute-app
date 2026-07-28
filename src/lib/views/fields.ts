import { useTag } from "@/lib/vault/queries";
import type { TagFieldSchema, TagRecord } from "@/lib/vault/types";
import { useMemo } from "react";
import { queryTags } from "./query";
import type { ViewDef } from "./schema";

// Tag-schema-driven configurable FIELDS (view-experience wave, Part B) — the
// SHARED primitive that answers "which fields does this view show and let you
// edit?" A view's fields default to the declared schema fields of its primary
// tag (in schema order), and are configurable per view via the optional
// `fields` metadata key (an ordered subset/override). Every kind reads this
// one resolution: field chips on cards now; table columns + menu ordering
// later.

/** A single resolved field: its metadata key + the schema that types it. */
export interface ResolvedField {
  /** The metadata key on the note (e.g. "status", "meeting_date"). */
  name: string;
  /**
   * The field's declared type — drives which control edits it
   * (`FieldValueControl`). When the tag has no schema for the field (an
   * override naming an undeclared field, or a schema-less vault), it degrades
   * to a free-form string field.
   */
  schema: TagFieldSchema;
}

const STRING_FIELD: TagFieldSchema = { type: "string" };

/**
 * The single tag a view filters by, or `null` when it filters by zero or
 * many tags. Field resolution keys off a SINGLE primary tag — a multi-tag
 * intersection has no one schema to read (§Part B: "when the query filters
 * by a single tag").
 */
export function singleQueryTag(query: Record<string, unknown> | null): string | null {
  const tags = queryTags(query);
  return tags.length === 1 ? tags[0] : null;
}

/**
 * Resolve a view's shown/editable fields (pure — testable without a network):
 *
 *   1. the view's `fields` override if present (in that order), each typed by
 *      the tag's schema when the schema declares it, else a string field;
 *   2. else the primary tag's declared schema fields, in schema order, when
 *      the query filters by a single tag AND that tag has a schema;
 *   3. else `[]` (no chips — today's look).
 *
 * `tagFields` is the primary tag's `fields` record (from `useTag`), or
 * `null`/`undefined` when there's no single tag or no schema yet.
 */
export function resolveViewFields(
  def: Pick<ViewDef, "query" | "fields">,
  tagFields: Record<string, TagFieldSchema> | null | undefined,
): ResolvedField[] {
  if (def.fields && def.fields.length > 0) {
    return def.fields.map((name) => ({ name, schema: tagFields?.[name] ?? STRING_FIELD }));
  }
  const single = singleQueryTag(def.query);
  if (single && tagFields) {
    // Object key order is insertion order — the authored schema order.
    return Object.entries(tagFields).map(([name, schema]) => ({ name, schema }));
  }
  return [];
}

/**
 * The view's resolved fields, fetching the primary tag's schema when the
 * query filters by exactly one tag. Fetch-deduped with the board's own
 * `useTag(subjectTag)` (same query key), so a board pays for the schema once.
 * Returns `[]` while the schema loads or when nothing resolves — the
 * graceful "no chips" state.
 */
export function useResolvedViewFields(def: ViewDef | null): ResolvedField[] {
  const single = def ? singleQueryTag(def.query) : null;
  const tag = useTag(single);
  return useMemo(() => {
    if (!def) return [];
    return resolveViewFields(def, tagFieldsOf(tag.data));
  }, [def, tag.data]);
}

function tagFieldsOf(tag: TagRecord | null | undefined): Record<string, TagFieldSchema> | null {
  return tag?.fields ?? null;
}

/**
 * The primary tag's declared schema, name → type, in schema order — the
 * other half of the Fields control's union (schema ∪ current effective
 * set), so a field the view currently hides can still be offered for
 * checking. Also the TYPE source for the Fields/Group-by menus' type
 * glyphs and sectioning — a hidden field carries no `ResolvedField` of its
 * own, so its type has to come from here, not from `fields`. `{}` when the
 * query has no single tag or the tag has no schema (yet). Fetch-deduped
 * with `useResolvedViewFields` (same `useTag` query key).
 */
export function useSchemaFields(def: ViewDef | null): Record<string, TagFieldSchema> {
  const single = def ? singleQueryTag(def.query) : null;
  const tag = useTag(single);
  return useMemo(() => tagFieldsOf(tag.data) ?? {}, [tag.data]);
}

/**
 * Whether the primary tag's schema query has actually ANSWERED — the honest
 * gate for the empty-state "add a field" invitation. `useResolvedViewFields`
 * returns `[]` both while the schema is loading AND when it genuinely has no
 * fields; the organize-by controls must not cry "#tag has no fields yet — add
 * one" during the fetch window on a tag that in fact declares fields. This is
 * `true` the instant there's no single tag to wait on (the "not scoped to one
 * tag" message keys off the query, resolved synchronously — not off this
 * fetch), and otherwise tracks the tag GET's success. A 404 (a tag with notes
 * but no identity row — the on-ramp's core case) resolves to `null` data with
 * `isSuccess === true` (`VaultClient` maps 404→null), so the invitation still
 * fires for exactly the schema-less tag that needs it. Fetch-deduped with
 * `useResolvedViewFields`/`useSchemaFields` (same `useTag` query key).
 */
export function useSchemaReady(def: ViewDef | null): boolean {
  const single = def ? singleQueryTag(def.query) : null;
  const tag = useTag(single);
  return single ? tag.isSuccess : true;
}
