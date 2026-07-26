import { IconCalendar, IconColumns, IconGrid, IconNotes, IconTable } from "@/components/NavIcons";
import { ControlPill, type ControlPillAction } from "@/components/views/ControlPill";
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
 * Board-only: which field groups the lanes. Any resolved field can group.
 * Zero resolvable fields still renders — `[GROUP BY  — ▾]` — but it no longer
 * DEAD-ENDS there: when the view has a primary tag, the menu invites the user
 * to add a field to group by, opening the tag-schema editor so they name it
 * themselves. "This view's tag has no schema fields" was, for almost every
 * real user, the end of the road. With no primary tag there is nothing to add
 * to, so the control says so — and says what to do instead. The invitation
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
  const options = fieldOptions(fields, value, () => true);
  const canAddField = options.length === 0 && !!createTag && schemaReady && !!onAddField;
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
          : !createTag
            ? NO_PRIMARY_TAG_NOTE
            : canAddField
              ? `#${createTag} has no fields yet — add one to give this board its columns:`
              : undefined
      }
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
