import { IconCalendar, IconColumns, IconGrid, IconNotes, IconTable } from "@/components/NavIcons";
import {
  ControlPill,
  type ControlPillAction,
  type ControlPillSection,
} from "@/components/views/ControlPill";
import { resolveControlKind } from "@/components/views/FieldValueControl";
import { hueForEnumValue } from "@/lib/hue/hue";
import type { ResolvedField } from "@/lib/views/fields";
import { VIEW_KINDS, type ViewKind } from "@/lib/views/schema";

// The in-place lens switcher (views train B, restyled polish V3) — switch how
// the SAME result set renders (list/board/calendar/gallery/table). One
// ControlPill dropdown now, not a five-way segment: the lens is the view's
// IDENTITY, so the pill wears no eyebrow label — just `[glyph] Board ▾`.
// Writing `kind` into the URL config draft is lossless by construction:
// `useViewResults`' cache key excludes `kind`, so switching lens re-renders
// the one cached result set without a refetch. The board-only Group-by and
// calendar-only By-date pills ride alongside, writing the same draft — now
// first-class labeled controls that RENDER EVEN EMPTY (a control that
// vanishes can't explain what the view is organized by).

const KIND_LABELS: Record<ViewKind, string> = {
  list: "List",
  board: "Board",
  calendar: "Calendar",
  gallery: "Gallery",
  table: "Table",
};

function KindGlyph({ kind }: { kind: ViewKind }) {
  switch (kind) {
    case "board":
      return <IconColumns width={14} height={14} />;
    case "calendar":
      return <IconCalendar width={14} height={14} />;
    case "gallery":
      return <IconGrid width={14} height={14} />;
    case "table":
      return <IconTable width={14} height={14} />;
    default:
      return <IconNotes width={14} height={14} />;
  }
}

export function LensSwitcher({
  kind,
  onSwitch,
  dirty = false,
}: {
  /** The EFFECTIVE kind (saved def + draft overlay). */
  kind: ViewKind;
  onSwitch: (kind: ViewKind) => void;
  /** The lens diverges from the saved view — tint the pill border. */
  dirty?: boolean;
}) {
  return (
    <ControlPill<ViewKind>
      // The visible value ("Board") folded into the name, plus the control's
      // role — the pill itself carries no written label.
      ariaLabel={`Lens: ${KIND_LABELS[kind]}`}
      menuLabel="Lens"
      icon={<KindGlyph kind={kind} />}
      value={KIND_LABELS[kind]}
      options={VIEW_KINDS.map((k) => ({
        value: k,
        label: KIND_LABELS[k],
        glyph: <KindGlyph kind={k} />,
      }))}
      current={kind}
      onSelect={onSwitch}
      dirty={dirty}
    />
  );
}

/**
 * Options for an organize-by pill: the resolved fields (filtered by
 * `accept`), plus the current effective value even when it's not among them
 * (a legacy `lane_by` on an undeclared field must still show as selected,
 * not blank).
 */
function fieldOptions(
  fields: ResolvedField[],
  current: string | undefined,
  accept: (f: ResolvedField) => boolean,
): string[] {
  const names = fields.filter(accept).map((f) => f.name);
  if (current && !names.includes(current)) names.unshift(current);
  return names;
}

/**
 * The honest message when a view has nothing to organize by AND no single tag
 * to add a field to — a multi-tag or tagless query has no one schema to write
 * (`fields.ts:singleQueryTag`). Says what to DO, not just what's absent: an
 * unactionable control should still hand back the next move.
 */
const NO_PRIMARY_TAG_NOTE =
  "This view isn't scoped to one tag, so there's no schema to add a field to — add a single tag to the query, or open a tag's view.";

/**
 * The single "add a field" invitation the empty organize-by controls carry —
 * the whole on-ramp now. The app proposes NO field name or vocabulary of its
 * own (Aaron, 2026-07-25: "we don't really need to be opinionated on this");
 * it only NOTICES the view has nothing to organize by and hands the user
 * straight to the tag-schema editor, where THEY name the field. That dissolved
 * the name-collision hazard the old presets carried (we can't silently clobber
 * a field we never propose) and closed the schema-still-loading hole with it:
 * the invitation writes nothing — it opens an editor that reads the live schema
 * itself. `label`/`hint` are the caller's, so the board reads "…to group by"
 * and the calendar "…a date field" without naming an example field.
 */
function addFieldAction(label: string, hint: string, onAddField: () => void): ControlPillAction[] {
  return [{ key: "__add_field__", label, hint, onSelect: onAddField }];
}

/**
 * Date-typed fields already own the Calendar's By-date axis
 * (`DateFieldControl`) — the honest reason GROUP BY never lists them.
 */
const DATE_EXCLUDED_NOTE = "Date fields plot on the Calendar lens (By date) — not offered here.";

/**
 * A tint-dot option for one groupable field — the V2 stable-hue dot, same
 * value → same hue as everywhere else.
 */
function groupByOption(name: string, hint?: string) {
  return {
    value: name,
    hint,
    glyph: <span className={`tint-dot tint-${hueForEnumValue(name)}`} />,
  };
}

/**
 * Partition a view's resolved fields by GROUPING mechanics — from the
 * declared TYPE alone, never the field's name (the deleted
 * `field-presets.ts` rule: "we don't really need to be opinionated on
 * this"). `resolveControlKind` is the same type→kind dispatch
 * `FieldValueControl` uses to pick an editor, reused here to pick a menu
 * section:
 *
 *   enum   → `valueBearing` — a small, declared, inspectable value set.
 *            Good board lanes; the menu shows a preview of the values.
 *   date   → `dateFields` — excluded outright, not just deprioritized:
 *            they already own the Calendar's By-date axis.
 *   other  → everything else (string, number, boolean). Groups fine, but
 *            produces one column per DISTINCT value SEEN — a wall for free
 *            text or a per-note number. Named honestly, not hidden.
 */
function partitionGroupableFields(fields: ResolvedField[]): {
  valueBearing: ResolvedField[];
  other: ResolvedField[];
  dateFields: ResolvedField[];
} {
  const valueBearing: ResolvedField[] = [];
  const other: ResolvedField[] = [];
  const dateFields: ResolvedField[] = [];
  for (const f of fields) {
    const kind = resolveControlKind(f.schema);
    if (kind === "date") dateFields.push(f);
    else if (kind === "enum") valueBearing.push(f);
    else other.push(f);
  }
  return { valueBearing, other, dateFields };
}

/**
 * A dim preview of an enum field's own declared values — "seed · active ·
 * paused" — nothing invented, always the schema's own list; the row's CSS
 * `truncate` (not this function) handles the "…" when it doesn't fit.
 */
function enumPreview(schema: ResolvedField["schema"]): string {
  return (schema.enum ?? []).join(" · ");
}

/**
 * The note under a GROUP BY menu — the empty-state on-ramp (unchanged from
 * before this PR) PLUS the new type-exclusion honesty: when the tag has
 * fields but every one is date-typed, say so rather than falsely claiming
 * "no fields yet" (which the invitation would otherwise imply).
 */
function groupByNote(
  hasRows: boolean,
  dateFieldCount: number,
  createTag: string | null,
  noFieldsAtAll: boolean,
  canAddField: boolean,
): string | undefined {
  if (hasRows) return dateFieldCount > 0 ? DATE_EXCLUDED_NOTE : undefined;
  if (!createTag) return NO_PRIMARY_TAG_NOTE;
  if (canAddField)
    return `#${createTag} has no fields yet — add one to give this board its columns:`;
  if (!noFieldsAtAll) return DATE_EXCLUDED_NOTE;
  return undefined; // schema still loading (schemaReady false) — say nothing yet
}

/**
 * Board-only: which field groups the lanes. TYPE-SECTIONED (not every
 * resolved field is equally useful here): value-bearing fields (a declared
 * `enum`) come first with a preview of their values — good board lanes;
 * free-text/number fields follow under an honest "one column per value"
 * heading; date-typed fields are excluded outright (`DateFieldControl` owns
 * them) with a note explaining why. A current value naming a field this
 * menu doesn't offer — undeclared, or (since this PR) date-typed — still
 * renders as selected via an unheaded lead row, never vanishing.
 *
 * Zero groupable rows still renders — `[GROUP BY  — ▾]` — but it no longer
 * DEAD-ENDS there: when the view has a primary tag with genuinely no
 * fields at all, the menu invites the user to add one, opening the
 * tag-schema editor so they name it themselves. With no primary tag there
 * is nothing to add to, so the control says so instead. The invitation
 * waits for `schemaReady`: while the schema is still loading, `fields` is
 * empty too, and claiming "no fields yet" then would cry wolf on a tag that
 * does declare fields.
 */
export function GroupByControl({
  value,
  fields,
  onChange,
  dirty = false,
  createTag = null,
  schemaReady = true,
  onAddField,
}: {
  value: string | undefined;
  fields: ResolvedField[];
  onChange: (name: string) => void;
  dirty?: boolean;
  /** The view's single query tag — the schema an added field is written to. */
  createTag?: string | null;
  /** The primary tag's schema has actually answered (not mid-fetch) — gates
   * the "no fields yet" invitation so it never fires on an unresolved tag. */
  schemaReady?: boolean;
  /** Open the tag-schema editor to add a grouping field. Absent → no invite. */
  onAddField?: () => void;
}) {
  const { valueBearing, other, dateFields } = partitionGroupableFields(fields);
  const knownNames = new Set([...valueBearing, ...other].map((f) => f.name));
  // The legacy unshift, generalized: a current value naming a field this
  // menu doesn't offer — undeclared, OR (since this PR) date-typed — still
  // renders as selected, never vanishes.
  const legacyCurrent = value !== undefined && !knownNames.has(value) ? value : undefined;

  const sections: ControlPillSection[] = [];
  if (legacyCurrent !== undefined) {
    sections.push({ options: [groupByOption(legacyCurrent)] });
  }
  if (valueBearing.length > 0) {
    sections.push({
      heading: "Fields with values",
      options: valueBearing.map((f) => groupByOption(f.name, enumPreview(f.schema))),
    });
  }
  if (other.length > 0) {
    sections.push({
      heading: "Other fields · one column per value",
      options: other.map((f) => groupByOption(f.name)),
    });
  }

  const hasRows = sections.length > 0;
  const noFieldsAtAll = fields.length === 0;
  const canAddField = noFieldsAtAll && !!createTag && schemaReady && !!onAddField;

  return (
    <ControlPill
      label="Group by"
      menuLabel="Group by"
      value={value ?? "—"}
      sections={sections}
      current={value}
      onSelect={onChange}
      note={groupByNote(hasRows, dateFields.length, createTag, noFieldsAtAll, canAddField)}
      actions={
        canAddField
          ? addFieldAction(
              "Add a field to group by…",
              "You name it; give it values to get columns.",
              onAddField!,
            )
          : undefined
      }
      dirty={dirty}
    />
  );
}

/**
 * Calendar-only: which date-typed field places notes on days. With none
 * resolved the pill honestly reads `created` — that IS the axis in the
 * read-only createdAt mode (train F) — and picking a date-typed field from
 * the menu graduates the calendar to editable. When the tag declares NO
 * date-typed field at all, the empty menu invites the user to add one (in the
 * tag-schema editor, where they name it), so a calendar is never permanently
 * stuck read-only.
 */
export function DateFieldControl({
  value,
  fields,
  onChange,
  dirty = false,
  createTag = null,
  schemaReady = true,
  onAddField,
}: {
  value: string | undefined;
  fields: ResolvedField[];
  onChange: (name: string) => void;
  dirty?: boolean;
  /** The view's single query tag — the schema an added field is written to. */
  createTag?: string | null;
  /** The primary tag's schema has actually answered (not mid-fetch) — gates
   * the "no date field" invitation so it never fires on an unresolved tag. */
  schemaReady?: boolean;
  /** Open the tag-schema editor to add a date field. Absent → no invite. */
  onAddField?: () => void;
}) {
  const options = fieldOptions(fields, value, (f) => f.schema.type === "date");
  const canAddField = options.length === 0 && !!createTag && schemaReady && !!onAddField;
  return (
    <ControlPill
      label="By date"
      menuLabel="By date"
      value={value ?? "created"}
      options={options.map((name) => ({ value: name }))}
      current={value}
      onSelect={onChange}
      // Zero options implies `value === undefined` (a set value is always
      // unshifted into the options), so the createdAt line is honest in every
      // branch it appears in.
      note={
        options.length === 0 && canAddField
          ? `Showing by created date. #${createTag} has no date field — add one to plot and drag by it:`
          : value === undefined
            ? "Showing by created date"
            : undefined
      }
      actions={
        canAddField
          ? addFieldAction(
              "Add a date field…",
              "You name it; it holds a date on each note.",
              onAddField!,
            )
          : undefined
      }
      dirty={dirty}
    />
  );
}
