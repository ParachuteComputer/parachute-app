import { FieldValueControl, resolveControlKind } from "@/components/views/FieldValueControl";
import { hueForEnumValue } from "@/lib/hue/hue";
import type { Note } from "@/lib/vault/types";
import type { ResolvedField } from "@/lib/views/fields";
import type { ViewFieldValue } from "@/lib/views/mutate";
import { useViewFieldWrite } from "@/lib/views/write";
import type { QueryKey } from "@tanstack/react-query";

/** A note's field value narrowed to what a control can show/edit — a non-scalar
 * (array/object) reads as "not set" rather than "[object Object]". Shared with
 * the table lens's cells (train D), which read note metadata the same way. */
export function scalarValue(value: unknown): ViewFieldValue {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean" ? (value as ViewFieldValue) : null;
}

// The field-chips band (view-experience wave, Part C) — the first VISIBLE
// slice of tag-schema-driven fields. On a card it renders the view's resolved
// fields (Part B) as small chips, each showing the note's current value;
// tapping a chip opens `FieldValueControl` to edit that field IN PLACE. Every
// write goes through the shared `useViewFieldWrite` hook (views train A) —
// the `useViewFieldMutation` primitive (optimistic against the view's result
// cache, offline-capable, rolls back on error, preserves the value's type)
// plus the microconfirmation (success toast + card flash on resolve, error
// toast on reject). One write hook per note serves every chip.
//
// The band lives OUTSIDE the card's navigating anchor (a button can't nest in
// an `<a>`), passed to `NoteCard`'s `footer` slot. It renders nothing when no
// fields resolve — the card looks exactly as it did before.
export function NoteFieldChips({
  note,
  fields,
  viewResultsKey,
  omit,
}: {
  note: Note;
  fields: ResolvedField[];
  /** The `useViewResults` cache key — the optimistic write target. */
  viewResultsKey: QueryKey;
  /** Field names to leave out (e.g. a board omits its own lane field). */
  omit?: string[];
}) {
  const { write, isPending } = useViewFieldWrite(note, viewResultsKey);

  const shown = omit && omit.length > 0 ? fields.filter((f) => !omit.includes(f.name)) : fields;
  if (shown.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5 pt-0.5">
      {shown.map((f) => {
        const value = scalarValue(note.metadata?.[f.name]);
        // Enum tinting (polish V2): a set enum value washes its chip with the
        // value's stable hue + a leading swatch dot. The tinted chip drops the
        // neutral bg/border utilities — `.chip-tinted` owns those (utilities
        // would win the cascade over the components-layer tint otherwise).
        // Text stays fg/fg-dim; the hue never carries the meaning alone.
        const tint =
          resolveControlKind(f.schema) === "enum" && value !== null && value !== ""
            ? hueForEnumValue(String(value))
            : null;
        return (
          <span
            key={f.name}
            className={`inline-flex items-center gap-1 rounded-full border py-0.5 pl-2 pr-1 text-[0.6875rem] leading-none ${
              tint ? `chip-tinted tint-${tint}` : "border-border bg-bg-soft/60"
            }`}
          >
            {tint ? <span aria-hidden="true" className="tint-dot" /> : null}
            <span className="text-fg-dim">{f.name}</span>
            <FieldValueControl
              field={f.name}
              schema={f.schema}
              value={value}
              disabled={isPending}
              includeClear
              onCommit={(value) => void write(f.name, value)}
            />
          </span>
        );
      })}
    </div>
  );
}
