# Changelog — @openparachute/parachute-app

## [0.5.3] - 2026-07-11

**W2-4 — vault switcher v2: the manager hinge (F2 full / F13 full / F4 ambient half / WALK-manager #2+#3).**
`VaultPopover` becomes `VaultSwitcher` (file history kept) — the one canonical door for
switch / open / create / connect, plan-aware and trial-aware (DESIGN-SPEC §2.4 + §3.2).

- **Three row sources, partitioned honestly:** ON THIS DEVICE (local vaults — ✓ current +
  switch rows) · IN YOUR ACCOUNT (the door account's hosted vaults **not on this device**,
  each with an "Open →" verb — F13's real fix: Open is scoped to exactly not-here, so it can
  never silently reopen the vault you're already in) · FROM YOUR HUB (hub-published,
  unconnected — the OAuth Connect door, unchanged). Account matching is by normalized URL
  plus a name-match for home-door records (slugs are the identity at the door); a hub entry
  sharing an account vault's URL collapses into the one-click Open row.
- **Inline add-vault verbs (F2 full):** "＋ Create a vault" (→ the create flow, today
  `/welcome?new=1`; W2-6 retargets to `/add-vault/create`) and "⌂ Connect your own" (→ `/add`)
  — the AddVaultChooser's cards inlined at the switcher's foot. `/add-vault` stays the
  deep-linkable page form; the switcher is the primary door.
- **Plan-aware create (WALK-manager #3):** at the plan's vault limit the Create row renders
  the upsell — "N of N vaults on your plan — Upgrade →" → `/account` (sun-tinted circle) —
  so the 409 is unreachable from the switcher. Degrades to the plain Create row when no
  summary exists (self-host / signed out / fetch failed); the server still guards.
- **Trial ambience (F4, decision b):** a quiet "Free trial · N days left" foot line →
  `/account`, only while the door reports `trial_days_left`.
- **Switch confirmation everywhere (WALK-manager #2, §4.4):** new `switchVault(id, {toast})` +
  `announceVaultSwitch(label)` helpers (`src/lib/vault/switch.ts`) — every path that changes
  the active vault now toasts "Now in {vault}": switcher rows + account Open, `/vaults` Make
  active, the picker, the welcome-back auto-open, the creation ready-beat's Open, `/add`'s
  already-connected deep-link switch, and a fresh OAuth connect landing. Already-active
  no-ops don't announce (nothing switched).
- **New shared `useAccountSummary()` hook** (`src/lib/account/use-summary.ts`) — one TanStack
  query (staleTime 5 min) for every plan/trial consumer; lazy (`enabled`), never gates first
  paint. The switcher enables it (and the account vault-list query) only while its panel is
  open. Future consumers: the rail badge (W2-5), `/account` + Today nudge (W2-8).
- **§3.2 visuals:** panel is a `--radius-2xl` card with `--shadow-lift`; rows use the
  icon-in-soft-circle pattern (vault-initial glyph squares — grass-soft when on this device,
  neutral otherwise); sage-eyebrow section labels ("On this device" / "In your account" /
  "From your hub"); friendly error copy on a failed Open (F12 mapping, never a wire code).
- Both entry points kept: the desktop rail's vault card and the mobile header's vault pill
  (NavSheet integration is W2-5). The dead `inline` variant is gone.
- Tests: `VaultSwitcher.test.tsx` (evolved from `VaultPopover.test.tsx` — row-model partition
  incl. F13 scoping + name-match rules, at-limit upsell with Create absent, trial-line
  presence/absence, switch/Open toasts, verb navigation, all prior hub/OAuth coverage);
  new `switch.test.ts`; Make-active toast in `Vaults.test.tsx`; picker/welcome-back/ready-beat
  toasts in `Welcome.test.tsx`.
- **Closes F2 (full), F13 (full), F4 (ambient half), WALK-manager #2 (confirmation half) + #3.**

## [0.5.2] - 2026-07-11

**W2-3 — merge `/today` into `/`: one room, one name on both form factors (F8).**
A structure PR (depends on W2-2). `/` (Home) and `/today`'s no-param timeline were near-duplicate
rooms — both rendered `page-prose` + `useNotesForDateViews()` + the same `RecentTimeline`, and the
desktop rail called the route "Today" while the mobile tab called it "Home". This PR folds the
duplicate room away and wires the first real consumer of W2-2's `useHistoryAwareBack` hook.

- **`Today.tsx` → `DayView.tsx`.** The route (`/today`) no longer renders a front-door timeline —
  that duplicate is gone, absorbed into Home (nothing in Home changed except a new Calendar link,
  below). `/today` with no `?date=` is now a redirect shim → `/` (NAVIGATION.md: (a) shim, replace).
  `/today?date=YYYY-MM-DD` survives unchanged as the day drill-in, reached from Calendar cells and
  Home's day-header links. `DayView` moved from App.tsx's eager import set into the lazy-loaded set —
  it's no longer on the FCP-critical boot path now that the no-param case is a shim.
- **`DayView`'s "← Back" is wired to `useHistoryAwareBack("/")`** (W2-2's hook, unwired until now) —
  goes back to wherever you actually came from (Calendar, another day, Home) when there's real
  history behind the entry, else falls back to `/`. The prev/next-day links, the "Today" jump link,
  and the invalid-date escape now all point at `/` directly (rather than round-tripping through the
  `/today` shim).
- **Home gained a Calendar link in its header.** The rail carries no Calendar row yet (that's
  W2-5); Today's old timeline was the only desktop door to Calendar, so folding it away would have
  silently removed that reachability. Home's header now carries the link on both form factors.
- **The mobile bottom tab now reads "Today", not "Home"** (`BottomTabBar.tsx`) — matching the
  desktop rail's label for the same `/` route (F8/F14: one room, one name everywhere).
- Tests: `DayView.test.tsx` (renamed from `Today.test.tsx`) covers the `/today` shim (with and
  without an active vault) and the history-aware back button (via a real `BrowserRouter`, same
  pattern as `history.test.tsx` — a `MemoryRouter` can't drive `window.history.state.idx`);
  `Home.offline.test.tsx` (renamed from `Today.offline.test.tsx`) ports the error-over-data
  coverage to the room that now owns it; `groupNotesByDay`'s unit tests moved to a new
  `RecentTimeline.test.tsx` next to the function; `Home.test.tsx` gained the Calendar-link,
  day-header-hop, and genuinely-empty-vault cases; `BottomTabBar.test.tsx` updated for the label.
- **Closes F8.**

## [0.5.1] - 2026-07-11

**W2-2 — navigation history policy: Back no longer exits the app (F7 / DESIGN-SPEC §4.3).**
A structure PR against the ratified push/replace decision table — no UI redesign, no wizard-
chrome changes (those are W2-6). Fixes the specific "gratuitous replace" bugs that collapsed
the browser history stack, and writes the policy down so future PRs have one table to check
navigation calls against.

- **New `NAVIGATION.md`** (repo root) — the §4.3 decision table verbatim: user-initiated
  transitions push; `replace` is reserved for redirect shims, one-shot param consumption,
  transient auto-advancing beats, and the single post-auth landing. Documents the "accepted
  limit" (a magic-link tab's thin stack is a deliberate consequence of the table, not a bug —
  the cure is the wizard-chrome escape hatches, W2-6).
- **New `useHistoryAwareBack(fallbackTo)` hook** (`src/lib/nav/history.ts`) — goes back in
  history when there's genuinely a prior in-app entry, else falls back to a named route. It
  keys off `window.history.state.idx` (react-router's monotonic entry index), *not*
  `location.key !== "default"`: a first-entry `replace` mints a fresh non-default key while
  leaving no real history behind, so a key-based check would let `navigate(-1)` step off-app
  (back to the email client) — the `idx > 0` check never does. No consumers yet (W2-3/W2-6's
  job); ships now so those PRs import rather than reinvent it.
- **Fixed five gratuitous `replace`s → `push`** (F7 offenders, all named in PLAN.md): the
  post-auth "ready" beat's "Open my vault →" (Welcome.tsx), the vault picker's "Open →" and
  "＋ Create a new vault" (Welcome.tsx), the already-signed-in card's "Open {vault} →"
  (Landing.tsx), and `/account`'s VaultsBlock "Open →" (Account.tsx). Each used to collapse
  the history stack on a user-initiated forward step; Back from Home now returns to the
  picker/chooser/account page instead of skipping straight past it.
- **The `/welcome` dispatcher now re-syncs its picker/naming fork to the URL.** The one
  same-route param push (picker → "＋ Create a new vault" → `/welcome?new=1`) exposed a stale
  guard: the dispatch effect keyed on the retry counter alone, so a browser POP back to the
  picker re-ran but bailed, stranding the naming form where the picker should have returned.
  The guard now keys on the retry counter *and* the URL params, so a param POP re-dispatches
  and the picker comes back (same fix for the `?pick=1` variant). The forward flow still skips
  the refetch (the vault list is already in hand).
- **Fixed a gratuitous `push` → `replace`**: NoteNew's save (text and audio) and
  DeleteNoteButton's post-delete redirect now replace instead of pushing — Back from a
  freshly-saved note no longer lands on a cleared ghost draft, and Back after a delete no
  longer lands on the deleted note's dead `/n/<id>` view.
- **The catch-all (`*` → `/`) now toasts** ("That page doesn't exist — brought you home.")
  instead of silently teleporting a typo'd/stale URL home with zero acknowledgment.
- **Every navigation call this table governs carries a one-line `// NAVIGATION.md: ...`
  citation** — the ceremony/auth flow (Landing, CheckEmail, Welcome, AddVaultChooser,
  AddVault, OAuthCallback, Import, NoteNew, NoteEditor), the App.tsx route table (all shims
  + the catch-all + the boot `?add=` one-shot), and the ten "no active vault" route guards
  (Settings, NoteView, Today, Tags, Home, Activity, NoteEditor, Notes, VaultGraph, ConnectAI).
- **Tests**: `useNavigationType()`-probe assertions (new `src/test/nav-probe.tsx` harness)
  pin push-vs-replace at the component level for every fixed call; a new
  `src/app/nav-history.test.tsx` drives the full `<App/>` (real `BrowserRouter`, real
  `window.history`) through both golden flows and asserts real `history.length` deltas,
  mirroring WALK-nav.md's own live-browser methodology.

## [0.5.0] - 2026-07-11

**W2-1 — the hybrid skin: cream/sage palette + Fraunces/Figtree (DESIGN-SPEC
§1, ratified decision c).** The visual foundation of the Wave-2 IA redesign.
Value-edits to the existing token architecture — every token NAME and the
component classes that read them are preserved; the app looks warmer/serif
immediately but keeps its current structure (component restyling trails in
later Wave-2 PRs).

- **Palette (light).** The blush paper becomes the prototype's cream/sage
  world: canvas `#fdfaf4→#fafaf6`, recessed `#f7f1e6→#f7f5ec`, card
  `#ffffff→#fefefa` (a breath off the canvas, not hard white); ink moves from
  warm brown to **forest** (`#2a2521→#233c2a`, 11.46:1) with sage-cast
  secondary text; hairlines go sage (`#e2d9c8→#d6e2d6`). **Coral stays the
  accent, unchanged** (`#bf4a2a` — 4.75:1 on the new canvas). The
  `.app-canvas` wash flips coral→grass (the "blush wash → misty sage morning"
  move, via the new `--canvas-wash` token: 7% light / 5% dark).
- **Dark = "forest night" (net-new design).** The warm-brown night becomes
  the cream/sage world's complement: deep green-cast near-blacks
  (`#1a1917→#161d18` etc.), sage-tinted secondary text, the lightened coral
  `#ec7a5c` kept as accent (6.14:1 on the new ground). Same `--_d-*`
  single-source architecture, value edits only; both dark gates
  (`prefers-color-scheme` and `data-theme`) untouched structurally. The dark
  prose code/`.hljs` surfaces drop their stale warm-brown hex for
  `--color-bg-soft` so they ride the theme.
- **The sage/sky naming fix.** `--color-sage` was a *blue* (== `--color-sky`)
  — a trap for anyone building "the sage world." The five inline
  `var(--color-sage)` call sites (Account, Welcome, CheckEmail, Landing ×2 —
  all blue side-door links) repoint to `var(--color-sky)`; `--color-sage` now
  means the prototype's **green** (`#527e5d` light / `#8fb096` dark). End
  state: sage = green, sky = blue, as any reader would assume.
- **Type — Fraunces + Figtree, self-hosted.** `@fontsource-variable/fraunces`
  (opsz + opsz-italic — the optical-size axis is the display voice, and the
  `.accent-word` device needs real italics) + `@fontsource-variable/figtree`,
  bundled by Vite, `woff2` added to the workbox precache glob so type works
  offline (~344 KiB of fonts, within the spec's ~350 KB budget).
  `font-display: swap`; the tuned system stacks remain as fallbacks. The
  stacks keep their var names (`--font-serif`/`--font-sans`); `--font-round`
  retires to an alias of `--font-sans` — Figtree carries chrome.
- **Shadows, radii, glass.** `--shadow-soft`/`-lift` retune to the
  prototype's sage-tinted negative-spread geometry; the `--shadow-sm/-md/-lg`
  ramp keeps its geometry with the tint moved warm-brown→forest. Radii:
  `--radius-lg` 10→12px, `--radius-xl` 14→16px, **new `--radius-2xl` 24px**;
  `.btn`/`.input`/`.select` become pills, `.textarea` → xl, `.card`/
  `.dialog-panel` → 2xl (dialog also steps up to `--shadow-lift`). New
  `.glass-panel` class (translucent cream over blur) for the coming
  rail/sheet/palette. `.btn-primary` gains the springy scale(1.02) hover
  lift behind `prefers-reduced-motion`. Button/input inline padding stepped
  up slightly so labels breathe inside the pill curve.
- **Eyebrows.** `.eyebrow` moves `--color-fg-dim`→`--color-sage` (the
  prototype's in-app label rule); new `.eyebrow-accent` (coral) reserved for
  the marketing Landing.
- **PWA manifest.** `background_color` `#fdfaf4→#fafaf6` (splash matches the
  new canvas); `theme_color` stays coral.
- **Docs.** STYLE.md retuned to the hybrid tokens; documents `.accent-word`'s
  rule of use (one italic accent word per headline, serif headings only),
  `.glass-panel`, the sage/sky rename, and the eyebrow rule.
- All 35 DESIGN-SPEC §1 contrast claims reproduced with the WCAG
  relative-luminance formula (script + table in the PR).

## [0.4.3] - 2026-07-11

**Entry-billing story — the interval picker + honest pricing (F1 app half /
F3, decision a).** Cloud now publishes per-interval pricing on each door plan
(quarterly/yearly for Entry, all three cycles for Standard/Plus/Power); the
app previously had no way to see or choose a cycle at all — `startCheckout`
sent no `interval`, cloud defaulted to monthly, and Entry (which has no
monthly Price — Stripe's flat per-transaction fee eats a $1 charge) 400'd
every time, with the app folding that into a generic "Billing isn't available
right now."

- **A segmented billing-interval picker** on the Account surface's upgrade
  cards (`UpgradePlans`, `Account.tsx`) — one global selector for the whole
  ladder (Monthly · Quarterly · Yearly), showing only cycles at least one
  offered tier actually sells, defaulting to the cheapest available. Entry
  (no monthly) shows a disabled placeholder + its own cheapest real cycle as
  a hint instead of ever presenting a button that would 400 — switching to
  Quarterly or Yearly enables it normally.
- **Honest per-interval prices (F3).** Each card renders the door's own
  per-cycle label for the selected interval (e.g. "$3/quarter", "$10/yr")
  instead of a bare "$1/mo" that contradicted checkout. A descriptor with no
  `intervals` data (an older cloud, or a hub) degrades to the exact
  pre-existing `price_month` display and an interval-less checkout call —
  no picker, no behavior change.
- **Landing copy (F3, decision a).** "From $1/mo after." → "Plans from $10 a
  year." — Entry no longer advertises a cycle it doesn't sell.
- **Contract:** `DoorPlan.intervals?: Partial<Record<"monthly"|"quarterly"|
  "yearly", {available, price?, label?}>>` (`lib/account/types.ts`), additive
  and tolerant. `normalizeDescriptor` sanitizes each plan's `intervals`
  independently — a malformed cycle entry (or the whole block) is dropped
  per-plan, mirroring the existing `auth`/`plans` shape-guarding, never
  trusted wholesale.

## [0.4.2] - 2026-07-11

**Navigation dead-ends — the add-vault chooser wired in, wizard escape
hatches, friendly errors.** A cohesive set of "you can't get back" fixes from
the owner's experiential audit (F2/F6/F12/F13/F18) — all redesign-independent;
the coming IA rework (two-zone nav, route renames, the push/replace history
policy) is separate and unaffected.

- **F2 — the orphaned add-vault chooser is wired in.** `/vaults`'s "Add vault"
  buttons (header + empty-state) pointed at `/add` — the **self-hosted**
  connect URL form, a dead-end for a cloud user with no path to "create" and
  no way back. They now open `/add-vault` (`AddVaultChooser.tsx`), the
  purpose-built Open/Create/Connect chooser that had **zero inbound links**
  until now. `/add` stays exactly what it was: the leaf the chooser's
  "Connect a self-hosted vault" card targets.
- **F13 — the chooser's "Open" card no longer silently reopens your only
  vault.** With exactly one account vault, `/welcome`'s dispatcher auto-runs
  the welcome-back beat and opens the vault you're likely already in — "open a
  vault not on this device" was a no-op bounce. The card now links to
  `/welcome?pick=1`, which forces the picker regardless of vault count.
- **F6 — the full-screen wizard screens have a way out.** The Wordmark
  (`ParachuteMark.tsx`) is now a real `<Link to="/">` everywhere it renders
  (Landing, Welcome, AddVault, AddVaultChooser, CheckEmail, OAuthCallback) —
  with no active vault, none of these screens had ANY other chrome, so the
  (often-broken) browser Back button was the only exit. The vault-naming
  form, the self-hosted connect form (`/add`), the add-vault chooser, and
  `/check-email` also gain an explicit quiet "← Back" beside it, each
  resolving to a sensible destination (the chooser, `/vaults`, or `/` — which
  itself degrades correctly whether or not a vault is already active on this
  device).
- **F12 — vault-creation and vault-open failures read as prose, not a wire
  code.** Root cause: `client.ts`'s `jsonOrThrow` preferred the server's
  machine `error` code (`vault_limit_reached`) over its accompanying friendly
  `message` ("You've reached your plan's vault limit…") — a plan-limit hit
  rendered as a bare snake_case string. `jsonOrThrow` now prefers `message`.
  A new `lib/account/error-copy.ts` (`describeAccountError`) adds
  belt-and-suspenders mapping for the cases the server-message fix doesn't
  cover (a bare code with no message, or an unrecognized one) — used by the
  vault-naming form's creation error and the Account surface's
  `VaultsBlock.open` error.
- **F18 — `STYLE.md` rewritten against the real palette.** It documented the
  retired forest-green identity (`#4a7c59`); `src/styles/index.css` has been
  the coral brand pass (`#bf4a2a`/`#e05d3c`, grass/sun/sage secondaries) for a
  while. Rewritten against the actual tokens + component classes (including
  the arrival/wizard classes added since — `.tile`, `.composer`, `.hero-title`,
  `.nudge-sun`, …) so nobody styles from the stale reference.

## [0.4.1] - 2026-07-11

**Billing section — Stripe-direct, no cloud-console re-login (Plan A).**
"Manage plan & billing" now goes STRAIGHT to Stripe instead of hopping to
`cloud.parachute.computer/console` (a different origin, host-scoped cookies —
that hop forced a re-login before the console's own second hop to Stripe).
Pairs with cloud rc.74's new Bearer billing endpoints — deploy together.

- **`AccountSummary` gains `billing_enabled` + `has_billing_customer`, drops
  `manage_billing_url`** (types.ts). The Account surface's Billing section is
  gated purely on this data: `billing_enabled: false` (self-hosted hub / no
  Stripe configured) ⇒ the section doesn't exist at all — never a false door to
  a plan that isn't there.
- **NEW `openBillingPortal()` / `startCheckout(tier, interval?)`** (client.ts) —
  Bearer-gated POSTs to cloud's `POST /account/billing/{portal,checkout}`,
  riding the same account-bearer plumbing (mint, cache, re-mint-once-on-401) as
  every other `/account/*` call. Both return `{ url }` on 200; a typed
  `BillingApiError` (with a `code`: `no_billing_customer` /
  `already_subscribed` / `invalid_tier` / `invalid_interval` / `invalid_plan` /
  `unconfigured`) on 409/400/503 so the UI can show a small inline message
  instead of crashing.
- **The Billing section** (`Account.tsx`, replacing the old inline billing
  button): an **existing subscriber** (`has_billing_customer: true`) sees the
  current-plan line + a **"Manage plan & billing ↗"** button that calls
  `openBillingPortal()` and redirects straight to the returned Stripe URL
  (`window.location.assign` — cross-origin, so a top-level nav, not a
  fetch-follow). A **trial/free account** sees the door's upgrade ladder as
  plan cards (from `descriptor.plans`, the door descriptor — P4), current tier
  marked, each purchasable tier an **"Upgrade to \<name\>"** button that calls
  `startCheckout(tier)` and redirects the same way. The app renders plan DATA
  it's already handed and makes two typed redirect calls — zero Stripe
  knowledge, zero pricing math, zero cloud-origin imports.
- **Identity card simplified**: "Signed in as X" + Sign out only — plan/billing
  now lives entirely in its own Billing section.
- **Home's plan backlink now stays in-app.** The Home surface's quiet backlink
  (`PlanBacklink`) was the SAME cloud-console → re-login seam from the Home
  surface — it `href`-ed to `cloud.parachute.computer/console`. It now renders
  **"Manage your account →"** as an in-app react-router `Link to="/account"`
  (same origin, no re-login), shown only for home-door (account-minted) vaults
  — a foreign self-hosted vault has no account on this door, so no backlink.
  The `/account` surface (with the new Billing section) owns Manage-vs-Upgrade
  + the Stripe-direct hop from there.
- **`src/lib/vault/console-url.ts` (and its test) removed** — the host-sniffed
  `manageBillingUrl` fallback and `Home`'s backlink were its only consumers;
  with both routed in-app, `cloudConsoleUrl` is dead and gone. The app now has
  **zero** cloud-console links (the only remaining `/console` reference is the
  service-worker navigation denylist, which forces server-owned ceremony paths
  past the SW to the origin — infrastructure, not a link).
- **White-screen hardening (review folds)**: `normalizeDescriptor` now drops a
  malformed `plans` (non-array, or an array with a null/primitive element) the
  same way it drops a malformed `auth` — a door we don't control can't
  white-screen the Billing cards' `plans.map(p => p.id …)`. `billingResult`
  guards the `200 {url}` body (non-empty string required) so a contract-broken
  `200 {}` can't `assign(undefined)`. And a genuine session expiry (post-retry
  401 → `SessionExpiredError`) now rides the app's existing session-ended
  handling (`markExpired` → the account session banner) instead of being masked
  as a generic billing message.

## [0.4.0] - 2026-07-11

**Descriptor-driven, door-agnostic front door — HUB-PARITY P4.** The same app
can now boot against a hub OR cloud by reading the door's descriptor at
`GET /.well-known/parachute-account`; safe to ship pre-hub (cloud's descriptor
without an `auth` block falls back to today's magic-link behavior byte-for-byte).

- **NEW `src/lib/account/descriptor.ts`** — `getDoorDescriptor()`, same-origin,
  public, memoized in-module + `sessionStorage` (`parachute:door-descriptor`)
  so boot pays one fetch. `null` on any non-200/network/parse failure. The app
  pins these shapes locally (its contract-of-record convention) — it does not
  import `door-contract`. A malformed `auth` block from a door we don't control
  (`methods` not a string array, `signin_path` not an absolute path, `auth: {}`)
  is DROPPED (→ magic-link fallback) rather than trusted, so an off-spec
  self-hosted descriptor can't white-screen the app or hop to `"undefined?next"`;
  an unrecognized-but-well-formed method (e.g. `passkey`) is kept so the app
  still hops to the door's own sign-in page (forward-compat).
- **The front door's ONE door-conditional branch** (`Landing.tsx`): a
  `magic_link` door (or no descriptor) renders the existing email form,
  byte-unchanged; a password-only door renders a ceremony-hop card
  ("Sign in to your parachute." → **[Continue to sign in →]**) that hands off
  to the door's own sign-in page, mount-aware (`next` is prefixed with the
  app's runtime mount — e.g. `/app/welcome` under a hub — via the new
  `withMount` helper in `base-url.ts`; `signin_path` itself is never
  mount-prefixed, it's the door's own origin-rooted path). A password door
  with a `signup_path` gets a quiet "New here? Create your account →"; without
  one, "Accounts on this parachute are created by its operator." The
  self-hosted side door stays on both branches.
- **Vault-address echo from `vault_url_template`** (`Welcome.tsx`'s naming
  form, shared by first-vault onboarding and the add-vault flow): once a door
  advertises a template, the live echo shows the real address
  (`{name}` substituted); falls back to the slug-only echo when absent —
  preview-only, post-creation addresses still come from the create/list
  responses.
- **Hub-session tolerance**: `AccountSession` gains optional `username` +
  `password_change_required`. "Signed in as X" falls back `email ?? username`
  (Landing's already-signed-in card, Account's header). A `403
  {error:"force_change_password"}` (or a pre-empting
  `session.password_change_required`) on the account-token mint sets a
  non-blocking gate → a "Finish setting your password" banner
  (`HubGateBanner`, new in `AccountSessionBanner.tsx`) linking to
  `/account/change-password`; a `423` sets an "admin screen is locked" gate.
  Both are weather, never a wall — reading local notes is never gated.

## [0.3.4] - 2026-07-10

Account surface polish (PR-2 review nits):

- **Vault-load failure ≠ empty.** A failed `GET /account/vaults` (transient 500 /
  session lapse) now renders a **"Couldn't load your vaults — Retry"** card, not
  the "create your first" empty-state (which could invite a duplicate vault). The
  empty-state is reserved for a genuinely empty list; the create/connect
  affordances are hidden on a load failure. Retry re-fetches just the list.
- **No fabricated meter.** The plan's "N of M vaults" line renders only when the
  door gives BOTH `vaults_used` and `vault_limit` — a limit without a count no
  longer prints a false `0 of M`.
- **Billing opens in a new tab** (`target="_blank" rel="noreferrer"`) so the app
  stays open when you pop out to the console — matching the "land right back
  here" intent.

## [0.3.3] - 2026-07-10

**The Account surface — the app AS the manager** (SYNTHESIS "The shape"). The
person lives in the app and drives their whole account through the account
bearer; Cloud shrinks to the counter you visit only to sign up, pay, or change
plan.

- **`/account`** (new route, in Rail foot + mobile menu): "Signed in as {email}"
  + a plan/usage line, your Cloud vaults (from `GET /account/vaults`, each with a
  `Cloud` chip + Open →, plus Create / Connect-self-hosted), and an AI-connections
  pointer. Door-agnostic (reads the account API at the serving origin) and
  **graceful**: no cloud door / signed out → a calm "this device" view (local
  vaults + connect), never a crash.
- **`AccountSummary` canonical contract** (`GET /account/summary`,
  Bearer-gated `account:<id>:read`) + `getAccountSummary()` client through the
  same `bearerFetch`. **Seamed**: cloud may not have shipped it yet, so the
  plan/usage line renders only when present — never fabricated numbers. The
  `[Manage plan & billing →]` target prefers the door's `manage_billing_url` and
  falls back to the cloud console derived from a vault host (door-agnostic seam,
  TODO to derive purely from a door descriptor).
- **Provenance vocabulary** (`vaultProvenance`): `Cloud` (home-door) vs
  `Self-hosted · host` (/add) chips — now on both the Account list (all `Cloud`)
  and `Vaults.tsx` (both kinds; the raw dev scope string is gone). Vault removal
  copy is honest: **"Remove from this device"** (notes stay in the vault).
- **Settings** "Manage" now links **Account → in-app `/account`** (was a console
  bounce); the one true trip out (Stripe billing) lives behind Account's button.
- Reviewer nits folded (same files): the account bearer's in-flight C2 mint is
  memoized (concurrent-C3 dedup — the Account screen fires listVaults +
  getAccountSummary at once); the Bearer layer drops `credentials:"include"` (C3
  reads only the header); a stale dead re-export in `hosted-vault.ts` removed.

## [0.3.2] - 2026-07-10

**P0 wire fix — the account client now attaches the account bearer on every
`/account/vaults*` call.** Verified against cloud's real source
(`workers/identity/src/account-api.ts` + `account-auth.ts`): that surface (C3)
is **Bearer-gated** by the account token (`aud="account"`,
`account:<id>:{read,admin}`) — the session cookie alone gets a 401. The merged
PR-1 client sent `credentials: "include"` + CSRF but no `Authorization: Bearer`,
so the FIRST `/account/vaults` call 401'd. (Green-on-mocks hid it — the mocks
mocked our assumed shapes, not the wire.)

- **`client.ts`** grows a Bearer layer: `listVaults` / `createVault` /
  `mintVaultToken` route through a `bearerFetch` that mints the account token
  (C2 `POST /account/token`), caches it (`lens:account_token`), attaches
  `Authorization: Bearer <token>`, and **re-mints once on a 401** from the live
  session cookie. `getSession` / `POST /account/token` / `POST /auth/magic` stay
  on the cookie+CSRF layer (that IS how the bearer is obtained). C3 bodies drop
  `__csrf` (the Bearer layer isn't CSRF-gated).
- **`logout`** now posts an `x-www-form-urlencoded` body — cloud's
  `handleLogoutPost` reads `req.formData()`, so the old JSON POST silently
  no-op'd server-side.
- **`createVault` / `mintVaultToken` / `openHostedVault` / `createHostedVault`**
  no longer thread `csrf` (the client self-sources the account bearer); the
  Welcome / Landing call sites drop the redundant `getSession`.
- **Tests round-trip the REAL wire**: `client.test.ts` asserts the
  `Authorization: Bearer` header IS sent on every C3 call, that the account
  token is minted + cached + re-minted on 401, and that logout is form-encoded.

## [0.3.1] - 2026-07-10

PWA service worker → **auto-update**. A new deploy now wins on the next load
without the manual "reload" prompt — the judge URL is iterated on and shown to
Aaron, so a returning visitor should never be stuck on a stale bundle.

- `registerType: "prompt"` → `"autoUpdate"`; workbox `skipWaiting` +
  `clientsClaim` + `cleanupOutdatedCaches` so the generated SW self-activates
  and claims open pages, and purged precaches never 404 a claimed page.
- `UpdateBanner` is now a silent auto-updater (no banner). In autoUpdate mode
  the plugin fires `onNeedReload` on the new worker's `activated` event (the
  prompt-mode `needRefresh`/`updateServiceWorker` path is dead); the app routes
  that through `reloadAfterServiceWorkerUpdate` — a one-shot `controllerchange`
  listener + fallback timeout that reloads exactly once even if the event is
  dropped (notes#148/#165). Offline capability unchanged.

## [0.3.0] - 2026-07-10

Arrival IA fix (Aaron's live feedback): the front door is an **entry fork**, not
vault-naming. The naming delight moves to first-run onboarding after an account
exists.

- **Landing → entry fork.** PRIMARY: "Sign in or create your Parachute" — one
  warm email field → the hosted door's magic-link ceremony
  (`cloud.parachute.computer`) via the app's OAuth 2.1 + PKCE + DCR machinery
  (`beginHostedSignin`, email as `login_hint`, no URL typing; magic-link unifies
  new vs returning). SECONDARY (quieter): "Connect a self-hosted vault" → the
  existing `/add` flow. Keeps the parachute mark, trust chips, warmth. Removed
  the origin door-probe from the arrival.
- **New `/welcome` first-run route** — the relocated "What should we call your
  vault?" screen. The hosted flow lands here via `OAuthCallback`'s `redirect`;
  it pre-fills an already-chosen name (returning users confirm) or starts empty
  for a machine-default name (fresh accounts name it). Sets the vault display
  name via a new `renameVault` store action (threads through rail/home/title).
- Fixed the dead `text-[--color-on-accent]` / `text-red-400` in `OAuthCallback`.

Door-dependent seams (noted, not faked): authoritative server-side vault naming
and the precise "brand-new account" signal await the hosted account/vault API
(`/.well-known/parachute-account` is 404 today — C4/C5). The hosted button does a
real handoff to the live cloud ceremony; naming persists locally + seams the
server PATCH.

## [0.2.0] - 2026-07-10

Extend the warm-paper/coral/serif design system INWARD to the inner surfaces —
so clicking past Home no longer lands on structurally-notes-ui screens. Restyle +
light IA-align only; all machinery (vault client, sync/outbox, CRUD, routing,
`lens:*` storage) intact.

- **Tier 1 (from home/rail):** `Notes` (All Notes — warm `.note-row` rows w/ grass
  dots + coral view chips + section labels), `Today`, `NoteView` (calm reading),
  `NoteNew` (the composer opened up — serif title field, `.composer` warmth, voice
  affordance), `NoteEditor` (serif chrome around CodeMirror).
- **Tier 2:** `Settings` (the calm "dissolved console" — serif section headings,
  warm cards, selectable boxes), `Tags`, `Activity`.
- **Tier 3:** `ConnectAI` (warm MCP-URL box + Claude/ChatGPT assistant tiles +
  grass trust line), `Import`, `AddVault`, `Vaults`.
- Swept many broken `text-[--color-on-accent]` arbitrary utilities (dead in
  Tailwind v4 → dark-on-coral, fails AA) to the generated `text-on-accent` /
  `.btn-primary`, and hardcoded `red-500`/`amber-500` literals to the
  `danger`/`warning` tokens. Light + dark paired, phone-correct.

## [0.1.0] - 2026-07-10

Founding scaffold of the Parachute super-surface.

- Seeded the substrate from `parachute-surface/packages/notes-ui` (0.2.1): the
  vault client, OAuth/PKCE auth, offline sync/outbox layer, IndexedDB/OPFS, notes
  CRUD, and the `surface-client` / `surface-render` integration — kept intact.
- Resolved workspace deps to published npm (`@openparachute/surface-client@0.3.4`,
  `@openparachute/surface-render@0.2.0`).
- Root-hosted by default (`base: /`, `VITE_BASE_PATH=/`) for a standalone origin.
- Renamed the service identity to `parachute-app` / "Parachute".
- Kept the frozen `lens:*` storage namespace (origin-isolated; keeps the sync
  layer untouched).
- Rebuilt the shell + arrival + home to match the synthesized prototype: warm
  paper tokens (grass/sun/sage families, softer shadows, generous radii), the
  calm centered arrival with vault-name-as-identity threading, and a warm home
  with a focused composer and quiet quick-actions.
