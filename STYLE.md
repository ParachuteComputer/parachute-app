# Parachute App — design system

`src/styles/index.css` is the canonical stylesheet for the app. It codifies the
**warm-paper / coral / serif** identity into a token + component-class system
so the app stays Linear/Things-tier consistent without re-deriving the look
per file. Other Parachute surface authors copy this file as a starting point.

Brand source of truth: `parachute.computer/design/brand-tokens.md` (§1
palette, §2 type). This file is the coral brand pass of that reference —
**not** the older forest-green identity some earlier docs described. If you're
reading a doc (or a comment) that mentions `#4a7c59` / `#7ab087` or "forest
green," it's describing the RETIRED palette; the tokens below are what's
actually live in `index.css`.

## Fonts

SYSTEM font stacks only — no webfont download (Google Fonts retired). Four
named stacks: `--font-serif` (display headings, hero titles), `--font-sans`
(body — the brand's font-body stack), `--font-round` (UI chrome: buttons,
eyebrows, chips — `ui-rounded` / SF Pro Rounded / Quicksand fallback chain),
`--font-mono` (ids, addresses, code).

## Token contract

Use the **semantic** tokens, never raw palette hexes or Tailwind color
literals (`red-500`, `text-white`, `amber-300`, …). All tokens live in the
`@theme` block (light values) with a single dark-override (see "Theming"
below).

| Token | Use |
|---|---|
| `--color-bg` / `-soft` | page background / recessed surfaces |
| `--color-fg` / `-muted` / `-dim` | primary / secondary / tertiary text |
| `--color-accent` / `-hover` | **coral** brand action color (`#bf4a2a`) |
| `--color-accent-light` | BRIGHT coral (`#e05d3c`) — large/decorative only (3.5:1 on paper); never small body text |
| **`--color-on-accent`** | text that sits ON an accent surface — **white in light, dark ink in dark** (the WCAG-AA fix). Never `text-white` on accent |
| `--color-grass` / `-strong` / `-soft` / `-ink` | the vault's own colour — switcher glyph, active rail rows, "connected" trust green |
| `--color-sun` / `-soft` / `-ink` | the gentle "finish setting up" nudge |
| `--color-sage` (== `--color-sky`) | mid blue-green — "connected apps," self-host side-door links |
| `--color-coral-soft` / `-ink` | tinted-coral "featured/highlight" badge family — distinct from the interactive accent |
| `--color-danger` / `-hover` / `-soft` / `-border` | destructive / error (warm brick, not generic red) |
| `--color-warning` / `-soft` | caution (amber) |
| `--color-positive` | success (== accent) |
| `--color-border` / `-light` | hairlines |
| `--color-card` / `-hover` | raised surface |
| `--text-2xs … --text-3xl` | ONE type ramp shared by chrome + prose |
| `--radius-xs … --radius-full` | radii |
| `--shadow-sm` / `-md` / `-lg` | warm-tinted elevation |
| `--shadow-soft` / `-lift` | the prototype's generous diffuse shadows — cards/tiles "settling onto paper" |
| `--w-prose` / `-page` / `-narrow` | container widths (42 / 72 / 32 rem) |

The Tailwind v4 `@theme` block means every `--color-*`, `--text-*`, `--radius-*`
token is also a utility (`bg-accent`, `text-fg-muted`, `text-2xs`,
`max-w-[--w-page]`). For the semantic state tokens, use the arbitrary-value form:
`text-[--color-danger]`, `bg-[--color-danger-soft]`,
`border-[--color-danger-border]`.

## Component classes (`@layer components`)

Build surfaces from these instead of re-hand-rolling strings:

- **Buttons** — `.btn` base + `.btn-primary` (coral fill) / `.btn-secondary`
  (bordered card) / `.btn-ghost` (text-only until hover) / `.btn-accent-soft`
  (accent-tinted in-context action, e.g. "Save view") / `.btn-danger` (soft
  destructive) / `.btn-danger-solid` (filled destructive, e.g. a dialog's
  confirm). Sizes: `.btn-sm`, `.btn-lg`, `.btn-touch` (min-h-11 mobile
  target).
- **Form controls** — `.input` / `.textarea` / `.select` (+ `.input-on-bg` when
  the field sits on a recessed/dialog surface).
- **Surfaces** — `.card`.
- **Chips** — `.chip` + `.chip-tag` / `.chip-tag-active` (the #tag pill) /
  `.chip-featured` (the coral-soft "highlight" badge — distinct from the
  interactive accent, e.g. a plan's featured tier).
- **Dialogs** — `.dialog-overlay` + `.dialog-panel`.
- **Type helpers** — `.page-title` (the serif page headline — a fluid `clamp`
  that scales with the text-size knob at its rem lower bound; use it for every
  route's `<h1>`), `.eyebrow` (uppercase micro-label, rides `--font-round`),
  `.note-id` (mono path — the dim metadata line under a human title, never the
  headline).
- **Canvas** — `.app-canvas` on the app shell: `--color-bg` plus a whisper of
  warm coral radially washed in from the top. Text still resolves against the
  solid `--color-bg` beneath it, so AA contrast is unchanged.
- **Page wrappers** — `.page` (centered, `--w-page`, canonical gutters) /
  `.page-prose` (reading width — the calm single-column flows like Home/Today
  live here). `.prose-note` caps its measure at `--w-prose` so long-form
  reading stays comfortable in a wide column.
- **Skeleton** — `.skeleton` (honors `prefers-reduced-motion`).
- **Focus** — `.focus-ring`: one accessible `focus-visible` ring that works on
  bordered and unbordered elements. Apply to any interactive element lacking a
  focus style.

### Arrival + wizard classes (the prototype super-surface)

The arrival flow (Landing → Welcome → the vault-creation beats → Home's first
paint) and the add-vault chooser speak a distinct, warmer register than the
working notes rooms — reproducing the synthesized prototype:

- `.hero-title` — one notch above `.page-title`, the marketing-calm serif
  scale (`clamp(2.4rem, 5vw, 3.6rem)`).
- `.accent-word` — the one coral *italic* accent word inside a hero title
  (prototype `.acc`).
- `.tile` — a large soft quick-action card (the add-vault chooser's
  Open/Create/Connect cards, Home's quick doors) — generous radius + the
  `-soft`/`-lift` shadow pair on hover.
- `.composer` — the write-in-place hero card; blooms a coral ring on
  focus/hover (`.composer-focus`).
- `.nudge-sun` — the single quiet "finish setting up" nudge, sun-tinted, never
  a wall.
- `.note-row` / `.note-dot` — a note row on Home: dot · title · preview · time.
- `.drop-in` / `.fade-up` — the settling-note-onto-paper entrance animations
  (both honor `prefers-reduced-motion`).

## Theming

Light tokens live in `@theme`. The **dark** theme is a single source: the dark
hex values are defined once as private `--_d-*` vars on `:root`, and both dark
gates (the `@media (prefers-color-scheme: dark)` system case and the explicit
`:root[data-theme="dark"]` case) point the public tokens at those privates. Edit
a dark value in exactly one place.

## WCAG-AA note (the dark-accent fix)

The accent is the coral button hue (`#bf4a2a`): white-on-accent is 4.97:1,
accent-on-paper 4.77:1 — both pass AA. In dark mode the accent LIGHTENS to
`#ec7a5c` (6.28:1 on the dark ground), so `--color-on-accent` flips to a dark
warm ink (`#2a1710` → 6.11:1 on the dark accent) instead of white. Every
accent-surfaced label uses `.btn-primary` or `text-[--color-on-accent]`; there
are **no** `text-white`-on-accent uses.

| Surface | Ink | Ratio | AA (4.5:1) |
|---|---|---|---|
| accent (light) `#bf4a2a` | `#fff` | 4.97:1 | pass |
| accent (light, on paper) `#bf4a2a` | `#2a2521` bg | 4.77:1 | pass |
| accent (dark) `#ec7a5c` | `#fff` (old default) | fails | **fail** |
| accent (dark) `#ec7a5c` | `#2a1710` (on-accent flip) | 6.11:1 | pass |

Ratios computed in the 0.1.21 brand pass; see that PR for the full table
(the coral "featured" badge family and the warm secondary hues — grass/sun/sage
— are AA-checked the same way).
