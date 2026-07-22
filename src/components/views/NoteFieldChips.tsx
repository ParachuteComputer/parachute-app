import { FieldValueControl } from "@/components/views/FieldValueControl";
import { displayTitle } from "@/lib/note-title";
import { useToastStore } from "@/lib/toast/store";
import type { Note } from "@/lib/vault/types";
import type { ResolvedField } from "@/lib/views/fields";
import { type ViewFieldValue, useViewFieldMutation } from "@/lib/views/mutate";
import type { QueryKey } from "@tanstack/react-query";

/** A note's field value narrowed to what a control can show/edit — a non-scalar
 * (array/object) reads as "not set" rather than "[object Object]". */
function scalarValue(value: unknown): ViewFieldValue {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean" ? (value as ViewFieldValue) : null;
}

// The field-chips band (view-experience wave, Part C) — the first VISIBLE
// slice of tag-schema-driven fields. On a card it renders the view's resolved
// fields (Part B) as small chips, each showing the note's current value;
// tapping a chip opens `FieldValueControl` to edit that field IN PLACE. Every
// write goes through the shared `useViewFieldMutation` primitive (optimistic
// against the view's result cache, offline-capable, rolls back on error,
// preserves the value's type). One mutation per note serves every chip.
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
  const pushToast = useToastStore((s) => s.push);
  const { move, isPending } = useViewFieldMutation(note.id, viewResultsKey);

  const shown = omit && omit.length > 0 ? fields.filter((f) => !omit.includes(f.name)) : fields;
  if (shown.length === 0) return null;

  const commit = async (field: string, value: ViewFieldValue) => {
    try {
      await move(field, value, note.updatedAt);
    } catch (err) {
      pushToast(
        `Couldn't update ${field} on "${displayTitle(note).text}": ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error",
      );
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5 pt-0.5">
      {shown.map((f) => (
        <span
          key={f.name}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-soft/60 py-0.5 pl-2 pr-1 text-[0.6875rem] leading-none"
        >
          <span className="text-fg-dim">{f.name}</span>
          <FieldValueControl
            field={f.name}
            schema={f.schema}
            value={scalarValue(note.metadata?.[f.name])}
            disabled={isPending}
            includeClear
            onCommit={(value) => void commit(f.name, value)}
          />
        </span>
      ))}
    </div>
  );
}
