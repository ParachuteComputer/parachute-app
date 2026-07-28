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
  /** A dim trailing preview on the SAME row (e.g. an enum field's declared
   * values) — context for this one option, not a second label. */
  hint?: string;
}

/**
 * A headed GROUP of option rows — generic grouping, not a GroupBy-specific
 * shape: any caller can section its options under an eyebrow heading (which
 * may itself carry a brief mechanical caveat, e.g. "Other fields · one
 * column per value"). Omit `heading` for an unheaded lead group — how a
 * single row that fits no group (the legacy-value unshift) sits above
 * everything else. Passing `sections` to `ControlPill` renders grouped;
 * the flat `options` prop is ignored when `sections` is given.
 */
export interface ControlPillSection<V extends string = string> {
  heading?: string;
  options: ControlPillOption<V>[];
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
  sections,
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
  /** Flat option rows. Ignored when `sections` is given. */
  options?: ControlPillOption<V>[];
  /** Grouped option rows under optional headings — takes precedence over
   * `options` when both are given. */
  sections?: ControlPillSection<V>[];
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

  // One row renderer for both shapes below — sectioning is presentational
  // grouping only, never a second option-row implementation.
  const renderOption = (opt: ControlPillOption<V>) => {
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
        {/* The wrapper (not the label) carries flex-1 — with a hint, the
            label holds its own content width (shrink-0, no truncate needed)
            and the hint alone absorbs the squeeze. Sharing shrink between
            them (the previous shape) let a long hint's larger flex-basis
            claim a larger ABSOLUTE reduction under proportional
            flex-shrink math, which crushed the shorter label toward zero —
            backwards from the goal, since the label is the thing being
            identified. WITHOUT a hint the label goes back to
            `min-w-0 shrink truncate` — the original bare flex-1 shape —
            because a flat caller's label is the only thing in the row
            competing for space; a user-defined value (the By-date pill's
            field names) can still run long, and shrink-0-with-no-truncate
            would let it overflow the menu's fixed sm:w-56 into horizontal
            scroll/clip instead of a clean ellipsis. */}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className={opt.hint ? "shrink-0" : "min-w-0 shrink truncate"}>
            {opt.label ?? opt.value}
          </span>
          {opt.hint ? (
            <span aria-hidden="true" className="min-w-0 shrink truncate text-2xs text-fg-dim">
              {opt.hint}
            </span>
          ) : null}
        </span>
        {checked ? (
          <span aria-hidden="true" className="text-accent">
            ✓
          </span>
        ) : null}
      </button>
    );
  };

  const optionCount = sections
    ? sections.reduce((n, s) => n + s.options.length, 0)
    : (options?.length ?? 0);

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
            {sections
              ? sections.map((section, i) => (
                  <div
                    key={section.heading ?? i}
                    className={i > 0 ? "mt-1 border-t border-border-light pt-1" : undefined}
                  >
                    {section.heading ? (
                      <p
                        aria-hidden="true"
                        className="px-2 pt-1 pb-0.5 text-2xs uppercase tracking-[0.08em] text-fg-dim"
                      >
                        {section.heading}
                      </p>
                    ) : null}
                    {section.options.map(renderOption)}
                  </div>
                ))
              : options?.map(renderOption)}
            {note ? <p className="px-2 pt-1.5 pb-1 text-xs text-fg-dim">{note}</p> : null}
            {actions && actions.length > 0 ? (
              <div
                className={
                  // A hairline only when real options sit above — the empty
                  // state's note already separates them.
                  optionCount > 0 ? "mt-1 border-t border-border-light pt-1" : undefined
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
