import { PillTrigger } from "@/components/views/ControlPill";
import { resolveControlKind } from "@/components/views/FieldValueControl";
import type { TagFieldSchema } from "@/lib/vault/types";
import type { ResolvedField } from "@/lib/views/fields";
import { useEffect, useState } from "react";

// The Fields control (views train C) — WHICH fields a view shows/edits, and
// in what ORDER. One field set per view (`resolveViewFields`): every lens
// renders the same resolved set — chips on list rows, board cards, gallery
// cards, calendar entries — so this control rides the config row for every
// kind, beside the LensSwitcher and the board/calendar selects.
//
// Checkboxes over the UNION of the primary tag's declared schema fields and
// the current effective set (a view's `fields` override can name a field the
// schema never declared — it must still be listed, or it could never be
// unchecked). Shown fields come first in their view order with up/down
// reorder buttons (no drag in a popover); hidden schema fields follow;
// checking one appends it to the end of the shown set. Every edit writes the
// full ordered list into the URL config draft (train B) — the "View
// modified" bar appears and Save/Revert govern persistence; this control
// carries no save machinery of its own.
//
// Minimum ONE field: the `fields` wire format can't express "show none" —
// an empty list decodes to `undefined` and degrades to the schema default
// (`schema.ts` decodeFieldsList) — so the last checked box disables with a
// small hint instead of drafting a state Save couldn't persist.
//
// Phone widths: the panel docks as a bottom sheet over a scrim (the
// NavSheet's pattern, scaled down); sm+ it anchors as a popover under the
// trigger (the FieldValueControl pattern).
//
// Every row also carries a TYPE glyph (`●` values, `📅` date, `Aa` text,
// `#` number) — from the schema TYPE alone via the same `resolveControlKind`
// dispatch `FieldValueControl` uses to pick an editor, never the field's
// name (the deleted `field-presets.ts` rule). Shown rows type themselves
// from their own `ResolvedField.schema`; hidden rows have no `ResolvedField`
// of their own, so they look their type up in `schemaFields`.

/**
 * The row's leading type glyph. `●` folds together enum AND boolean — both
 * are, by construction, a small fixed value set (declared or built-in),
 * unlike free text or a per-note number.
 */
function typeGlyph(schema: TagFieldSchema | undefined): string {
  switch (resolveControlKind(schema)) {
    case "enum":
    case "boolean":
      return "●";
    case "date":
      return "📅";
    case "number":
      return "#";
    default:
      return "Aa";
  }
}

export function FieldsControl({
  fields,
  schemaFields,
  onChange,
  dirty = false,
}: {
  /** The EFFECTIVE resolved set (saved def + draft overlay) — checked, in order. */
  fields: ResolvedField[];
  /** The primary tag's declared schema (name → type) — the union's other
   * half, and the type source for every row's glyph. */
  schemaFields: Record<string, TagFieldSchema>;
  /** Receives the full ordered list of shown fields after every edit. */
  onChange: (next: string[]) => void;
  /** The field set diverges from the saved view — tint the pill border. */
  dirty?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Escape closes (outside-tap lands on the backdrop below).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const shown = fields.map((f) => f.name);
  const hidden = Object.keys(schemaFields).filter((n) => !shown.includes(n));

  // Nothing to configure — no single-tag schema and no effective set (the
  // same silent posture as the sibling Group/Date selects with zero options).
  if (shown.length === 0 && hidden.length === 0) return null;

  const atMinimum = shown.length === 1;

  // Guarded in code as well as by the checkbox's `disabled` — the minimum-one
  // invariant must hold even if an event slips through the attribute.
  const hide = (name: string) => {
    if (atMinimum) return;
    onChange(shown.filter((n) => n !== name));
  };
  const show = (name: string) => onChange([...shown, name]);
  const move = (index: number, delta: -1 | 1) => {
    const next = [...shown];
    const [name] = next.splice(index, 1);
    next.splice(index + delta, 0, name);
    onChange(next);
  };

  return (
    <div className="relative">
      {/* The shared pill shape (polish V3): [FIELDS  4 ▾], count = shown
          fields. The panel below stays as-is — only the trigger changed. */}
      <PillTrigger
        label="Fields"
        value={String(shown.length)}
        haspopup="dialog"
        open={open}
        dirty={dirty}
        onClick={() => setOpen((o) => !o)}
      />
      {open ? (
        <>
          {/* Outside-tap backdrop — a visible scrim under the phone sheet,
              invisible under the desktop popover. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="enter-fade fixed inset-0 z-30 cursor-default bg-black/40 sm:bg-transparent"
          />
          {/* biome-ignore lint/a11y/useSemanticElements: a native <dialog> needs imperative showModal(); this is a lightweight declarative popover. */}
          <div
            role="dialog"
            aria-label="Fields"
            className="card enter-rise fixed inset-x-0 bottom-0 z-40 max-h-[70dvh] overflow-y-auto rounded-b-none p-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] shadow-lift sm:absolute sm:top-full sm:right-auto sm:bottom-auto sm:mt-1 sm:max-h-80 sm:w-60 sm:rounded-b-[var(--radius-2xl)] sm:pb-1.5"
          >
            <p className="eyebrow px-2 pt-1.5 pb-1">Fields</p>
            <ul className="flex flex-col gap-0.5">
              {fields.map((f, i) => (
                <li
                  key={f.name}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-bg-soft"
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm text-fg">
                    <input
                      type="checkbox"
                      checked
                      disabled={atMinimum}
                      onChange={() => hide(f.name)}
                    />
                    <span
                      aria-hidden="true"
                      className="w-4 flex-none text-center text-2xs text-fg-dim"
                    >
                      {typeGlyph(f.schema)}
                    </span>
                    <span className="truncate">{f.name}</span>
                  </label>
                  <button
                    type="button"
                    aria-label={`Move ${f.name} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="focus-ring rounded px-1.5 py-0.5 text-sm text-fg-muted hover:bg-bg-soft hover:text-fg disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${f.name} down`}
                    disabled={i === shown.length - 1}
                    onClick={() => move(i, 1)}
                    className="focus-ring rounded px-1.5 py-0.5 text-sm text-fg-muted hover:bg-bg-soft hover:text-fg disabled:opacity-30"
                  >
                    ↓
                  </button>
                </li>
              ))}
              {hidden.map((name) => (
                <li
                  key={name}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-bg-soft"
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm text-fg-muted">
                    <input type="checkbox" checked={false} onChange={() => show(name)} />
                    <span
                      aria-hidden="true"
                      className="w-4 flex-none text-center text-2xs text-fg-dim"
                    >
                      {typeGlyph(schemaFields[name])}
                    </span>
                    <span className="truncate">{name}</span>
                  </label>
                </li>
              ))}
            </ul>
            {atMinimum ? (
              <p className="px-2 pt-1.5 pb-1 text-xs text-fg-dim">Views show at least one field.</p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
