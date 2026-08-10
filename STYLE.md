# Parachute App — design system

`src/styles/index.css` is the canonical stylesheet for the app. It codifies the
**cream-and-sage / coral / serif** identity (the Wave-2 *hybrid* palette,
DESIGN-SPEC §1, ratified decision c) into a token + component-class system
so the app stays Linear/Things-tier consistent without re-deriving the look
per file. Other Parachute surface authors copy this file as a starting point.

Brand source of truth: `parachute.computer/design/brand-tokens.md` (§1
palette, §2 type). This file is the Wave-2 hybrid pass of that reference —
the prototype's warm cream grounds and forest ink under the **unchanged coral
accent**; the brand doc is mirrored by a separate `parachute.computer` PR.
(History: the pre-Wave-2 app was blush paper with warm-brown ink; the much
older `#4a7c59` "forest green" *accent* identity stays retired — green
returned as **ink and labels**, not as the action color. Coral is the accent.)

## Fonts

Self-hosted **Fraunces** (display serif) + **Figtree** (body + chrome sans),
bundled from `@fontsource-variable/*` and precached by the service worker
(`woff2` in the workbox glob) — no external font requests, CSP-safe, works
offline. Fraunces ships its `opsz` variable axis (the optical-size axis is
the display voice) **plus the italic file** — the `.accent-word` device needs
real italics. `font-display: swap`; the tuned system stacks remain as
fallbacks so first paint is never blocked.

Four named stacks: `--font-serif` (Fraunces — display headings, hero titles,
prose headings), `--font-sans` (Figtree — body and chrome), `--font-round`
(**retired alias** of `--font-sans`; the rounded UI voice folded into Figtree
— existing `font-round` call sites keep working), `--font-mono` (ids,
addresses, code).

## Token contract

Use the **semantic** tokens, never raw palette hexes or Tailwind color
literals (`red-500`, `text-white`, `amber-300`, …). All tokens live in the
`@theme` block (light values) with a single dark-override (see "Theming"
below).

| Token | Use |
|---|---|
| `--color-bg` / `-soft` | cream page canvas (`#fafaf6`) / recessed surfaces (`#f7f5ec`) |
| `--color-fg` / `-muted` / `-dim` | forest ink (`#233c2a`) / sage-cast secondary / tertiary+placeholder ONLY (sub-AA — never body copy) |
| `--color-accent` / `-hover` | **coral** brand action color (`#bf4a2a`) — unchanged by the hybrid pass |
| `--color-accent-light` | BRIGHT coral (`#e05d3c`) — large/decorative only (3.46:1); never small body text |
| **`--color-on-accent`** | text that sits ON an accent surface — **white in light, dark ink in dark** (the WCAG-AA fix). Never `text-white` on accent |
| `--color-grass` / `-strong` / `-soft` / `-ink` | the vault's own colour — switcher glyph, active-nav pill, "connected" trust green |
| `--color-sun` / `-soft` / `-ink` | the gentle "finish setting up" nudge + trial chip |
| `--color-sage` | the prototype's sage **green** (`#527e5d`) — eyebrows, section labels, quiet icons. **Renamed in Wave-2:** this used to be a blue (== sky); blue uses now point at `--color-sky` |
| `--color-sky` | mid blue-green (`#5b8fa8`) — graph "connected apps," self-host side-door links |
| `--color-coral-soft` / `-ink` | tinted-coral "featured/highlight" badge family — distinct from the interactive accent |
| `--color-danger` / `-hover` / `-soft` / `-border` | destructive / error (warm brick, not generic red) |
| `--color-warning` / `-soft` | caution (amber) |
| `--color-positive` | success (== accent) |
| `--color-border` / `-light` | sage-cast hairlines |
| `--color-card` / `-hover` | raised surface (`#fefefa` — a breath off the canvas, not hard white) |
| `--canvas-wash` | the `.app-canvas` dawn glow — grass at 7% light / 5% dark |
| `--text-2xs … --text-3xl` | ONE type ramp shared by chrome + prose |
| `--radius-xs … --radius-2xl, --radius-full` | radii — xs/sm/md for code/tables/tiny chrome; lg 12px (nav rows), xl 16px, **2xl 24px** (cards, modals, sheets, drawers); interactive controls are pills (`-full`) |
| `--shadow-sm` / `-md` / `-lg` | forest-tinted utility elevation ramp |
| `--shadow-soft` / `-lift` | the sage-tinted negative-spread pair — `-soft` = resting card lift, `-lift` = floating sheet/FAB/popover/palette. Nothing may use a plain gray drop shadow |
| `--w-prose` / `-surface` / `-page` / `-narrow` | container widths (42 / 52 / 72 / 32 rem). **`--w-surface` (52rem, LZ-3)** is the ONE width the unified `VaultSurface` uses — the reading+managing surface, sat between `--w-prose` (42rem, a reading column) and `--w-page` (72rem, the old wide manager). DayView + the other rooms keep their own widths |
| `--dur-quick` / `-move` / `-enter` | ONE motion vocabulary (120 / 200 / 280ms) — `-quick` for state changes (color, border, shadow), `-move` for things that transform/resize, `-enter` for surfaces arriving (sheets, popovers, palette, toasts). Every transition/animation in the app consumes one of these — no raw ms literals |
| `--ease-out` / `-spring` | the two motion curves — `-out` is the calm default settle (also the Tailwind `ease-out` utility, redefined), `-spring` is the promoted `.btn` hover bounce. `--dur-move`/`--dur-enter` zero to 0ms under `prefers-reduced-motion: reduce` (one gate, not per-component `motion-reduce:` sprinkles) — `--dur-quick` stays live, since reduced-motion is a vestibular-safety signal about MOTION (WCAG 2.3.3), not a ban on color/shadow settles |

The Tailwind v4 `@theme` block means every `--color-*`, `--text-*`, `--radius-*`
token is also a utility (`bg-accent`, `text-fg-muted`, `text-2xs`,
`max-w-[--w-page]`). For the semantic state tokens, use the arbitrary-value form:
`text-[--color-danger]`, `bg-[--color-danger-soft]`,
`border-[--color-danger-border]`.

## Component classes (`@layer components`)

Build surfaces from these instead of re-hand-rolling strings:

- **Buttons** — `.btn` base (a **pill**, `--radius-full` — all variants) +
  `.btn-primary` (coral fill; springy `scale(1.02)` hover lift behind
  `prefers-reduced-motion`) / `.btn-secondary` (bordered card) / `.btn-ghost`
  (text-only until hover) / `.btn-accent-soft` (accent-tinted in-context
  action, e.g. "Save view") / `.btn-danger` (soft destructive) /
  `.btn-danger-solid` (filled destructive, e.g. a dialog's confirm). Sizes:
  `.btn-sm`, `.btn-lg`, `.btn-touch` (min-h-11 mobile target).
- **Form controls** — `.input` / `.select` (pills) / `.textarea`
  (`--radius-xl` — a pill textarea is silly) (+ `.input-on-bg` when the field
  sits on a recessed/dialog surface).
- **Surfaces** — `.card` (`--radius-2xl`); `.glass-panel` (translucent
  `--color-bg-soft` at 82% over `backdrop-blur(10px)` — the rail, the tablet
  nav drawer, the mobile nav sheet, the command palette, sticky headers; pair
  with `--shadow-lift` when it floats).
- **Chips** — `.chip` + `.chip-tag` / `.chip-tag-active` (the #tag pill) /
  `.chip-featured` (the coral-soft "highlight" badge — distinct from the
  interactive accent, e.g. a plan's featured tier).
- **Dialogs** — `.dialog-overlay` (`.enter-fade`) + `.dialog-panel` (`--radius-2xl` +
  `--shadow-lift`, `.enter-rise`) — the entrance is baked into the shared classes, so any
  consumer inherits it for free.
- **Motion** — `.enter-rise` (opacity + `translateY(10px)→0`, `--dur-enter`) and `.enter-fade`
  (opacity only, `--dur-quick`), both on `--ease-out`. Apply to any floating surface that mounts
  fresh on open (dialog, popover, sheet, toast) — never to a row/element that re-renders on every
  keystroke. Exits stay instant by design; only entrances animate.
- **Type helpers** — `.page-title` (the serif page headline — a fluid `clamp`
  that scales with the text-size knob at its rem lower bound; use it for every
  route's `<h1>`), `.eyebrow` (uppercase micro-label, **sage** — the
  prototype's in-app label rule) + `.eyebrow-accent` (coral — reserved for
  the marketing Landing: "terracotta on marketing, sage in product"),
  `.note-id` (mono path — the dim metadata line under a human title, never the
  headline).
- **Canvas** — `.app-canvas` on the app shell: `--color-bg` plus
  `--canvas-wash`, a whisper of green radially washed in from the top (the
  misty sage morning). Text still resolves against the solid `--color-bg`
  beneath it, so AA contrast is unchanged.
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
- `.accent-word` — the coral *italic* accent word (prototype `.acc`; real
  Fraunces italics — the italic font file is load-bearing). **Rule of use:**
  exactly **one** accent word per headline, always the final or
  emotionally-loaded word ("land." / "vault." / "ready."), always inside a
  `--font-serif` heading. Never in body copy, never two per screen.
- `.tile` — a large soft quick-action card (the add-vault chooser's
  Open/Create/Connect cards, Home's quick doors) — generous radius + the
  `-soft`/`-lift` shadow pair on hover.
- `.composer` — the write-in-place hero card; blooms a coral ring on
  focus/hover (`.composer-focus`).
- `.nudge-sun` — the single quiet "finish setting up" nudge, sun-tinted, never
  a wall.
- `.note-row` / `.note-dot` — a note row on Home: dot · title · preview · time.
- `.drop-in` / `.fade-up` — the settling-note-onto-paper entrance animations, a bespoke one-off
  flourish distinct from the `.enter-rise`/`.enter-fade` system above (both honor
  `prefers-reduced-motion`, in the same consolidated gate).

## Theming

Light tokens live in `@theme`. The **dark** theme — "forest night," the
net-new complement of the cream/sage world (deep green-cast near-blacks,
sage-tinted secondary text, the lightened coral kept as accent) — is a single
source: the dark hex values are defined once as private `--_d-*` vars on
`:root`, and both dark gates (the `@media (prefers-color-scheme: dark)` system
case and the explicit `:root[data-theme="dark"]` case) point the public tokens
at those privates. Edit a dark value in exactly one place.

## WCAG-AA note (the dark-accent fix)

The accent is the coral button hue (`#bf4a2a`): white-on-accent is 4.97:1,
accent-on-canvas 4.75:1 (4.91:1 on card) — all pass AA. In dark mode the
accent LIGHTENS to `#ec7a5c` (6.14:1 on the forest-night ground), so
`--color-on-accent` flips to a dark warm ink (`#2a1710` → 6.11:1 on the dark
accent) instead of white. Every accent-surfaced label uses `.btn-primary` or
`text-[--color-on-accent]`; there are **no** `text-white`-on-accent uses.

| Surface | Ink | Ratio | AA (4.5:1) |
|---|---|---|---|
| accent (light) `#bf4a2a` | `#fff` | 4.97:1 | pass |
| canvas (light) `#fafaf6` | accent `#bf4a2a` | 4.75:1 | pass |
| canvas (light) `#fafaf6` | forest ink `#233c2a` | 11.46:1 | pass |
| canvas (light) `#fafaf6` | fg-muted `#5b6f5e` | 5.17:1 | pass |
| canvas (light) `#fafaf6` | sage `#527e5d` | 4.46:1 | pass |
| accent (dark) `#ec7a5c` | `#fff` (old default) | fails | **fail** |
| accent (dark) `#ec7a5c` | `#2a1710` (on-accent flip) | 6.11:1 | pass |
| night (dark) `#161d18` | fg `#e7ece5` | 14.33:1 | pass |
| night (dark) `#161d18` | fg-muted `#a7b3a7` | 7.89:1 | pass |
| night (dark) `#161d18` | sage `#8fb096` | 7.21:1 | pass |

Ratios recomputed with the WCAG relative-luminance formula in the Wave-2
hybrid pass (every DESIGN-SPEC §1 claim reproduced; see the W2-1 PR for the
full 35-check table — the coral "featured" badge family and the secondary
hues — grass/sun/sage/sky — are AA-checked the same way).
