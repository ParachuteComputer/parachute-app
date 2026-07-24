import { IconCalendar, IconColumns, IconGrid, IconNotes } from "@/components/NavIcons";
import type { ResolvedField } from "@/lib/views/fields";
import { VIEW_KINDS, type ViewKind } from "@/lib/views/schema";

// The in-place lens switcher (views train B) — switch how the SAME result
// set renders (list/board/calendar/gallery; table arrives in train D).
// Writing `kind` into the URL config draft is lossless by construction:
// `useViewResults`' cache key excludes `kind`, so switching lens re-renders
// the one cached result set without a refetch. Board-only Group and
// calendar-only Date-field selects ride alongside, writing the same draft.

const KIND_LABELS: Record<ViewKind, string> = {
  list: "List",
  board: "Board",
  calendar: "Calendar",
  gallery: "Gallery",
};

function KindGlyph({ kind }: { kind: ViewKind }) {
  switch (kind) {
    case "board":
      return <IconColumns width={14} height={14} />;
    case "calendar":
      return <IconCalendar width={14} height={14} />;
    case "gallery":
      return <IconGrid width={14} height={14} />;
    default:
      return <IconNotes width={14} height={14} />;
  }
}

export function LensSwitcher({
  kind,
  onSwitch,
}: {
  /** The EFFECTIVE kind (saved def + draft overlay). */
  kind: ViewKind;
  onSwitch: (kind: ViewKind) => void;
}) {
  return (
    <fieldset
      aria-label="Lens"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-bg-soft p-0.5"
    >
      {VIEW_KINDS.map((k) => {
        const active = k === kind;
        return (
          <button
            key={k}
            type="button"
            aria-pressed={active}
            aria-label={KIND_LABELS[k]}
            title={KIND_LABELS[k]}
            onClick={() => onSwitch(k)}
            className={`focus-ring inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
              active ? "bg-accent text-on-accent" : "text-fg-muted hover:bg-bg/60 hover:text-fg"
            }`}
          >
            <KindGlyph kind={k} />
            {/* Phone widths: glyph-only (aria-label still names the lens). */}
            <span className="hidden sm:inline">{KIND_LABELS[k]}</span>
          </button>
        );
      })}
    </fieldset>
  );
}

/**
 * Options for a field select: the resolved fields (filtered by `accept`),
 * plus the current effective value even when it's not among them (a legacy
 * `lane_by` on an undeclared field must still show as selected, not blank).
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

function FieldSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: string[];
  onChange: (name: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
      {label}
      <select
        value={value ?? ""}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
        className="rounded-full border border-border bg-bg/40 px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none"
      >
        {value === undefined ? <option value="">—</option> : null}
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Board-only: which field groups the lanes. Any resolved field can group. */
export function GroupByControl({
  value,
  fields,
  onChange,
}: {
  value: string | undefined;
  fields: ResolvedField[];
  onChange: (name: string) => void;
}) {
  return (
    <FieldSelect
      label="Group by"
      value={value}
      options={fieldOptions(fields, value, () => true)}
      onChange={onChange}
    />
  );
}

/** Calendar-only: which date-typed field places notes on days. */
export function DateFieldControl({
  value,
  fields,
  onChange,
}: {
  value: string | undefined;
  fields: ResolvedField[];
  onChange: (name: string) => void;
}) {
  return (
    <FieldSelect
      label="Date field"
      value={value}
      options={fieldOptions(fields, value, (f) => f.schema.type === "date")}
      onChange={onChange}
    />
  );
}
