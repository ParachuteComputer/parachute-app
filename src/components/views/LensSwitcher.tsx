import { IconCalendar, IconColumns, IconGrid, IconNotes, IconTable } from "@/components/NavIcons";
import { ControlPill, type ControlPillAction } from "@/components/views/ControlPill";
import { hueForEnumValue } from "@/lib/hue/hue";
import { DATE_PRESETS, type FieldPreset, GROUP_BY_PRESETS } from "@/lib/views/field-presets";
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
 * Turn field presets into the pill's command rows, plus the quiet
 * "Something else…" escape to the full tag-schema editor. Shared by both
 * organize-by controls so the on-ramp reads identically on a board and a
 * calendar.
 *
 * A preset whose `name` the tag ALREADY declares is dropped — regardless of
 * that field's type. The on-ramp's write is a merge-on-write tag PUT
 * (`{ fields: { [name]: … } }`), which the vault merges at the field-KEY level
 * (`{ ...existing.fields, ...body.fields }`, identical on both doors) — so
 * offering `due` on a tag that already declares `due` as a string would
 * SILENTLY REPLACE the user's existing definition, not add to it. The on-ramp
 * only ever ADDS a field; when the name is taken, "Something else…" is the
 * honest path (rename or redefine deliberately in the tag editor).
 */
function createActions(
  presets: readonly FieldPreset[],
  existingFieldNames: readonly string[],
  onCreateField: (preset: FieldPreset) => void,
  onCustomField: () => void,
): ControlPillAction[] {
  const taken = new Set(existingFieldNames);
  return [
    ...presets
      .filter((preset) => !taken.has(preset.name))
      .map((preset) => ({
        key: preset.name,
        label: `Add a ${preset.label} field`,
        hint: preset.hint,
        glyph: <span className={`tint-dot tint-${hueForEnumValue(preset.name)}`} />,
        onSelect: () => onCreateField(preset),
      })),
    {
      key: "__custom__",
      label: "Something else…",
      hint: "Name it in the tag editor",
      onSelect: onCustomField,
    },
  ];
}

/**
 * Board-only: which field groups the lanes. Any resolved field can group.
 * Zero resolvable fields still renders — `[GROUP BY  — ▾]` — but it no longer
 * DEAD-ENDS there: when the view has a primary tag, the menu offers to create
 * the missing field in one click (`field-presets.ts`), because "this view's
 * tag has no schema fields" was, for almost every real user, the end of the
 * road. With no primary tag there is nothing to write to, so the control says
 * so — and says what to do instead.
 */
export function GroupByControl({
  value,
  fields,
  onChange,
  dirty = false,
  createTag = null,
  existingFieldNames = [],
  onCreateField,
  onCustomField,
  creating = false,
}: {
  value: string | undefined;
  fields: ResolvedField[];
  onChange: (name: string) => void;
  dirty?: boolean;
  /** The view's single query tag — the schema a created field is written to. */
  createTag?: string | null;
  /** Every field name the tag already declares — a preset that would REDEFINE
   * one of them is suppressed (the on-ramp only ever adds; see createActions). */
  existingFieldNames?: readonly string[];
  onCreateField?: (preset: FieldPreset) => void;
  onCustomField?: () => void;
  /** A field creation is in flight. */
  creating?: boolean;
}) {
  const options = fieldOptions(fields, value, () => true);
  const canCreate = options.length === 0 && !!createTag && !!onCreateField && !!onCustomField;
  return (
    <ControlPill
      label="Group by"
      menuLabel="Group by"
      value={value ?? "—"}
      options={options.map((name) => ({
        value: name,
        // The V2 stable-hue dot — same value → same hue as everywhere else.
        glyph: <span className={`tint-dot tint-${hueForEnumValue(name)}`} />,
      }))}
      current={value}
      onSelect={onChange}
      note={
        options.length > 0
          ? undefined
          : canCreate
            ? `#${createTag} has no fields yet. Add one and this board gets its lanes:`
            : NO_PRIMARY_TAG_NOTE
      }
      actions={
        canCreate
          ? createActions(GROUP_BY_PRESETS, existingFieldNames, onCreateField!, onCustomField!)
          : undefined
      }
      busy={creating}
      dirty={dirty}
    />
  );
}

/**
 * Calendar-only: which date-typed field places notes on days. With none
 * resolved the pill honestly reads `created` — that IS the axis in the
 * read-only createdAt mode (train F) — and picking a date-typed field from
 * the menu graduates the calendar to editable. When the tag declares NO
 * date-typed field at all, the same one-click on-ramp offers to create one,
 * so a calendar is never permanently stuck read-only.
 */
export function DateFieldControl({
  value,
  fields,
  onChange,
  dirty = false,
  createTag = null,
  existingFieldNames = [],
  onCreateField,
  onCustomField,
  creating = false,
}: {
  value: string | undefined;
  fields: ResolvedField[];
  onChange: (name: string) => void;
  dirty?: boolean;
  /** The view's single query tag — the schema a created field is written to. */
  createTag?: string | null;
  /** Every field name the tag already declares. A `due` the tag declares as a
   * NON-date type isn't in `options` (only date-typed fields are), so without
   * this the on-ramp would offer `due` and its merge-write would clobber the
   * user's string `due`. Suppressing by name closes that hole. */
  existingFieldNames?: readonly string[];
  onCreateField?: (preset: FieldPreset) => void;
  onCustomField?: () => void;
  /** A field creation is in flight. */
  creating?: boolean;
}) {
  const options = fieldOptions(fields, value, (f) => f.schema.type === "date");
  const canCreate = options.length === 0 && !!createTag && !!onCreateField && !!onCustomField;
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
        options.length === 0 && canCreate
          ? `Showing by created date. #${createTag} has no date field — add one to plot and drag by it:`
          : value === undefined
            ? "Showing by created date"
            : undefined
      }
      actions={
        canCreate
          ? createActions(DATE_PRESETS, existingFieldNames, onCreateField!, onCustomField!)
          : undefined
      }
      busy={creating}
      dirty={dirty}
    />
  );
}
