import { type ReactNode, useEffect, useState } from "react";

// The shared views-row control primitive (polish V3) — ONE pill shape for the
// lens switcher, the organize-by controls, and the Fields trigger, so the
// controls row reads as a single calm system: `[icon?] [LABEL] [value] ▾`.
// The LABEL sits in the eyebrow register (uppercase micro-label); the value
// carries the weight. Opening follows the app's two established postures:
//
//   sm+   — an anchored popover under the trigger (card + shadow-lift +
//           enter-rise over an invisible outside-tap backdrop, the
//           FieldValueControl pattern);
//   phone — the FieldsControl bottom sheet VERBATIM: a z-30 scrim under a
//           z-40 panel docked to the screen bottom with safe-area padding.
//           That tier clears the z-20 save bar / tab bar by construction.
//
// `enter-rise`/`enter-fade` are already reduced-motion-gated in
// styles/index.css — nothing to re-gate here. Presentational throughout: the
// pill renders + reports a selection; drafts, saves, and wire shapes belong
// to the caller.

/** One row in the pill's menu. */
export interface ControlPillOption<V extends string = string> {
  value: V;
  /** Visible row label — defaults to `value`. */
  label?: string;
  /** Decorative leading glyph or tint dot. */
  glyph?: ReactNode;
}

/**
 * A COMMAND row — a menu item that DOES something rather than selecting an
 * existing value (the one-click field on-ramp's "add a `status` field"). Kept
 * distinct from `options` in both data and semantics: `menuitem`, not
 * `menuitemradio`, because nothing about it is checked-or-not. Rendered below
 * the options + note, so the pill still reads "here's what you can pick"
 * before "here's what you can make."
 */
export interface ControlPillAction {
  /** React key + stable test handle. */
  key: string;
  label: string;
  /** A dim second line — the preview of what the action produces. */
  hint?: string;
  glyph?: ReactNode;
  onSelect: () => void;
}

/**
 * The dirty border tint — accent folded into the border, a quiet "this
 * control diverges from the saved view" alongside the View-modified bar.
 */
const DIRTY_BORDER = "border-[color-mix(in_srgb,var(--color-accent)_40%,var(--color-border))]";

/**
 * The pill TRIGGER alone — exported for controls that own their panel
 * (FieldsControl keeps its checkbox sheet and adopts only the pill shape).
 */
export function PillTrigger({
  label,
  value,
  icon,
  ariaLabel,
  haspopup = "menu",
  open,
  dirty = false,
  onClick,
}: {
  /** The eyebrow-register label (`GROUP BY`); omit for identity pills (the lens). */
  label?: string;
  /** The current value — the pill's weight-carrying text. */
  value: string;
  /** Optional leading icon (the lens's kind glyph). */
  icon?: ReactNode;
  /** Explicit accessible name; omitted, the visible text names the trigger. */
  ariaLabel?: string;
  haspopup?: "menu" | "dialog";
  open: boolean;
  /** Tint the border toward accent — this control diverges from the saved view. */
  dirty?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-haspopup={haspopup}
      aria-expanded={open}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`focus-ring inline-flex min-h-8 items-center gap-1.5 rounded-full border bg-card px-3 py-1 transition-colors duration-(--dur-quick) ease-out hover:border-accent/50 ${
        dirty ? DIRTY_BORDER : "border-border"
      }`}
    >
      {icon ? (
        <span aria-hidden="true" className="flex-none text-fg-muted">
          {icon}
        </span>
      ) : null}
      {label ? (
        <span className="text-2xs uppercase tracking-[0.08em] text-fg-dim">{label}</span>
      ) : null}
      <span className="text-xs font-medium text-fg">{value}</span>
      <span aria-hidden="true" className="text-2xs text-fg-dim">
        ▾
      </span>
    </button>
  );
}

export function ControlPill<V extends string>({
  label,
  value,
  icon,
  ariaLabel,
  menuLabel,
  options,
  current,
  onSelect,
  note,
  actions,
  busy = false,
  dirty = false,
}: {
  /** The eyebrow-register trigger label; omit for identity pills (the lens). */
  label?: string;
  /** The current value's display text. */
  value: string;
  icon?: ReactNode;
  /** Explicit trigger name; omitted, the visible text names it. */
  ariaLabel?: string;
  /** Names the menu, and heads the phone sheet as its eyebrow. */
  menuLabel: string;
  options: ControlPillOption<V>[];
  /** The current option's value — aria-checked + the trailing ✓. */
  current?: V;
  onSelect: (value: V) => void;
  /** A non-interactive dim line under the options — the empty states' explanation. */
  note?: string;
  /** Command rows under the note — offers to CREATE what the options lack. */
  actions?: ControlPillAction[];
  /** An action is in flight — every command row disables until it resolves. */
  busy?: boolean;
  dirty?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Escape closes (outside-tap lands on the backdrop below) — the
  // FieldsControl pattern.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const pick = (v: V) => {
    setOpen(false);
    onSelect(v);
  };

  // Command rows close the menu the same way picking a value does — the
  // result (new lanes, a re-faced pill) is the confirmation, not a menu that
  // lingers over the thing it just changed.
  const run = (action: ControlPillAction) => {
    setOpen(false);
    action.onSelect();
  };

  return (
    <div className="relative">
      <PillTrigger
        label={label}
        value={value}
        icon={icon}
        ariaLabel={ariaLabel}
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
          <div
            role="menu"
            aria-label={menuLabel}
            className="card enter-rise fixed inset-x-0 bottom-0 z-40 max-h-[70dvh] overflow-y-auto rounded-b-none p-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] shadow-lift sm:absolute sm:top-full sm:right-auto sm:bottom-auto sm:mt-1 sm:max-h-80 sm:w-56 sm:rounded-b-[var(--radius-2xl)] sm:pb-1.5"
          >
            {/* Visual heading only — the menu's aria-label already names it. */}
            <p aria-hidden="true" className="eyebrow px-2 pt-1.5 pb-1">
              {menuLabel}
            </p>
            {options.map((opt) => {
              const checked = opt.value === current;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  onClick={() => pick(opt.value)}
                  className={`focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-bg-soft ${
                    checked ? "text-fg" : "text-fg-muted"
                  }`}
                >
                  {opt.glyph ? (
                    <span aria-hidden="true" className="flex-none">
                      {opt.glyph}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{opt.label ?? opt.value}</span>
                  {checked ? (
                    <span aria-hidden="true" className="text-accent">
                      ✓
                    </span>
                  ) : null}
                </button>
              );
            })}
            {note ? <p className="px-2 pt-1.5 pb-1 text-xs text-fg-dim">{note}</p> : null}
            {actions && actions.length > 0 ? (
              <div
                className={
                  // A hairline only when real options sit above — the empty
                  // state's note already separates them.
                  options.length > 0 ? "mt-1 border-t border-border-light pt-1" : undefined
                }
              >
                {actions.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => run(action)}
                    className="focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-fg-muted hover:bg-bg-soft disabled:opacity-50"
                  >
                    {action.glyph ? (
                      <span aria-hidden="true" className="flex-none">
                        {action.glyph}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-fg">{action.label}</span>
                      {action.hint ? (
                        <span className="block truncate text-2xs text-fg-dim">{action.hint}</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
