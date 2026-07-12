# Changelog — @openparachute/parachute-app

## [0.16.1] - 2026-07-12

**The SET UP shelf is state-derived, not a per-device sticky checklist (Wave-3).** Fixes the bug
the owner hit: the shelf ("Write a note / Connect your AI / Bring notes over") re-appeared on
every new device, because completion lived in per-device `localStorage` — an established account
looked un-onboarded on a fresh browser. Patch bump — a bug fix + a removed affordance
(`ConnectAI`'s manual tick), no new room.

- **`write` is now the ONLY tracked step.** `src/lib/home/checklist.ts`'s `deriveSteps` takes just
  live signals (`{ hasUserNote }`) and returns one step, done exactly when a real (non-seed,
  non-system) note exists in the vault — the same cross-device fact on every device, always. There
  is no more `HomeChecklistState`, no `overrides`, no `dismissed` flag, and no localStorage read or
  write anywhere in the module.
- **`connect` investigated, then dropped as a tracked step** (per the owner's ratified fallback).
  No client-detectable, door-agnostic signal exists for "an AI is connected to this vault":
  the vault's own `oauth_clients` table is vestigial (parachute-vault 0.4.x moved OAuth issuance to
  the hub — vault is resource-server-only now); the hub's grant/consent list
  (`GET /api/grants`) is gated on `parachute:host:admin` — unreachable by an ordinary vault user,
  hub-only, nothing equivalent exists on the cloud door; and the cloud account-summary contract
  (`GET /account/summary`, `AccountSummary` in `src/lib/account/types.ts`) carries no connection
  field at all. A manual per-device tick here WAS the bug this rework closes, so rather than keep
  one, the step — and `ConnectAI.tsx`'s "I've connected my AI" button/badge — is gone; the page is
  now pure instructions with a plain "Done — back to your vault" link.
- **`import` folded into `write`** — both were always just "get notes into the vault" from
  `hasUserAuthoredNote`'s point of view (an imported note is exactly as real as a typed one), so a
  second row tracking the identical fact was redundant even before this rework.
- **`install` moved out of the shelf entirely.** Installing a PWA is legitimately per-device, so it
  has no business in a cross-device "is this vault set up" signal — and it already had its own
  fully independent, always-live nudge (`@/components/InstallPrompt` in the nav sheet, driven
  directly by `useInstallAffordance()`, never persisted). That nudge is untouched; it just can no
  longer make the whole multi-step shelf reappear, because there is no more multi-step shelf.
- **`use-home-checklist.ts` reworked**: no persisted state left to load/save. It now holds only an
  in-memory, per-mount "hide this for now" (the shelf's ✕ still works, but dismissing is a
  this-session courtesy, not a lie that outlives the tab — reload, or switch vaults, and the shelf
  re-evaluates fresh from real state). Resets on a vault switch via React's "adjust state during
  render" pattern (comparing the incoming `vaultId` against the last-seen one), not an effect —
  keeps the hook lint-clean (biome's exhaustive-deps rightly flagged an effect whose body never
  read its own dependency).
- **`nav/model.tsx`'s "Set up" band no longer reads any checklist/localStorage state at all** — it
  derives straight from `hasUserAuthoredNote`, the same signal the Recent lens's inline nudge uses,
  so the rail/sheet band and the inline nudge can never disagree about progress.
- **Cross-device fix, proven**: `VaultSurface.recent.test.tsx` and `nav/model.test.tsx` each add a
  test that seeds ONLY a vault + its access token (no checklist blob of any kind) plus a real
  (non-seed) note, and asserts NO setup shelf/band renders — i.e. an established vault reads as
  onboarded on a simulated brand-new device. A companion test confirms a genuinely fresh/empty
  vault (seed guide only) still shows the guidance. Playwright screenshots (light + dark,
  fresh-vault-vs-established-vault) captured to a scratch path, not committed.
- Tests: `checklist.test.ts` rewritten around the state-derived model (drops the five
  localStorage-persistence tests — there's no persistence left to test — adds a step-shape check
  and an imported-note-counts-as-write check); `ConnectAI.test.tsx` replaces the "marks connect
  done" test with one asserting no manual tick exists and nothing is written to storage;
  `VaultSurface.recent.test.tsx` and `nav/model.test.tsx` gain the cross-device proof tests above.
  Net **1537 → 1534** (the removed persistence-layer tests outnumber the new state-derived +
  cross-device ones) — all passing.

## [0.16.0] - 2026-07-12

**Export surface — download your vault (Wave-3).** The app promises "Open format. Export
anytime." on every surface, but had no export door — only Import. Adds one, mirroring Import's
shell. Minor bump — a new room in the IA, no behavior change to anything existing.

- **New route `/export`** (`src/app/routes/Export.tsx`, lazy-loaded like every other secondary
  room): explains the promise ("a portable folder of your notes — plain Markdown, with your tags,
  links, and attachments included"), lists what's in the download, and one primary action —
  "Export my vault." Honest states only: "Preparing your export…" while in flight (no fake
  progress bar — a `.tar` stream has no meaningful percent), a plain error ("Couldn't reach your
  vault — try again.") on a network/server failure, and a **distinct** state for a 404.
- **The 404 case is the load-bearing finding of this PR.** The vault REST contract's
  `GET /api/export` (read-scoped) exists **only on the cloud Durable-Object vault**
  (`workers/vault/src/vault-do.ts` `handleExport` — ships attachment binaries as
  `.parachute/attachments/<id>/<file>` sidecars, a complete backup). **The self-hosted bun vault
  has no HTTP route for this at all** — its `routing.ts` dispatch table only knows `/notes`,
  `/tags`, `/vault`, `/storage`, `/find-path`, `/subscribe`, `/health`, `/unresolved-wikilinks`;
  export there is CLI-only (`parachute-vault export <dir>`). Rather than assume the door-agnostic
  premise, this page calls the real endpoint and lets the response decide: a self-host vault 404s,
  which the client surfaces as `VaultNotFoundError` — the page renders a specific note ("Export
  over the web isn't available on this vault yet…") with the CLI pointer, instead of the generic
  network-error copy. No client-side door-type detection (unreliable — a self-hosted hub can also
  be the app's "home door"); the behavior itself is the source of truth.
- **`exportVault()`** added to `src/lib/vault/client.ts`'s `VaultClient` — reuses the base
  `@openparachute/surface-client` class's protected `requestBlobWithRetry` (the same
  auth/refresh/reachability/404 contract `fetchAttachmentBlob` rides) rather than reimplementing a
  retry loop; the only new part is the URL (`GET /api/export`).
- **The download**: the resolved `Blob` triggers a real browser download via the object-URL +
  briefly-attached-anchor trick (`{vault-name}-export-{date}.tar`, date derived at click time).
- **Surfaced as Import's sibling**: an "Export notes" row in `/account`'s Connections card
  (next to "Import notes," same row shape, a new `sun`-toned icon circle — `IconExport` in
  `NavIcons.tsx`, mirroring `IconImport`'s tray with the arrow reversed) and a matching
  `EXPORT_ITEM` in the "Your parachute" nav band (desktop Rail + mobile NavSheet share the one
  model, so both projections pick it up for free). Left untouched, deliberately: the SpeedDial
  capture menu, the fresh-vault `QuickDoors` tiles, and the SET UP checklist — all three are
  onboarding/capture verbs ("get content in"), not a fit for "get your data out."
- Tests: `Export.test.tsx` (renders, no-vault redirect, the authed GET + download trigger, the 404
  vs. network-error distinction) + updated exact-list assertions in `model.test.tsx`,
  `Rail.test.tsx`, and `Account.test.tsx` for the new nav item / Connections row.

## [0.15.1] - 2026-07-12

**LZ-6 — lens wave close: docs, the stale-"Today" sweep, cruft removal.** The final PR of the
Lens-Model wave (LENS-SPEC §7). No runtime behavior change — docs + comment hygiene + repo
cleanup. Patch bump.

- **`NAVIGATION.md`** gains one decision-table row (LENS-SPEC §2): the All-lens filter writeback
  (`setSearchParams(…, { replace: true })` — VaultSurface mirroring the active search/tag filters
  into `?search=&tag=…` as they change) is **replace** — state mirroring, not a place change.
- **`STYLE.md`** documents the width token `--w-surface: 52rem` (added in LZ-3): the ONE width the
  unified `VaultSurface` uses, between `--w-prose` (42rem) and `--w-page` (72rem). DayView + the
  other rooms keep their own widths.
- **The stale-"Today" sweep** (LENS-SPEC §6 — the name "Today" died with the lens model): renamed
  the room-name references to the home surface (now the Recent lens) across code comments, one CSS
  comment, and test titles/fixtures — the WizardShell wordmark comment, `note-title`/`NoteRow`/
  `RecentTimeline`/`queries`/`use-summary` comments, the `.note-row` CSS comment, the `NoteRow`
  parity test (incl. the `todayRow`→`recentRow` local), and AddVault's `/`-route test stub. Kept
  untouched: every **date-domain** "Today" (DayView's day labels + `/today?date=` route, Calendar's
  today-cell + button, Activity's Today/Yesterday grouping, `RecentTimeline`'s day-group labels,
  `events.ts` grouping label) and the **historical/explanatory** references that document the arc
  (`model.tsx` "what Today was", `Rail.test`/`quick-switch` "Today retired", `App.tsx` "formerly
  Today's route", the offline/groupNotesByDay history comments).
- **`app-audit/` removed from the repo** — four review screenshots (`w3-textsize-shots/*.png`)
  accidentally committed earlier; deleted and `app-audit/` added to `.gitignore` so review
  screenshots can never be committed again.

## [0.15.0] - 2026-07-12

**LZ-5 — mobile gets the lens model: the on-surface lens strip + the 3-slot bar.** LENS-SPEC §5
(ratified D2): below `lg` the surface itself carries the lens set, and the bottom bar slims from
four slots to three — one surface, one surface tab. Every lens is ≤2 taps on a phone (the strip
chip is 1); capture stays 1 tap. Minor bump: the mobile IA change.

- **The lens strip** (`components/LensStrip.tsx`, §5.1): a horizontal chip row on the surface
  directly under the masthead, `lg:hidden` (at lg+ the desktop rail owns the lens set — rendering
  both would duplicate the vocabulary D2 rejected). The chips ARE the nav model's lens band —
  `useNavBands()`'s "notes" items projected, same ids/labels/hrefs/order as the Rail and NavSheet
  render (single source, the F14 no-drift lesson; pinned by a strip↔rail parity test). Active
  chip wears the §3 grass-soft pill by the model's own matcher; tapping a chip is a push
  navigation to the lens URL; the row scrolls horizontally if cramped and renders on every lens,
  so a phone can leave Pinned/Archive in one tap. This is LZ-3's parked desktop `PresetFilterBar`
  reborn — same spot in the anatomy, the model's vocabulary instead of its own five-view list.
- **The bottom bar 4→3** (§5.2): **Notes · [+] · Search**. The LZ-2 interim Recent/Notes tab
  pair collapses into ONE surface tab — "Notes" → `/` (the Recent lens is the front door), lit
  across the whole surface via the new `matchVaultSurface` matcher (`/`, `/notes` in every
  `?view=` dress, and the /n/:id + /today drill-ins that stay under it). The `?view=pinned|archived`
  no-tab-lights gap of the 4-slot bar is resolved: the surface tab claims them; WHICH lens you're
  wearing is the strip's job, not the bar's. The centre [+] stays the raised capture disc → `/new`
  (unchanged size/behavior — capture speed sacred); Search stays the palette entry; the NavSheet
  still carries everything including the Explore band and YOUR PARACHUTE.
- **One projection per viewport, extended** (the notes#147 contract): the strip joins the mobile
  side — Rail `hidden lg:flex` ≥lg; LensStrip + BottomTabBar `lg:hidden` <lg; never both, never
  `md:`. The contract test now pins the strip's gate and its band parity with the rail.
- Desktop untouched: rail, NavSheet contents, Explore band, SpeedDial all exactly as LZ-4 left
  them.

## [0.14.0] - 2026-07-11

**LZ-4 — Recent joins: `/` and `/notes` are one surface.** The centerpiece's second half
(LENS-SPEC §1.1 + §3): BootGate's vault-active branches render `<VaultSurface lens="recent"/>`,
`Home.tsx` dissolves into the surface and is deleted. The lens rail now truly navigates between
lenses of ONE component — Recent · All · Pinned · Archive are dresses over the same VaultSurface.
Minor bump: the surface unification.

- **The Recent lens** (§3 anatomy): vault masthead (shared with every lens) · the composer
  (Recent + All are the writing lenses, decision i; focus-warmed while the vault is fresh) · the
  Recent-only furniture · the lens label "RECENT · what you've touched lately" · the day-grouped
  `RecentTimeline` window. `VaultSurface` internally dispatches two bodies — the capped live
  window vs the paginated searchable query (decision ii: different data machinery, one surface).
- **Archived notes drop OUT of Recent** (§1.1): Home used to show them dimmed in the timeline;
  Recent now filters them out entirely — archived means set aside, not "touched lately". The
  show-archived capability lives on the All lens (Filters panel), unchanged.
- **The floor** (§1.1): Recent caps at the most recent **14 days or 100 notes, whichever comes
  first** (local calendar days back from today, sorted by the same touch stamp the timeline
  buckets by), with a quiet foot line — "Looking for older notes? All notes →" — naming the edge
  and carrying the old header's All-notes door. A vault with notes but none inside the window
  gets an honest dormant line instead of a false "empty vault" invitation. The cap is what makes
  Recent *mean* recent.
- **Recent-only furniture, confined** (§3 item 3): TrialCountdownNudge, QuickDoors, SetupNudge,
  PlanBacklink, and the fresh-mode composer warmth relocate from Home verbatim — on the Recent
  lens exclusively. DESIGN-SPEC §3.1's "on Today only" ambience rule now reads "on the Recent
  lens only": the same four sanctioned places, no expansion (the All/Pinned/Archive bodies never
  even fire the account-summary fetch). Fresh-vault onboarding is identical to the old Home.
- **`Home.tsx` deleted**; its tests migrate to `VaultSurface.recent(.offline).test.tsx` with
  nothing losing coverage. `/today` bare → `/` and `/today?date=` → DayView stay exactly as
  they were; BootGate's own logic (`?add=` shim, signed-out Landing, session check, net-error)
  is untouched; VaultSurface stays the one eager FCP chunk for both doors.
- **Remount honesty** (§3.2, accepted): `/`=BootGate vs `/notes`=VaultSurface are different
  element types, so a Recent↔All switch remounts — the composer restores its draft synchronously
  at mount, the LZ-1 blur/unmount flush protects mid-type switches, and the lists paint from the
  react-query cache. Covered by a test that types on Recent, switches to All, and finds the words
  intact.

## [0.13.0] - 2026-07-11

**LZ-3 — one surface at `/notes`: Notes becomes the VaultSurface.** The centerpiece's first half
(LENS-SPEC §3): `/notes` is no longer a "Notes room" with its own headline — it's THE surface over
the vault, wearing the lens the rail picked. The vault name leads as the serif masthead on every
lens; the composer rides the writing lens; the lens is a quiet label over the list, never a
headline. `/` still renders the old Home this PR (Recent joins the surface in LZ-4). Minor bump:
surface rebuild.

- **`Notes.tsx` → `VaultSurface.tsx`** (git-mv for history — the VaultPopover→VaultSwitcher
  precedent); component `Notes` → `VaultSurface`, still eager-loaded, lens derived from `?view=`
  (`all` default · `pinned` · `archived` · the `untagged`/`orphaned` maintenance sub-views). Every
  old URL — `/notes?view=…`, saved-view links (`?search=…&tag=…`), the `/pinned`-era shims —
  resolves exactly as before. Exported type `NotesPreset` renamed `VaultView`.
- **The vault masthead** (§3 anatomy 1, every lens): the vault-name serif H1 + "Everything here is
  yours. Open format. Export anytime." — lifted from Home's masthead pattern, replacing the
  "All notes" H1. The vault is the identity; the lens is a label.
- **Composer on the writing lens** (§3 anatomy 2; ratified decision i): LZ-1's extracted
  `<Composer>` mounts under the masthead on the **All lens only** for now (Recent joins in LZ-4).
  Pinned/Archive are browse lenses and the maintenance sub-views are triage — no composer on any
  `?view=`. Keyed by vault id (the draft-clobber guard, same as Home).
- **Lens labels** (§3 anatomy 5): a sage eyebrow + quiet hint over the list — "ALL NOTES ·
  everything, searchable" / "PINNED · starred" / "ARCHIVE · set aside, never deleted" /
  "UNTAGGED · notes without any tags" / "ORPHANED · notes with no links" — replacing the
  SectionLabel title+count (the pager's "Showing m–n" still carries the numbers). Display label
  "Archive" (the param stays `view=archived`).
- **Desktop chip row retired; maintenance views fold into Filters** (§1, §3 anatomy 4): the
  resting `PresetFilterBar` (VIEWS: All·Pinned·Archived·Untagged·Orphaned) no longer renders —
  the rail owns the lens set, and the chips duplicated Pinned/Archive on every desktop paint.
  Untagged/Orphaned move INTO the Filters panel's Refine column as a "Show only: Untagged ·
  Orphaned" row — same `?view=` URLs, quick-tag trailing control intact, the active chip links
  back to `/notes` so the filter toggles off. `PresetFilterBar` stays exported-but-unrendered:
  LENS-SPEC §5 rebirths it as the below-`lg` mobile lens strip in LZ-5.
- **One width** (§3, `[spec-resolved]`): new token `--w-surface: 52rem` + a `.page-surface`
  wrapper — the surface sits between prose (42) and the old page (72). The All-lens Filters panel
  drops `md:grid-cols-3` → `md:grid-cols-2` (three columns are too cramped at 52rem — the
  sanctioned builder-discretion call, flagged for the [F] design review).
- **Capability preserved end-to-end**: search, the Filters disclosure + count badge, sort,
  show-archived, path prefix, tags + pinned-tags + match mode, saved views (save/rename/update/
  delete + link hydration), the lazy Folders tree (no eager fetch), pagination, the untagged
  quick-tag control, Pinned/Archive's reduced chrome, the empty-vault calm arrival (now with the
  composer as the writing invitation). NoteRow untouched.
- Tests move with the rename (`VaultSurface.test.tsx` + saved-views + offline) and the resting
  census re-baselines to search + Filters (2 controls); new coverage: masthead-on-every-lens,
  composer on/off per lens, `?view=` URL derivation, the Show-only row + its toggle-off.

## [0.12.0] - 2026-07-11

**LZ-2 — the lens rail: YOUR NOTES becomes the lens set, EXPLORE holds the destinations.** The
nav-model half of the Lens-Model one-surface pivot (LENS-SPEC §4): the vault is ONE surface and
**Recent · All notes · Pinned · Archive** are lenses over it, split from the **Explore**
destinations (Calendar · Tags · Activity · Map-earned). Every lens target is an EXISTING route
(§2's zero-migration URL scheme — `/`, `/notes`, `/notes?view=pinned|archived`), so the rail is
correct and every room reachable even before the LZ-3/LZ-4 surface merge. Minor bump: nav IA
change.

- **`match` grows a search dimension** (`src/lib/nav/model.tsx`): `NavItem.match` takes
  `{ pathname, search }` (the new `NavLocation`) instead of a bare pathname — the Pinned/Archive
  lenses live in the `?view=` param. All three projections (Rail, NavSheet, BottomTabBar) pass the
  router location through; pathname-only rooms wrap trivially via a `pathIs` helper.
- **The lens band** (id `"notes"`, label "Your notes"): **Recent** → `/` (the old Today grammar —
  `/`, `/today`, `/n/*` stay under it: drill-ins inherit the lens you came from); **All notes** →
  `/notes` matching every dress EXCEPT `view=pinned|archived` (untagged/orphaned maintenance
  filters and search/tag params highlight All); **Pinned** → `/notes?view=pinned`; **Archive** →
  `/notes?view=archived`. No counts on any lens in v1 (§1.1 — All has no cheap total). New
  NavIcons: clock (Recent), star (Pinned), lidded box (Archive); All notes keeps the notes glyph.
- **The EXPLORE band** (id `"explore"`, label "Explore" — ratified D3): Calendar · Tags · Activity ·
  Map, items and the earned-Map gate byte-identical, just moved out of YOUR NOTES into their own
  band. `NavBand.id` union gains `"explore"`.
- **Bottom bar interim relabel** (§5.3): the 4-slot bar stays until LZ-5's 3-slot redesign, but the
  "Today" tab reads **Recent** now (clock icon, the Recent lens's matcher) so the tab and the rail
  never disagree about what `/` is called (the F14 no-drift lesson). Sub-decision: the tab bar uses
  the model's matchers verbatim, so `/notes?view=pinned|archived` lights NO tab (those lenses
  aren't in the 4-slot set; the NavSheet carries them until LZ-5).
- **Command palette** (`quick-switch/results.ts`): the "Today" command relabels to **Recent** —
  label only; id, target, and the `today`/`home` keywords unchanged, so muscle memory keeps
  working. All other rows (All notes, Pinned, Archived, Untagged, Orphaned) untouched.
- **Tests** (1484 → 1494): the model suite pins the three-band shape plus an **active-state
  matrix** — exactly one item lights for each of `/`, `/notes`, `?view=pinned`, `?view=archived`,
  `?view=untagged` (All), `?search=…` (All), `/n/:id` (Recent), `/today?date=` (Recent),
  `/calendar`, `/map`, and `/all` (shim — none). The Rail↔NavSheet band-parity contract extends to
  the lens/Explore split and the lens hrefs; rendered-rail and sheet tests cover the search-aware
  aria-current states; the tab-bar suite covers the Recent relabel + the no-tab-on-Pinned interim.

## [0.11.3] - 2026-07-11

**LZ-1 — extract the composer from Home into `components/Composer.tsx` (pure move, prep for the
lens-model one-surface merge).** Structure-only refactor, zero behavior change and zero visual
change: the ratified Lens-Model spec (LENS-SPEC.md §3.1 anatomy item 2) calls for the write-in-place
composer to ride both the future Recent and All lenses once `Notes.tsx`/`Home.tsx` merge into one
`VaultSurface` (LZ-3/LZ-4); this PR does the LZ-1 groundwork alone.

- **`src/components/Composer.tsx`** — the W2-10 composer `<form>` and all its logic, moved verbatim
  out of `Home.tsx` behind a clean `{ vault, focused? }` prop interface. Preserved exactly: the
  `NEW_NOTE_SCOPE` shared-draft wiring (`loadDraft`/`useDraftAutosave`), the **flush-on-blur guard**
  (the W2-10 review fold — blur flushes the debounced draft before any outside door's click can
  navigate away and drop the tail), the synchronous flush on the editor/mic links, the voice/mic
  gate (`useTranscriptionGate`), the `vault.id`-keyed remount, the save path
  (`buildTextNotePayload` + `useCreateNote`), focus-expands-the-card, the calm post-save fold,
  "Save to {vault}", "Open full editor →", and "Autosaves to {vault}". `COMPOSER_INPUT_ID` is now
  exported so `Home`'s empty-state "Write the first one" button can still focus the composer in
  place.
- **`Home.tsx`** now imports and renders `<Composer key={vault.id} vault={vault} focused={...} />`
  exactly where the inline composer used to sit — nothing else about Home changed (nudges,
  QuickDoors, RecentTimeline, PlanBacklink untouched).
- **Tests**: the composer's own suite (9 tests — textarea/no-nav, focus-expand, save, save-error,
  shared-draft-to-/new, the flush-on-blur regression, restore-from-/new, mic arrival, transcription
  gate) moved out of `Home.test.tsx` into a new `Composer.test.tsx`, re-pointed at `<Composer>`
  directly. `Home.test.tsx` keeps the surrounding-chrome coverage (masthead, quick doors, setup
  nudge, trial ambience) exercised through `<Home>` end to end. Test count unchanged (1484).

## [0.11.2] - 2026-07-11

**W3 — text-size popover stays on-screen on tablet.** `TextSizeControl`'s "aA" popover always
opened downward (`mt-2`) and right-anchored (`right-0`). The control renders at the FOOT of every
container it's mounted in — currently the mobile/tablet NavSheet's bottom-sheet foot (InstallPrompt
· TextSizeControl · ThemeToggle) — so opening downward from a trigger already near the bottom of
the screen pushed the 160px panel below the physical viewport. Live-reproduced pre-fix at two
tablet viewports via Playwright: the popover's measured bounding box landed at `y=1188` (height
118) against an 1180px-tall viewport, and `x=-92` against the left edge — off-screen on BOTH axes.

- **Measure-and-flip** (`TextSizeControl.tsx`): on open, a `useLayoutEffect` reads the trigger's
  real on-screen position via `getBoundingClientRect()` (viewport-relative regardless of how many
  scrollable ancestors — e.g. the NavSheet sheet — sit in between) and the panel's own size, then:
  flips to `bottom-full mb-2` (upward) when there isn't room below, `mt-2` (downward, the original
  behavior) otherwise; clamps the panel horizontally via an inline `left`/`right:auto` override so
  neither edge can cross the viewport (an 8px margin on both axes). Recomputes on resize and on
  scroll (capturing listener — catches scroll on any nested scrollable ancestor) while the popover
  is open. `null` measurement state falls back to the original `right-0` anchor, so first paint is
  pixel-identical to before this fix in the common (non-clipping) case. Exposes `data-placement`
  for tests; everything else about the popover (click-outside close, the three size options, the
  `role="dialog"`/`aria-expanded` a11y, the "current" pill) is unchanged. No new transitions added,
  so no `prefers-reduced-motion` handling was needed.
- Pinned with three new tests (`TextSizeControl.test.tsx`): opens upward when there's no room
  below (the diagnosed sheet-foot shape), stays downward with ample room, and clamps horizontally
  at a narrow/left-edge trigger position.
- Verified with Playwright at 820×1180 and 768×1024 (tablet) against the real dev server + NavSheet:
  popover fully within the viewport at both sizes post-fix (screenshots in
  `app-audit/w3-textsize-shots/`).

## [0.11.1] - 2026-07-11

**W2-12 — identity → "Parachute" + brand favicon (F17).** The surface manifest still called
itself "Notes" at `/surface/notes`, and the browser tab/PWA-install icon was a placeholder green
ring-and-dot titled "Parachute Notes" — never the real brand. Patch bump: metadata + assets only,
no runtime logic changes.

- **`meta.json` identity flip**: `name` `"notes"` → `"parachute"`, `displayName` `"Notes"` →
  `"Parachute"`, `path` `"/surface/notes"` → `"/surface/parachute"`, tagline → "The Parachute app
  — your parachute's front door." `pwa`, `pwa_service_worker`, `scopes_required`, `iconUrl`,
  `required_schema`, `$schema`, and meta.json's own `version` are unchanged. This rename only
  affects **future** surface installs — an existing on-disk `notes` install keeps its mount
  unless the operator re-installs; an in-place upgrade without an explicit `mount_path` is
  covered by the corresponding hub-side alias (companion PR).
- **`vite.config.ts`**: `serviceInfo.name` `"parachute-notes"` → `"parachute-app"` so the built
  `dist/.parachute/info` matches the hub's `manifestName` discovery contract. `DISPLAY_NAME` was
  already `"Parachute"`.
- **Brand favicon** — replaced the generic green `#4a7c59` ring-and-dot (titled "Parachute
  Notes") with the real Parachute mark from parachute.computer (coral canopy, suspension lines,
  golden payload box): `public/icon.svg` now carries the site's `parachute-favicon.svg` (titled
  "Parachute"); `apple-touch-icon-180x180.png`, `pwa-192x192.png`, `pwa-512x512.png`, and
  `maskable-icon-512x512.png` are the site's matching rasters (the maskable variant reuses the
  512 asset — the site itself ships no dedicated safe-zone-padded maskable icon); `pwa-64x64.png`
  is a fresh high-quality downscale (no 64px source existed); `favicon.ico` was regenerated as a
  proper multi-size (16/32/48) ICO from the same mark (was single-size 48×48 of the old green
  icon). `index.html` gained explicit `<link rel="icon">` (SVG + ICO) and
  `<link rel="apple-touch-icon">` tags — previously the tab icon relied entirely on the browser's
  implicit `/favicon.ico` fallback; the SVG link now wins in modern browsers. Verified Vite
  correctly base-prefixes these absolute-path `<link>` hrefs under `VITE_BASE_PATH` (e.g.
  `/surface/parachute/icon.svg`), matching the existing JS/CSS asset convention — so the mark
  renders whether the app is root-hosted or surface-mounted.
- Rider: freshened stale `/surface/notes/` example paths in comments (`main.tsx`, `App.tsx`,
  `oauth.ts`) to `/surface/parachute/` — the mount-detection logic itself is unchanged
  (`base-url.ts`/`sw-bootstrap.ts`/`pwa-manifest.ts` are already mount-generic).

## [0.11.0] - 2026-07-11

**W2-11 — one NoteRow + `/notes` progressive disclosure (F9, N3).** The same note used to render
two different ways a tap apart: Today's timeline drew title·time·preview·chips in a bordered
day-card, while `/notes` drew dot·star·title·time·preview·chips in a flat hover list — and `/notes`
greeted you with an eight-control filter wall before showing a single note. One row now, one calm
header. Minor bump: the two note surfaces unify.

- **One shared `NoteRow`** (`src/components/NoteRow.tsx`) — the single anatomy every list surface
  renders: **dot/status · (pinned ★) · title · mono-path (when it adds something) · preview ·
  time · chips**, with archived rows dimmed+italic. Consumed by Today's timeline
  (`RecentTimeline`), the day drill-in (`DayView`), and the `/notes` list; both old row
  implementations are deleted. A parity test pins the SAME note fixture to **byte-identical row
  markup** on Today and `/notes`. Role tags (pinned/archived) resolve once per list, not per row;
  the untagged view's quick-tag control rides an optional `trailing` slot.
- **The row pattern, codified** — `.note-row` gains the design system's press state
  (`:active` → grass-soft; hover stays the card tint; selection is never an underline). Today's
  rows pick up the dot, pinned star, and archived dimming they were missing; the bordered
  day-card container gives way to the same flat list `/notes` uses (the prototype's home shape —
  day headers still group and link to the day view).
- **`/notes` rests at three control groups** — search field · view chips · one **Filters**
  disclosure. Sort, show-archived, title-prefix, tag browsing (pinned quick-picks + browse-by-tag
  + any/all match), saved views, and the lazy Folders tree all fold into the Filters panel
  (`#notes-filters`, a card with Refine / Tags / Views-and-folders columns on desktop). The
  redundant standalone Tags checklist (`TagFilter`) merged into the panel's TagBrowser; the
  header's "New note" pill retired (the mobile [+] tab and the desktop speed dial are the create
  doors at every width; the empty state keeps "Create one").
- **Nothing hides surprisingly** — the panel is closed on every arrival (state is deliberately
  not persisted), and a count badge on the closed Filters button shows how many folded filter
  dimensions are live (e.g. a deep-linked `?tag=…&path_prefix=…` arrives closed with "Filters · 2").
- **A fresh empty `/notes` is an invitation, not a wall** — search + view chips + "This vault has
  no notes yet · Create one" only: no Filters disclosure, no pager, no filter chrome over nothing
  (WALK-nav N3). The pager also hides anywhere there's nothing to page.
- **Width difference stays deliberate** — Today reads at `page-prose` (42rem), `/notes` manages at
  `page` (72rem); only the row anatomy rhymes.
- Rider: fixed a pre-existing biome format error in `Home.test.tsx` (main was red on
  `biome check`).

## [0.10.0] - 2026-07-11

**W2-10 — the honest composer on Today (F10).** Home's "What's on your mind?" card looked like an
input but was a `<Link to="/new">` — the first tap yanked you to a different screen; you could not
type where the affordance said you could. Now it's real. Minor bump: the home hero goes from a
navigation trick to an actual capture surface.

- **A real expanding textarea** (`Home.tsx` Composer): focus blooms the card open (200ms min-height
  ease, behind `prefers-reduced-motion`), the box auto-grows with the text, and typing happens in
  place. Resting anatomy unchanged — placeholder line, quiet "Autosaves to {vault}" note, the mic
  disc bottom-right.
- **One shared draft with `/new`** — typing autosaves (debounced) into the SAME per-vault draft
  store the full editor reads (`NEW_NOTE_SCOPE`, notes#175 machinery — no second draft mechanism).
  A thought started on Today greets you on `/new`, and vice versa; the "Open full editor →" escape
  therefore costs nothing. Round-trip pinned end-to-end in NoteNew.test.
- **No dropped tail on any hop (review fold)** — the debounced write is flushed synchronously on
  the composer's **blur** (fires on pointerdown, before ANY outside door — the mobile "+",
  speed-dial, palette, setup-nudge — navigates to `/new`, whose render-phase draft read would
  otherwise beat an unmount-time flush and lose the just-typed tail; worst case the whole note,
  since the autosave debounce re-arms on every keystroke). Per-link `onClick` flushes stay as
  belt-and-suspenders; a regression test pins the blur path.
- **"Save to {vault}" without leaving Today**: commits through the same path NoteNew's text save
  uses — new shared `buildTextNotePayload` (`src/lib/capture/text-note.ts`: capture role tag +
  `#hashtag` extraction + `metadata.source: "text"`), `useCreateNote`, fire-and-forget
  `ensureNotesSchema`. No navigation: the composer clears, a quiet toast confirms, and the note
  settles into the recent list (`useCreateNote` now also invalidates `notesForDateViews` so
  Today/Calendar/Activity see creates immediately). A failed save keeps the words + says why.
  ⌘/Ctrl-⏎ saves.
- **Mic → the W2-9 voice arrival** (`/new?voice=1`, recorder auto-starts once the capability gate
  settles), behind the same transcription gate as `/new`: an explicitly-disabled vault gets no mic
  and the honest two-door line instead (`VoiceUnavailableNote` extracted to `src/components/` —
  shared, not duplicated).
- The empty-vault "Write the first one" CTA now focuses the composer in place instead of hopping
  to `/new` — the affordance and the action finally agree. Vault switches mid-compose remount the
  composer keyed by vault id (the notes#175 draft-clobber guard).

## [0.9.0] - 2026-07-11

**W2-9 — speed-dial + command-palette presentation (adopt #5 #6).** The prototype's two
capture/navigation affordances land in the app's language — honestly (no fake AI). Minor bump: two
new visual surfaces (the desktop SpeedDial; the palette's bloom/sheet presentation).

- **Desktop speed-dial** (`SpeedDial.tsx`, prototype shot 15): a floating coral "+" disc, top-right,
  that expands DOWNWARD into three verbs — **New note** → `/new` · **Voice note** → `/new?voice=1`
  (lands IN voice capture, no extra tap) · **Import notes** → `/import`. Label pills beside forest
  icon discs; Escape/click-outside/route-change close; springy hover behind
  `prefers-reduced-motion`. **Desktop ≥lg only** — the mobile [+] still hops straight to `/new`
  (the breakpoint contract test pins both sides). Hidden under ceremonies (§4.1 rule 5) and on
  `/new` itself; top-right placement stays clear of the Map FAB (bottom-right) and the palette pill
  (bottom-centre).
- **`/new?voice=1` voice arrival:** the create surface auto-starts the recorder once the
  transcription-capability gate has an ANSWER — never during the pending window (an auto-fired mic
  toward "_Transcription unavailable._" would be the product lying). New `useTranscriptionGate()`
  (capability + `settled`) backs it; `useTranscriptionCapability()` is unchanged for render gates.
- **Command palette, restyled** (`QuickSwitch.tsx`, prototype shot 13) — same results engine
  (merged commands + notes + tags, same ranking, same keyboard nav), new presentation:
  - **Desktop:** a bottom-centre glass pill (`.glass-panel`, shadow grows `soft→lift` on focus);
    the result panel **blooms upward** above it (`--radius-2xl` + `--shadow-lift`).
  - **Mobile:** a full-screen sheet from the Search tab — pill row up top with an explicit Cancel,
    results filling the screen.
  - Opens from all three doors — rail Search, ⌘K, mobile Search tab (each pinned by a test).
- **The honest "Smart" slot:** the pill's right side RESERVES space for a future Smart toggle as a
  clearly-inert placeholder (a dimmed `aria-hidden` span — not a control). The prototype's
  "Smart search" AI-prompt rows are mocked and the app has no ask-AI endpoint; shipping fake
  prompts violates the honesty rule (DESIGN-SPEC W2-9 [spec-resolved], §6-A2 owns the future
  toggle).
- Ceremony-route gate (`CEREMONY_ROUTES`/`isCeremonyPath`) re-homed from `App.tsx` to
  `@/lib/nav/model` so chrome components share one list. New `IconPen`/`IconMic` glyphs.

## [0.8.0] - 2026-07-11

**W2-8 — `/account` "Your parachute" + trial ambience (F4 full / WALK-manager #1).** The manager
half gets a real home: the account page rebuilds into the prototype-language four-card stack, the
plan can never silently vanish again, and the trial surfaces ambiently in exactly the four
sanctioned places. Minor bump: a full surface rebuild plus a client-contract addition
(`getAccountSummaryState`).

- **`/account` rebuilt as "Your parachute"** (DESIGN-SPEC §3.1): H1 + sub-line, no breadcrumb (a
  primary-nav room, F11), four cards at prose width — **Identity** (`SIGNED IN AS` eyebrow, email
  in Fraunces, inline plan chip: sun-soft trial countdown / quiet plan label / none on failure,
  the quiet Sign-out ghost), **Plan & billing**, **Your vaults**, **Connections**. The signed-out
  "This device" view is unchanged.
- **The five Plan & billing states, all designed** — loading (skeleton lines) · billing-disabled
  (card absent) · **summary-fetch-FAILED (the card's own retry state: "Couldn't load your plan." ·
  "A hiccup reaching your account — your plan hasn't changed." · pill Retry that recovers in
  place)** · trial/free (current-plan line + interval picker + plan cards) · paid (portal pill).
  Previously a failed `GET /account/summary` silently removed ALL plan information from the app
  with no symptom and no retry (WALK-manager #1, `desktop-11-null-summary-account.png`).
- **Failed ≠ absent — the tri-state summary seam.** New `getAccountSummaryState()` (client.ts):
  200 → summary, **404/501 → `null`** (the door honestly serves no summary — a hub's steady
  state; the card is absent, never a retry that can't succeed), **anything transient → `"error"`**
  (network/5xx → the retry card). Ambient consumers read through the new `summaryOrNull()` helper
  over the shared hook (a chip collapses both `null` and `"error"` to no-chip); the old
  `getAccountSummary()` is removed.
  The shared `useAccountSummary()` hook now carries the tri-state (error answers are never cached:
  `staleTime` 0 on `"error"`), and `/account` consumes the same cached query as the switcher and
  the nav badge.
- **Honest checkout errors:** a 400 `invalid_plan`/`invalid_interval`/`invalid_tier` now reads
  "That plan isn't offered on this cycle — pick another." — never "Billing isn't available right
  now." for a plan-shaped 400 (that line is reserved for real unavailability: 503/unknown).
  Billing errors render as the visible danger-soft line, not a dim gray whisper.
- **Honest per-interval price lines** (decision a): each plan card lists every cycle it actually
  sells from the door's own labels — Entry reads "$3/quarter · $10/yr — about $1/mo", with the
  "about" equivalence only for tiers with no monthly cycle. Interval-picker mechanics unchanged
  (PR #11); this is the §3.1 restyle around them.
- **Vaults card:** "n of m on your plan" meter (only when the summary carries both numbers),
  glyph-circle rows (initial in grass-soft · name in Fraunces · mono address · usage · "Open →"
  pill), the failure retry card kept, and the foot collapsed to **one verb** "＋ Add a vault" →
  `/add-vault` (the chooser holds the create/connect fork; the old two-verb foot and the "All on
  this device →" header link retire — the rail/sheet's Vaults row carries that door now).
- **Connections card:** two icon-in-soft-circle rows — "Connect your AI" → `/connect`, "Import
  notes" → `/import`; with no active vault the AI row dims with "Open a vault above to connect an
  AI to it."
- **Trial ambience — exactly the four sanctioned places (decision b), nowhere else:** (1) the
  switcher foot line (W2-4, verified), (2) Home's `PlanBacklink` becomes "Free trial · N days
  left · Manage your account →" while trialing, (3) the rail/sheet "Account & plan" badge (W2-5,
  verified — now reads through the tri-state), (4) **the Today countdown nudge, only at
  `trial_days_left ≤ 7`**: a sun row under the composer — "Your trial ends in N days — see
  plans →" → `/account`. Not dismissible, never a modal, never on any other page.

## [0.7.1] - 2026-07-11

**W2-7 — route renames with shims: `/all`→`/notes`, `/graph`→`/map` (F16).** Label–URL agreement:
the nav rows have said "Notes" and "Map" since W2-5; the addresses now match. Patch bump: additive
route-table change — every old bookmark still resolves, nothing existing breaks.

- **`/notes` is now the canonical Notes room** (`/all` becomes a `replace` shim, preserving the
  query string — `/all?view=pinned` lands on `/notes?view=pinned`). **`/map` is now the canonical
  Map room** (`/graph` becomes the same kind of query-preserving `replace` shim). New shared
  `App.tsx` helper `ShimPreservingQuery` implements both. The `/pinned`/`/archived`/`/untagged`/
  `/orphaned` view-shims retarget from `/all?view=` to `/notes?view=`.
- **Mount-detection fix (review fold):** the legacy notes-daemon mount pattern in `base-url.ts`
  matched a bare `/notes` as well as `/notes/…`; a bare `/notes` now falls through to the root mount,
  so a hard load / refresh / share of the new `/notes` route on the root-hosted deploy renders the
  Notes list (not Home) and keeps `?view=`. `/notes/` and deep legacy routes still detect the mount.
- Command-palette row label "Graph" → **"Map"** (was still drifting from the rail/sheet label).
- **`src/lib/nav/model.tsx`'s `NOTES_TO`/`MAP_TO`/`matchNotes` flip to the new addresses** — the
  Rail, NavSheet, and BottomTabBar all consume these, so no component-level drift was possible.
  Every other inbound link (`AmbientMapFab`, the command palette's rows and tag-jump, `Notes.tsx`'s
  own `?view=`/saved-view/tag links, `NoteView`/`NoteEditor`/`NoteNew`/`Import`/`Home`/`Tags`'s back-
  and tag-links) retargets to `/notes`/`/map`.
  Zero stray `/all`/`/graph` references remain outside the App.tsx shim definitions (and the tests
  that exercise those shims directly).
- **Route-order guard:** `/notes` is registered ahead of the `/:id` bare-path bookmark shim, so a
  note literally named "notes" is reachable only at `/n/notes` — the same accepted tradeoff as the
  ceremony denylist (React Router's ranked matching already prefers static segments over `/:id`
  regardless of declaration order; a regression test pins it).
- **`NAVIGATION.md`** updated: the redirect-shims row drops its "pre-W2-7" placeholders now that
  the rename has shipped, and retargets the view-shims to `/notes?view=`.

## [0.7.0] - 2026-07-11

**W2-6 — wizard chrome + stepped creation + activation honesty (F6 full / F7-ceremony /
WALK-manager #2 full).** One ceremony shell with an escape on every step, the creation flow gets
real URLs, and creating a vault stops silently switching you into it. Minor bump: the route table
gains `/add-vault/create` + `/add-vault/ready` and `createHostedVault()` changes contract
(mints only — no local store writes).

- **New `src/components/WizardShell.tsx` (DESIGN-SPEC §4.1, verbatim contract)** — the ONE
  full-screen ceremony chrome. The four duplicated local `Shell` components (Welcome,
  AddVaultChooser, AddVault, OAuthCallback) collapse into it. Rules enforced by the shell:
  wordmark is always a link; a quiet escape on every step (`escape: none` legal only for <3s
  auto-advancing beats — SigningIn, WelcomeBack, OAuthCallback's working beat, the creating
  tick); 3-segment progress (`Name · Making it · Ready`) renders ONLY on the creation ceremony;
  no spinner, ever. **Every escape is history-aware** (`useHistoryAwareBack`, W2-2's hook):
  "← Back"/"Maybe later" land wherever the person actually came from, degrading to a named
  fallback on a deep link — never a forward push-loop, never off-app. "← Back" sits in the top
  strip; "Maybe later" renders under the content (the prototype's "Skip for now" placement).
- **Stepped creation URLs (§4.2), new `src/app/routes/AddVaultCreate.tsx`:** the naming form
  lives at `/add-vault/create` (`?first=1` = onboarding copy, reached from /welcome's
  first-vault branch); submit runs the creating beat **in-shell at the same URL** (a process,
  not a place); success **replaces** to `/add-vault/ready?vault=<name>` (consumes the naming
  entry); failure re-renders the form inline with the F12 friendly copy. Back from naming → the
  chooser; **Back from ready → the chooser** — the WALK-manager `desktop-33` stale-context repro
  is dead, locked by a real-BrowserRouter history-shape suite (`src/app/wizard-history.test.tsx`).
- **THE CORRECTNESS FIX — activation honesty (`lib/account/hosted-vault.ts`):**
  `createHostedVault()` no longer composes `openHostedVault()` — it **mints only** (the
  account-side create call; no VaultRecord, no stored token, no active-vault switch; cloud's
  inline `vault_token` is deliberately discarded so "Maybe later" leaves zero unused credentials
  behind). The ready beat's **"Open {name} →"** is where activation actually happens
  (`openHostedVault` + the §4.4 "Now in {name}" toast + push to `/`); **"Maybe later"** (absent
  in `?first=1` onboarding) declines with no switch and no toast — every page behind the
  ceremony stays truthful. Returns the door's canonical vault name.
- **`Welcome.tsx` slims to dispatcher + picker:** first-vault → replace
  `/add-vault/create?first=1`; welcome-back → auto-open beat → replace `/`; many → picker in
  place; `?new=1` → pure shim to `/add-vault/create` (old bookmarks keep working); `?pick=1`
  unchanged. The W2-2 param-keyed dispatch-resync guard is preserved.
- **`CheckEmail.tsx`** gains its named escape — "← Back to sign in" (route-map row 27).
- **Footer gating (§4.1 rule 5 / F21):** the App.tsx AGPL footer no longer renders under
  ceremony routes (route-list gate in `AppFooter`; `/` — Home or the marketing Landing — keeps
  it: the marketing front door's ecosystem footer stays deliberate).
- **Inbound links retargeted:** the chooser's Create card, the switcher's "Create a vault" verb,
  the picker's "＋ Create a new vault", and Account's two create links all point at
  `/add-vault/create` (no double-shim hop). `NAVIGATION.md` gains the new rows (creation
  success replace, ready-Open push, the `?new=1` shim) and every touched `navigate()` carries
  its rule citation.
- Tests: new `WizardShell.test.tsx` (chrome rules, escape kinds, history-aware behavior,
  progress) + `AddVaultCreate.test.tsx` (both copy contexts, creating beat, replace-to-ready,
  **create-mints-only**, F12 copy, escapes) + `wizard-history.test.tsx` (the Back-shape proofs,
  BrowserRouter) + hosted-vault mints-only unit tests + App footer-gating tests; Welcome /
  chooser / CheckEmail / AddVault / switcher suites updated to the new shape.
- **Closes F6 (full), F7 (ceremony half), WALK-manager #2 (fully).**

## [0.6.0] - 2026-07-11

**W2-5 — two-zone rail + mobile NavSheet: the IA centerpiece (F14 / F15-structure / F21-header /
adopt #4 #9 #12).** "Your notes" and "Your parachute" become NAMED zones, rendered on both form
factors from ONE nav model. Minor bump: the navigation IA changes shape (labels, zones, the mobile
menu) — every room stays reachable, no route changes.

- **New shared nav model `src/lib/nav/model.tsx` (`useNavBands()`, DESIGN-SPEC §2.1)** — the single
  source both projections render. Bands: YOUR NOTES (Today · Notes · Calendar · Tags · Activity ·
  Map-once-earned) · YOUR PARACHUTE (Account & plan · Vaults · Connect AI · Import notes) · SET UP
  (incomplete guided steps + an "n of m" count, hidden once done/dismissed — no more persistent
  "You're all set" row) · foot (Settings). Neither projection owns a room list, so desktop and
  mobile can't disagree again (F14's root fix). Labels land now ("Notes", "Map"); the route
  renames (`/all`→`/notes`, `/graph`→`/map`) are W2-7's.
- **Desktop rail rebuilt (§2.2):** two labeled bands (sage eyebrows), the VaultSwitcher on top
  (the hinge), Settings pinned at the foot (theme toggle keeps its spot), `glass-panel` ground.
  **Collapsible to a 64px icon rail** — icons only, tooltips carry labels, the switcher shows the
  vault-initial glyph; width animates 300ms (reduced-motion aware); persisted in
  `localStorage("parachute.rail-collapsed")`. Calendar is promoted into the notes band (desktop
  reaches it from the nav for the first time); Home's W2-3 stopgap Calendar link retires.
  Account leaves the foot for the parachute band as "Account & plan", carrying a quiet sun-soft
  trial chip ("5d") while trialing (§3.1 ambience slot 3; summary fetch only for home-door vaults).
- **New mobile `NavSheet.tsx` (§2.3)** replaces the ☰ dropdown junk-drawer: a bottom sheet
  (max-h 85dvh, rounded top, glass over a scrim, drag handle, focus-trapped dialog; closes on
  scrim/Escape/swipe-down/route change) rendering **exactly the rail's bands in the rail's order**,
  with the switcher band inline at the top (§2.4 rows, not a nested popover) and the foot carrying
  Settings + the ☰ era's extras (InstallPrompt · TextSizeControl · ThemeToggle). **☰ and the
  header's vault pill both open this one sheet** (the pill lands on the switcher band) — one menu
  vocabulary. **Tags and Vaults become reachable on mobile for the first time** (F14).
- **VaultSwitcher variants (§2.4 contract):** the panel (row model unchanged) extracts to an
  internal `SwitcherPanel`; `rail` keeps the trigger + popover, new `sheet` renders the rows
  inline in the NavSheet, and `header` owns no panel anymore — the pill delegates to the NavSheet.
- **Map gate agreement (route-map row 11):** the Map nav row is earned-gated on BOTH projections;
  `AmbientMapFab` is the pre-earn door on both form factors and now hides on BOTH once earned
  (it used to linger on mobile).
- **Header noise (F21, header part):** the "No vault connected" state line is gone; the bar shows
  the wordmark (no vault) or the pill + sync dot (vault).
- **BottomTabBar** unchanged in shape (Today · Notes · [+] · Search; [+] stays a direct hop to
  `/new`) — its active-state matching now imports the model's shared rules instead of a copy.
- **a11y (review fold):** the NavSheet focus-trap now pulls focus back in whenever it sits outside
  the sheet (the container itself or the scrim button) — Shift+Tab can no longer walk backwards out
  to the page behind the scrim. Route-change close and the trap-backwards guard both gain tests.
- Tests: new `src/lib/nav/model.test.tsx` (zones/order/gates/chip/shelf) + `NavSheet.test.tsx`
  (bands, F14 reachability, active state, close gestures incl. route-change + trap-backwards,
  no-vault foot); the breakpoint contract extends with a **band-parity assertion** (Rail ≡
  NavSheet, unearned + earned) and the NavSheet's `lg:hidden` gate; Rail/Header/AmbientMapFab/
  VaultSwitcher suites updated to the new IA.
- **Closes F14 (full), F15 (structure), F21 (header-noise part), adopt #4 #9 (nav rows) #12
  (shelf collapse).**

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
