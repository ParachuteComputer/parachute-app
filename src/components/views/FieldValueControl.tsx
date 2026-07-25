import { FieldDisplay, isUrlValue } from "@/components/views/FieldDisplay";
import type { TagFieldSchema } from "@/lib/vault/types";
import type { ViewFieldValue } from "@/lib/views/mutate";
import { type ReactNode, useState } from "react";

// The shared field editor (view-experience wave, Part A.2) — the general
// case of the board's tap-to-move menu. One control drives every field write
// in a view, dispatching on the tag schema's declared field TYPE:
//
//   enum    → a menu of the allowed values (the board's move menu is this case)
//   date    → a native date picker
//   boolean → a toggle
//   string  → an inline text input
//   number  → an inline number input
//
// It is PRESENTATIONAL: it renders the value + the right editor and calls
// `onCommit(value)` with the ORIGINAL type preserved (a number stays a
// number) — `null` clears the field (the vault's null-as-delete). The caller
// wires `onCommit` to the shared `useViewFieldMutation` primitive (optimistic,
// offline, type-preserving); this component never touches the network.

/** One selectable value in the enum/menu case. `null` = clear/none. */
export interface FieldControlOption {
  value: ViewFieldValue;
  label: string;
  /** Render dim — the "none"/uncategorized option. */
  muted?: boolean;
}

export type FieldControlKind = "enum" | "date" | "boolean" | "string" | "number";

/** Which control edits a field: explicit options ⇒ enum, else the schema `type`. */
export function resolveControlKind(
  schema: TagFieldSchema | null | undefined,
  options?: FieldControlOption[],
): FieldControlKind {
  if (options && options.length > 0) return "enum";
  if (schema?.enum && schema.enum.length > 0) return "enum";
  switch (schema?.type) {
    case "date":
      return "date";
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    default:
      return "string";
  }
}

const DEFAULT_TRIGGER_CLASS =
  "focus-ring inline-flex max-w-[9rem] items-center rounded px-1 py-0.5 text-[0.6875rem] hover:text-accent disabled:opacity-50";

/** The date portion (`YYYY-MM-DD`) of a stored value, for a native date input. */
function dateInputValue(value: ViewFieldValue): string {
  if (typeof value !== "string") return "";
  const m = value.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : "";
}

export function FieldValueControl({
  field,
  schema,
  value,
  onCommit,
  disabled = false,
  options,
  includeClear = false,
  trigger,
}: {
  field: string;
  schema?: TagFieldSchema | null;
  value: ViewFieldValue;
  onCommit: (value: ViewFieldValue) => void;
  disabled?: boolean;
  /** Explicit enum options — the board passes its target lanes here. */
  options?: FieldControlOption[];
  /** Add a muted "Clear" option (writes null) when the field currently has a value. */
  includeClear?: boolean;
  /** Customize the opener — the board overrides it to a "Move" button. */
  trigger?: { label?: ReactNode; ariaLabel?: string; className?: string };
}) {
  const kind = resolveControlKind(schema, options);
  const [open, setOpen] = useState(false);

  const isEmpty = value === null || value === undefined || value === "";
  // Typed rendering (polish V1): the trigger IS the field's display — every
  // read of a field value in a view funnels through here.
  const triggerLabel = trigger?.label ?? <FieldDisplay value={value} schema={schema} />;
  const ariaLabel = trigger?.ariaLabel ?? `Edit ${field}`;
  const triggerClass =
    trigger?.className ??
    `${DEFAULT_TRIGGER_CLASS} ${isEmpty && !trigger?.label ? "text-fg-dim" : "text-fg"}`;

  // boolean — a direct toggle, no popover (unset/false → true → false).
  if (kind === "boolean") {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => onCommit(!(value === true))}
        className={triggerClass}
      >
        {triggerLabel}
      </button>
    );
  }

  const enumOptions: FieldControlOption[] =
    kind === "enum" ? (options ?? (schema?.enum ?? []).map((v) => ({ value: v, label: v }))) : [];
  const showClear = includeClear && !isEmpty;

  const commit = (next: ViewFieldValue) => {
    setOpen(false);
    onCommit(next);
  };

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup={kind === "enum" ? "menu" : "dialog"}
        aria-expanded={open}
        aria-label={ariaLabel}
        title={trigger?.label ? undefined : `Edit ${field}`}
        onClick={() => setOpen((o) => !o)}
        className={triggerClass}
      >
        {triggerLabel}
      </button>
      {open ? (
        <>
          {/* Outside-tap backdrop — closes the control, invisible. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          {kind === "enum" ? (
            <div
              role="menu"
              aria-label={ariaLabel}
              className="card absolute right-0 z-20 mt-1 flex min-w-[10rem] flex-col gap-0.5 p-1 shadow-lg"
            >
              {enumOptions.map((opt) => (
                <button
                  key={opt.value === null ? "__clear__" : String(opt.value)}
                  type="button"
                  role="menuitem"
                  onClick={() => commit(opt.value)}
                  className={`focus-ring rounded px-2 py-1.5 text-left text-sm hover:bg-bg-soft ${
                    opt.muted ? "text-fg-dim" : "text-fg"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              {showClear ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => commit(null)}
                  className="focus-ring rounded px-2 py-1.5 text-left text-sm text-fg-dim hover:bg-bg-soft"
                >
                  Clear
                </button>
              ) : null}
            </div>
          ) : (
            <InputPopover
              kind={kind}
              value={value}
              ariaLabel={ariaLabel}
              onCommit={commit}
              onCancel={() => setOpen(false)}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

// The date / string / number editor: a small popover with a native input.
// Enter (or the field's own commit) writes; Escape / outside-tap cancels;
// clearing to empty writes `null` (null-as-delete).
function InputPopover({
  kind,
  value,
  ariaLabel,
  onCommit,
  onCancel,
}: {
  kind: Exclude<FieldControlKind, "enum" | "boolean">;
  value: ViewFieldValue;
  ariaLabel: string;
  onCommit: (value: ViewFieldValue) => void;
  onCancel: () => void;
}) {
  const initial =
    kind === "date"
      ? dateInputValue(value)
      : value === null || value === undefined
        ? ""
        : String(value);
  const [draft, setDraft] = useState(initial);

  const commitDraft = () => {
    const raw = draft.trim();
    if (raw === "") return onCommit(null);
    if (kind === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) return onCancel();
      return onCommit(n);
    }
    onCommit(raw);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a native <dialog> needs imperative open; this is a lightweight declarative popover.
    <div
      role="dialog"
      aria-label={ariaLabel}
      className="card absolute right-0 z-20 mt-1 flex min-w-[10rem] items-center gap-1 p-1 shadow-lg"
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: a just-opened edit popover should take the caret.
        autoFocus
        type={kind === "date" ? "date" : kind === "number" ? "number" : "text"}
        value={draft}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitDraft();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="w-full rounded border border-border bg-bg/40 px-1.5 py-1 text-xs text-fg focus:border-accent focus:outline-none"
      />
      <button
        type="button"
        onClick={commitDraft}
        aria-label="Save"
        className="focus-ring rounded px-1.5 py-1 text-xs text-accent hover:bg-bg-soft"
      >
        ✓
      </button>
      {isUrlValue(value) ? (
        // The trigger stays one-door (tap = edit); THIS is where a URL value
        // actually opens — beside the commit, on the committed value.
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open link"
          title="Open link"
          className="focus-ring rounded px-1.5 py-1 text-xs text-accent hover:bg-bg-soft"
        >
          ↗
        </a>
      ) : null}
    </div>
  );
}
