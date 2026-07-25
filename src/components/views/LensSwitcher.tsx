import { IconCalendar, IconColumns, IconGrid, IconNotes, IconTable } from "@/components/NavIcons";
import { ControlPill } from "@/components/views/ControlPill";
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
 * Board-only: which field groups the lanes. Any resolved field can group.
 * Zero resolvable fields still renders — `[GROUP BY  — ▾]` with one dim
 * explanatory line — never a vanished control.
 */
export function GroupByControl({
  value,
  fields,
  onChange,
  dirty = false,
}: {
  value: string | undefined;
  fields: ResolvedField[];
  onChange: (name: string) => void;
  dirty?: boolean;
}) {
  const options = fieldOptions(fields, value, () => true);
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
        options.length === 0
          ? "No fields to group by — this view's tag has no schema fields."
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
 * the menu graduates the calendar to editable.
 */
export function DateFieldControl({
  value,
  fields,
  onChange,
  dirty = false,
}: {
  value: string | undefined;
  fields: ResolvedField[];
  onChange: (name: string) => void;
  dirty?: boolean;
}) {
  const options = fieldOptions(fields, value, (f) => f.schema.type === "date");
  return (
    <ControlPill
      label="By date"
      menuLabel="By date"
      value={value ?? "created"}
      options={options.map((name) => ({ value: name }))}
      current={value}
      onSelect={onChange}
      note={value === undefined ? "Showing by created date" : undefined}
      dirty={dirty}
    />
  );
}
