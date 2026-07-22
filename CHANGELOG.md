# Changelog — @openparachute/parachute-app

## [0.20.35] - 2026-07-22

**Tall focus-mode editor canvas — long-form writing gets the room the collapsed header frees up.**
Follow-up to the 0.20.34 freeze fix. That fix bound the editor pane to a definite `h-[60dvh]` so
`.cm-scroller` (not the page) is the scroll container — but `NoteEditor`'s focus mode collapses the
whole header card to a floating whisper, then still rendered the editor inside that same 60dvh box,
leaving ~40% of the viewport as dead space below the words — the opposite of "just me and the words"
for morning-pages writing.

- **Fix:** in focus mode the editor (and, on desktop, its side-by-side preview) pane now gets a taller
  `h-[85dvh]` — still a DEFINITE, `dvh`-relative height paired with `min-h-0`, so the `.cm-scroller`-is-
  the-scroll-container invariant (and thus the freeze fix) holds in focus mode too. Non-focus mode is
  unchanged at `h-[60dvh]`. A single `paneHeight` var drives both panes so the desktop split stays a
  matched pair. `src/app/routes/NoteEditor.tsx`.
- **Freeze-guard tests tightened:** the regression guards used `className.toContain("h-[60dvh]")`, which
  also matches the substring inside `min-h-[60dvh]` — a silent demotion to `min-h`-only (which revives
  the padding runaway) would have passed. Now a word-boundary regex (`/(?:^|\s)h-\[(?:60|85)dvh\]/`)
  requires a standalone definite height, and a new test asserts focus mode gets the taller `h-[85dvh]`
  while keeping `min-h-0`. `src/app/routes/NoteEditor.test.tsx`, `src/app/routes/NoteNew.test.tsx`.
- **Height-chain + iOS notes:** added a cross-reference comment at the `CodeMirrorEditor` host div
  (`h-full overflow-auto`) pinning the four-link height chain (pane definite height → dropzone
  passthrough → `h-full` host → `.cm-scroller`) against a future silent break, and a note flagging that
  CM tooltips (`position:absolute`, e.g. the "/" slash menu) can clip at the pane's `overflow-auto` edge
  on iOS — a manual-check exposure, no speculative fix. `src/components/CodeMirrorEditor.tsx`.

## [0.20.34] - 2026-07-22

**Editor freeze fix — stop `scrollPastEnd` padding runaway (down-arrow freeze on long notes).**
After a writing session on a long note, holding or repeatedly pressing the down arrow at the bottom of
the editor could stall the tab for ~15s. Root cause: `scrollPastEnd()` (CodeMirror's stock extension,
added in editor Wave 1) sets `.cm-content` `padding-bottom` to `scroller.clientHeight − oneLine`. In a
CONTENT-sized editor the scroller's `clientHeight` *includes* the padding it wrote last pass, so every
cursor move at the viewport bottom re-reads inflated geometry and grows the padding by ~one doc-height —
on a long note it reaches millions of px and the layout/paint stalls. The editor was content-sized
because the height chain collapsed: `NoteEditor`/`NoteNew`'s editor grid was `min-h-[60vh]` + auto, so
the `height:100%` chain down to `.cm-scroller` never resolved to a definite value and `.cm-scroller`
never became the scroll container (the page was). CodeMirror's own docs: `scrollPastEnd` "should not be
enabled in editors that take the size of their content."

- **Fix (approach A — bound the pane):** the editor (and, on desktop, the side-by-side preview) pane now
  gets a DEFINITE `h-[60dvh]` height plus `min-h-0`, so `.cm-scroller` is the real, content-INDEPENDENT
  scroll container. `scrollPastEnd`'s padding now converges to one viewport (only when the doc actually
  overflows) instead of running away. `dvh` (not `vh`) so a mobile soft keyboard shrinks the pane with
  the visual viewport. Covers every `buildExtensions` surface — `NoteEditor` (edit route) and `NoteNew`
  (compose) — in both raw and live-preview modes, desktop and mobile. `NoteNew`'s preview binds only at
  `lg` (its panes stack on mobile, where a second fixed box would just be dead space above Attachments).
  `src/app/routes/NoteEditor.tsx`, `src/app/routes/NoteNew.tsx`.
- Does not touch `scrollPastEnd()` itself or `bottomScrollMargin` (the #64 "jumping to paragraph top"
  fix) — the scroll-off is unchanged; the bounded pane makes that area behave better, not worse.
- Regression guards in `NoteEditor.test.tsx` / `NoteNew.test.tsx` pin the structural cause (the pane
  carries a definite height + `min-h-0`, not `min-h`-only). Manual verify on a long note:
  `document.querySelector('.cm-content').style.paddingBottom` stays ~500–900px, not 6–8 digits.

## [0.20.33] - 2026-07-21

**Offline-mirror runaway fix — stop re-fetching the same 200 notes forever.** On a self-hosted box the
mirror hydration walk never terminated: it kept re-applying the first page of notes (the `notesApplied`
count ran into the tens of thousands) and never persisted a cursor, so every refresh started cold. Root
cause was a broken cursor contract in the bundled SDK, plus an engine loop that couldn't defend against
it. Three fixes:

- **Bump `@openparachute/surface-client` `0.3.5` → `^0.3.6`** (the actual fix). 0.3.5's
  `queryNotesCursor` omitted the `cursor` param on the bootstrap (empty-cursor) call and read the next
  cursor ONLY from an `X-Next-Cursor` header the self-host daemon never emits (the cross-door contract
  is the body's `next_cursor`). Net: every page returned the same first 200 notes with
  `nextCursor: undefined`, so the drain never advanced, never persisted a cursor, and never terminated.
  0.3.6 sends `?cursor=` (empty included) and parses the `{ notes, next_cursor }` body envelope. Lockfile
  deduped to a single 0.3.6 (surface-render's transitive `^0.3.3` resolves to it).
- **Engine defense-in-depth** (`src/lib/mirror/engine.ts`, closes app#79 items 1+3). A non-empty page
  that carries no `next_cursor` is now a hard contract violation → error state (never
  `lastSyncedAt`-stamped), instead of an infinite loop. The completion watermark is gated on CLEAN
  empty-page exhaustion only — a no-advance stop no longer marks a partial mirror "synced" (#79 item 1).
  The same contract guard is mirrored in the reconcile sweep's enumeration (`complete: false` → aborts
  rather than over-deletes). Plus a hard per-drain/enumeration page cap (default 1000) as a final belt.
- **"N of ~T" hydration progress** (`src/components/MirrorStatusLine.tsx`, #79 item 3). The denominator
  now reads the real wire field `stats.totalNotes` (both daemons emit it) instead of the SDK type's
  stale `noteCount` (never on the wire → always undefined). Rides the already-fetched vault-info query,
  so zero extra traffic; copy is "Saving your vault for offline · N of ~T", falling back to bare "· N"
  when the total is unknown.

## [0.20.32] - 2026-07-21

**Door-aware pre-auth — stop showing cloud onboarding on a self-hosted hub.**
The hub already serves a correct door descriptor (`door: "hub"` + an `auth` block), but the app
DEFAULTED to cloud onboarding (the magic-link email form + hardcoded pricing) whenever the descriptor
was unresolved, failed, stale, or absent — so a self-hosted box (and any surface-mount served by a
descriptor-less host) landed on a cloud sign-up. The door is a property of the SERVING origin's
runtime; the app now treats an unknown door as NEUTRAL, never cloud, and gates cloud copy on a
CONFIRMED cloud-shaped descriptor. No hostname assumptions; account endpoints stay
serving-origin-relative.

- **Neutral unknown-door state** (`src/app/routes/Landing.tsx`) — `FrontDoor` now forks into THREE
  states instead of "hub-or-cloud": (a) UNRESOLVED (null / in-flight / unclassifiable) → a
  door-NEUTRAL shell (mark + headline + one "Sign in" → the `/add` connect flow), with NO cloud email
  form, NO pricing, NO "create your account"; (b) CONFIRMED cloud/magic-link → the existing email form
  (unchanged); (c) CONFIRMED hub/password → the hybrid card below. This also fixes the surface-mount
  class (app at `/surface/<slug>` on a descriptor-less host → neutral, not cloud onboarding).
- **Durable per-origin door cache** (`src/lib/account/descriptor.ts`) — the resolved door moved from
  sessionStorage to **localStorage keyed by origin**, with **stale-while-revalidate**: a door already
  known for the origin paints synchronously (`peekDoorDescriptor`, no neutral flash on a returning
  tab) while a single background refetch runs and `onRevalidate` swaps in a changed door. A fetch
  FAILURE never overwrites a known door and `null` is NEVER persisted — so a box that once identified
  as a hub keeps painting hub across reloads and OFFLINE (pairs with the offline-mirror arc).
- **Hybrid hub sign-in card** (Aaron's ratified choice) — a confirmed-hub door renders one PRIMARY
  action, **"Open your parachute"** (OAuth-connect at the serving origin — the hub's login rides
  inside its authorize/consent — landing straight in the vault; reuses the `/add` `beginOAuth` path,
  skipping the URL form), plus a quiet SECONDARY **"Manage this parachute"** (the existing ceremony
  hop to the hub's `/login?next=<mount-aware /welcome>` → account session → vault manager). The card
  names the box ("Sign in to `<serving-origin-host>`"); no cloud email/pricing anywhere on it.
- **Descriptor-driven pricing** — the cloud form's "Plans from $N a year" line is derived from the
  descriptor's `plans` (cheapest advertised yearly, falling back to monthly) instead of a hardcoded
  string, so the copy travels with the door (cloud carries `plans`; a hub's is empty → no price line).

## [0.20.31] - 2026-07-21

**Offline mirror — correctness fix: never serve a PARTIAL list from a mid-hydration mirror.**
A vault's mirror hydrates by walking an `updated_at`-ordered cursor, but the offline list evaluator
(`readNotesList`) sorts by `created_at` (the vault's non-cursor list default). While the initial cold
hydration is still in flight, the mirror therefore holds an arbitrary, shifting SUBSET — so an offline
list read (or the cold-launch seed) could present a partial vault as if it were the whole thing, with
the visible set changing as hydration advanced. Aaron hit this live. This release gates mirror LIST
reads on a **completed initial hydration**.

- **Completeness gate in `readNotesList`** (`src/lib/mirror/read.ts`) — the evaluator now returns
  `null` (caller stays network-only, exactly as for an unreproducible query shape) until the vault's
  initial cold hydration has drained its cursor to exhaustion at least once. The signal is the
  persisted **`lastSyncedAt`** watermark, which the engine writes only AFTER `drainCursor`'s full walk
  completes — it is durable across restarts, is unaffected by the transient `hydrating` phase a warm
  re-poll passes through every tick (so a complete mirror never briefly refuses reads), and is cleared
  only by "Clear offline copy" (which correctly re-arms the gate so the re-fill runs cold). Because
  both the offline fallback (`withMirrorList`) and the cold-launch seed (`useMirrorListSeed`) route
  through `readNotesList`, one gate covers both. Before the mirror is ready, the app keeps its normal
  network-first behavior and the "Saving your vault for offline · N" progress line is the user's cue.
- **Single-note reads unchanged** — `readNote` is intentionally NOT gated: an already-mirrored note
  opens correctly mid-hydration, and a not-yet-mirrored one already falls through to the network.
- **Tag list exempt** — the mirrored tag list is written atomically (one `listTags()` → one
  `setMirrorTags`) and only after a clean drain's reconcile sweep, so `getMirrorTags` never returns a
  mid-hydration partial; no gate needed (documented at `withMirrorTags` in `queries.ts`).
- **Drain cadence** — verified `drainCursor` already loops to cursor exhaustion within a SINGLE tick
  (not one page per 60s), so a cold hydration finishes as fast as the network allows; no fast-path
  change was needed.

## [0.20.30] - 2026-07-20

**Offline mirror — ACTIVATION: the durable-offline mirror is now ON by default.** Waves 1–4 built
and shipped the whole mirror behind a default-OFF flag — store, cursor hydration, deletes-reconcile,
local-first reads, staleness UX, storage ceiling/eviction, and a Settings surface. Aaron ratified
turning it on. This release flips that single lever: a fresh browser now hydrates its vault into
IndexedDB and serves reads local-first, with the offline/staleness UX live.

- **Default flipped ON** (`src/lib/mirror/flag.ts`) — `MIRROR_ENABLED_DEFAULT = true`. The
  `parachute:mirror:enabled` localStorage override still works per-device and now cuts **both ways**:
  `"false"` forces the mirror OFF (a per-device opt-out without a rebuild), `"true"` forces it ON.
  With neither key set, the compile-time default decides. `isMirrorEnabled()` remains the single lever
  every read/write/hydration path reads.
- **`clearOffline` meta cleanup** (#74) — "Clear offline copy" now also drops the vault's sync-state
  meta (`state` / `lastSyncedAt` / `lastSweepAt` / `tags`) via a new `clearMirrorMeta` store helper,
  not just the note rows + cursor. A cleared vault now reads truly EMPTY: a reload can't repaint a
  stale "synced · last synced X ago", and the re-fill runs COLD (hydration progress shown) instead of
  being treated as a warm no-op. The write queue (`pending` / `id_map` / `blob_path_map` / `blobs`) is
  untouched — the same sacred-work exclusion as before; un-synced work is never dropped.
- **Engine crash-safety** (`src/lib/mirror/engine.ts`) — `syncOnce()` runs fire-and-forget from the
  tick interval + online/visibility listeners (and directly from Settings "Sync now"), so it must
  never reject. It now backstops the rare throws outside `drainCursor`'s own guard (chiefly a
  torn-down or evicted IndexedDB throwing from the pre-drain cursor reads or the error-state write)
  and resolves to an error result instead of surfacing an unhandled promise rejection.

## [0.20.29] - 2026-07-20

**Views Wave 2b — the board, gallery, and calendar view KINDS now render.** A `#view` note already
carried its `kind` (`list` | `board` | `calendar` | `gallery`), and the nav glyph already matched, but
ViewSurface only ever drew a list — so a board laned by status, a meetings calendar, and a reference
gallery all flattened into the same rows. ViewSurface now dispatches on `view.kind` over the SAME
fetched results; the `list` kind is unchanged and any unknown/missing kind (or a board/calendar
missing its lane/date config) still degrades to the list.

- **Board** (`kind: "board"`, `lane_by: <field>`) — result notes become COLUMNS keyed by the distinct
  values of the `lane_by` metadata field; notes missing that field collect in a trailing, muted
  "No {field}" lane (always last). Lane order honors the subject tag's schema `enum` when it declares
  one (the authored order), else a small built-in order for common fields (`status`, `priority`), else
  alphabetical. Lanes scroll horizontally on overflow; pinned notes surface within their lane, keeping
  their star. Empty lanes are never drawn.
- **Gallery** (`kind: "gallery"`) — results as a responsive auto-fill grid of cover cards (a cover
  image when the note carries a directly-usable image attachment, else a text tile) — the "bookshelf".
- **Calendar** (`kind: "calendar"`, `date_field: <field>`) — a real month grid: weeks as rows, days as
  cells, each dated note a chip on its day. Clicking a day with notes opens a panel of that day's notes
  below; ◀/▶ navigate months and it opens on the month of the most recent dated note. The `date_field`
  value is parsed defensively (ISO date / datetime, read on its wall-clock day); notes with a
  missing/unparseable date are omitted and counted in a footnote. The grid mechanics are shared with
  the `/calendar` route via `@/lib/dates`.
- New: `src/lib/views/grouping.ts` (pure lane-grouping + calendar-placement logic, unit-tested),
  `src/components/views/{NoteCard,BoardView,GalleryView,CalendarView}.tsx`.

## [0.20.28] - 2026-07-20

**Offline mirror — Wave 4: staleness UX + storage ceiling/eviction + a Settings surface, behind the
same default-OFF flag.** Waves 1–3 built the mirror store, cursor hydration, deletes-reconcile, and
local-first reads. This wave adds the user-facing edges: how a stale/offline copy is signalled, a
per-vault storage ceiling so the mirror can't grow without bound, and a place to see + manage it.
Still gated by the SAME flag, and the flag **STAYS default OFF** — with it off, every path below is
byte-identical to the network-only behavior that shipped before (no UX renders, no eviction runs,
the Settings row is absent). Activation is a separately ratified step.

- **Storage ceiling + eviction** (`src/lib/mirror/evict.ts`) — a **512 MB per-vault** ceiling
  (Aaron-ratified). Past it, the mirror **evicts note bodies oldest-`updatedAt` first** but **keeps
  the index row**: content/links/attachments are dropped and `contentEvicted` is set, while a
  snapshotted preview + title are retained, so every note stays listable and openable-with-preview
  offline (an evicted note shows "Connect to load this note" when opened offline). Eviction is
  `byteSize`-aware (prefers the vault's wire `byteSize`, falls back to a content-length estimate) and
  runs after a clean drain/sweep when over-ceiling, under the same per-vault Web Lock. It **NEVER
  evicts a bare local-id row or a row with a pending queue mutation** — the same sacred-work
  exclusion the reconcile sweep uses (un-synced work is never dropped).
- **Staleness UX** (all subtle, flag-gated; COPY IS A DRAFT pending sign-off) —
  - a quiet chrome line while offline and serving the saved vault: "Offline — showing your saved
    vault · updated {relative} ago" (only once there's a saved vault to show);
  - a one-time hydration progress line on first fill: "Saving your vault for offline · {n}/{total}"
    (non-modal, gone on completion);
  - a subtle "Saved copy" marker under the title of a note served from the mirror while offline;
  - "Connect to load this note" in place of the body of a content-evicted note opened offline.
- **SyncContext `mirror` slice** (`src/providers/SyncProvider.tsx`) — `{ enabled, state
  ("off"|"hydrating"|"synced"|"offline"|"error"), progress?, lastSyncedAt, syncNow, clearOffline }`,
  fed by new mirror-engine `onStateChange`(cold-hydration only) + `onProgress` callbacks. One source
  of truth for the chrome line, the note chip, and Settings.
- **Settings → Offline section** — mirror status + last-synced, storage used against the 512 MB
  ceiling, **Sync now** (an incremental cursor run + sweep + eviction), and **Clear offline copy**
  (wipes this vault's `mirror_notes` + resets its cursor, with a confirm). Clear touches ONLY the
  mirror store — never the write queue / un-synced work. The whole section is hidden when the flag is
  off.

## [0.20.27] - 2026-07-20

**Offline mirror — Wave 3: local-first READS + cold-launch offline, behind the same default-OFF
flag.** Waves 1–2 built the mirror store, cursor hydration, and deletes reconciliation — all
write-only/invisible. This wave adds the READ path so the app serves notes from the mirror when
offline or on a cold launch. Still gated by the SAME flag, and the flag **STAYS default OFF** — with
it off every path below is byte-identical to the network-only behavior that shipped before; with it
on (dev/test), reads fall back to the mirror. Activation (flipping the flag on) is a separately
ratified step — Aaron ratifies the storage ceiling + staleness UX + flag-on timing as a batch after
Wave 4; this wave ships nothing user-visible on its own.

- **The read evaluator** (`src/lib/mirror/read.ts`) — `readNote(vaultId, id)` returns the FULL
  mirror row (content/links/attachments, never a lean stub), resolving a synced local id through the
  id-map and falling back to the optimistic local-id row for an offline-created note that hasn't
  drained. `readNotesList(vaultId, params)` is a client-side evaluator over `mirror_notes` for the
  SMALL query subset the list hooks actually send — tag filter (`tag_match` any/all), `path_prefix`,
  `has_tags`/`has_links`, `sort`, `limit`/`offset` — reproducing the vault's server semantics
  exactly, including the default sort by **`created_at DESC, id DESC`** (the vault's non-cursor list
  order — NOT `updated_at`). It returns `null` for anything it can't reproduce faithfully (a `search`
  FTS query, or any param outside the subset), so the caller stays network-only rather than ever show
  a list that DIFFERS from the server's. (Fidelity note: the app sends no `expand`, so exact-match tag
  filtering equals the vault's default `subtypes` expansion for FLAT vaults; a declared tag hierarchy
  would see child-tagged notes omitted under a parent-tag filter offline — documented, acceptable.)
- **Network-first, mirror-fallback read hooks** (`src/lib/vault/queries.ts`) — `useNote`, `useNotes`,
  `useNotesForDateViews`, `useNotesForPathTree`, and `useTags` now (when the flag is on) try the
  network first and fall back to the mirror when the vault is offline (fast path, skips the network)
  or unreachable (`VaultUnreachableError` — the installed-PWA `onLine===true`-but-dead case). They
  seed `placeholderData` from the mirror so a cold launch paints the last-mirrored notes instantly,
  then background-revalidate. The switcher (`useAllNotesForSwitcher`) and graph (`useAllNotesWithLinks`)
  stay network-only (Wave-later); the schema-bearing tag reads (`useTagsWithSchema`/`useTag`) stay
  network-only (the mirror holds only `TagSummary`, not schemas).
- **`networkMode: "always"` (flag-on only).** React Query's default `networkMode: "online"` pauses
  the queryFn while `navigator.onLine === false`, so a cold-launch-offline would render nothing
  regardless of the fallback. The touched hooks switch to `"always"` when the flag is on so the
  queryFn runs offline and reaches the mirror. When the flag is OFF, `networkMode` stays `"online"`
  and the queryFn/placeholderData are exactly as before — pinned by a "flag-off + offline PAUSES,
  never reads the mirror" test.
- **Lean-vs-full coherence.** The mirror only ever holds FULL rows (hydration + write-path landings);
  the lean live list is display-only and never written to the mirror, so reading a note for the VIEW
  always gets full content. List rows returned from the mirror are full Notes (a superset of the lean
  shape — `NoteRow` derives its title from content).
- **Tests** — `src/lib/mirror/read.test.ts` (16: evaluator fidelity for tag/path/has_*/sort+id-tiebreak/
  limit-offset, `search`→null, unknown-param→null, and `readNote` local-id resolution) +
  `src/lib/vault/queries.mirror.test.tsx` (8: flag-ON offline list + note render from a populated
  mirror; flag-ON online seeds-then-network-wins; flag-ON onLine-but-unreachable serves the mirror;
  flag-OFF offline pauses + never reads the mirror; flag-OFF online plain fetch; `networkMode:"always"`
  keeps online errors surfacing and retries engaged).

## [0.20.26] - 2026-07-20

**Offline mirror — Wave 2: deletes reconciliation (full-ID sweep + live WS-remove), still behind
the same default-OFF flag.** Wave 1's cursor tells the mirror what CHANGED (created/updated) but
NEVER what was DELETED (`deleteNote` is a hard server-side delete, no tombstone), so a note deleted
on the server stayed in the mirror forever; imported/restored notes that landed BEHIND the cursor
watermark never appeared. This wave reconciles both. Still write-only/invisible — no read path
consumes the mirror yet (Wave 3), and with the flag OFF every path stays inert.

- **The reconcile sweep** (`src/lib/mirror/engine.ts` `reconcileSweep` + `src/lib/mirror/reconcile.ts`)
  — a periodic full-ID sweep. It runs a fresh **lean** cursor walk (`include_content=false` → id +
  updatedAt only) from `""` at a large page limit (1000) to enumerate the COMPLETE current server-id
  set (Aaron's ~3400-note vault ≈ 4 requests), then diffs against the mirror: **mirror-has /
  server-lacks → delete locally**, **server-has / mirror-lacks → fetch full bodies + upsert** (heals
  behind-watermark imports), **server updatedAt newer than the mirror row → refetch full**
  (belt-and-suspenders). Triggers: after the first hydration, on app start when online (throttled to
  ≤ once / 6h via `mirror:<vaultId>:lastSweepAt`), and right after a cursor-error re-walk.
- **The two critical safety properties.**
  - **Exclusion — never prune un-synced user work.** The delete phase EXCLUDES (a) any row whose id
    is a LOCAL id (`isLocalId` — offline-created, not yet synced) and (b) any row with a PENDING
    queue mutation (create/update/delete/link/delete-attachment), including the id-map resolution of
    a local id that has since drained to a server id. Both would destroy in-flight offline work.
  - **Abort-on-incomplete — never mass-delete on a failed/empty enumeration.** If the lean walk
    errors, breaks on a no-advance cursor, or completes but returns ZERO ids, the diff is REFUSED
    (no deletions) — an "absent" id only means "gone" when we provably enumerated the whole set.
- **Live WS-remove → mirror delete** — the engine holds an unfiltered, lean live subscription
  (`VaultClient.subscribe`) bound to the active vault; on an unfiltered query a `remove` event IS a
  real delete (no filter it could merely fall out of), so it prunes `mirror_notes` immediately
  (honoring the same local-id/pending exclusion), closing the online-window delete gap the cursor
  can't — the sweep is then the cold-start/reconnect backstop. Content upserts stay the cursor
  poll's job (snapshot/upsert ignored).
- **Wave-1 review follow-ups folded in** — (a) an id-change (path rename → new id) orphaned the
  old-id row; the sweep now prunes it (mirror-has / server-lacks), unless it's local/pending; (b) the
  cursor drain now BREAKS on a no-advance page (a non-empty page whose `next_cursor` didn't move) to
  harden against a contract violation instead of spinning.
- **Tags mirroring** — the sweep refreshes the vault's tag list under `mirror:<vaultId>:tags` (best
  effort) so Wave 3's offline list can render tag filters without a round-trip.
- **Tests** — `src/lib/mirror/reconcile.test.ts` (pure diff + protected-id collection incl. the
  local→server id-map bridge) and `src/lib/mirror/engine.sweep.test.ts` pin the safety properties:
  the sweep deletes a server-deleted note; NEVER deletes a local-id row or a pending row (stale +
  pending survives); ABORTS on a failed walk AND on an empty walk; backfills server-has/mirror-lacks;
  refetches on a newer server timestamp; prunes an id-change orphan (but not if pending); WS-remove
  deletes a synced note yet spares local/pending; the no-advance drain break; throttle holds within
  6h. All behind the same default-OFF flag.

## [0.20.25] - 2026-07-20

**Offline mirror — Wave 1: the durable local-copy foundation, behind a default-OFF flag.**
Lays the groundwork for reading the whole vault offline / cold-launching offline (later waves):
a complete LOCAL MIRROR of the vault's notes in IndexedDB, kept fresh by the vault's cursor
incremental-sync primitive. This wave builds the STORE + hydration ENGINE + write-path upserts.
It is **write-only and invisible** — no read path consumes the mirror yet, so with the flag ON the
only observable effect is IndexedDB growth, and with it OFF every mirror code path is fully inert
(no cursor traffic, no timers, no writes).

- **Flag** (`src/lib/mirror/flag.ts`) — `isMirrorEnabled()`. Default OFF via `MIRROR_ENABLED_DEFAULT`;
  a per-device override lives in localStorage `parachute:mirror:enabled`, read once at provider mount
  (a change takes effect on reload). Everything below is gated on it.
- **IndexedDB v2** (`src/lib/sync/db.ts`) — bumps `DB_VERSION` 1→2, adding ONE store `mirror_notes`
  via the existing migration ladder. Composite key `[vaultId, id]` (a restored/imported vault copy
  shares note ids across vaults, so a bare id would collide); indexes `by-vault` and
  `by-vault-updated` (`[vaultId, updatedAt]`) for sorted offline lists. Value = the full Note
  (content, path, tags, metadata, links, attachment rows) + a `contentEvicted?` bookkeeping bit for
  a future eviction pass. The v2 upgrade is **purely additive** — it does NOT touch the v1 queue
  stores (pending/id_map/blob_path_map/blobs/meta), which hold un-synced user writes. Cursor + sync
  state live in the existing `meta` store under `mirror:<vaultId>:cursor` / `:state` / `:lastSyncedAt`.
- **Hydration engine** (`src/lib/mirror/engine.ts`) — a `MirrorEngine` (sibling to `SyncEngine`) that
  walks `queryNotesCursor` (unfiltered, full shape) and upserts each page into `mirror_notes` in one
  txn, **persisting `next_cursor` after every page** (a killed app resumes exactly), terminating on
  `items.length === 0` (never on a falsy cursor — the watermark never is). A rejected cursor
  (`cursor_invalid` / `cursor_query_mismatch`) drops the stored cursor and re-walks from `""`
  (idempotent). Triggers: app start, `online`, visibility→visible, and a 60s interval while online;
  guarded per-tab by an in-flight flag and cross-tab by `navigator.locks` (`mirror:<vaultId>`),
  degrading to run-directly where Web Locks is unavailable. Active-vault only.
- **Write-path upserts** — a create/update landing (direct online OR queue-drain) upserts the server
  Note into the mirror; a delete removes the row; a drained offline-create swaps its optimistic
  local-id row for the server row via the id-map. The write queue's own logic is unchanged — the
  mirror sink is additive and no-ops when the flag is off (`src/lib/sync/queue.ts`,
  `src/lib/sync/engine.ts`, `src/lib/vault/queries.ts`, `src/providers/SyncProvider.tsx`).
- **No read-path changes** — that's Wave 3.
- **Tests** — `src/lib/sync/db.migration.test.ts` (v1→v2 adds `mirror_notes` AND preserves the queue
  stores + their data), `src/lib/mirror/store.test.ts` (composite-key isolation, cursor/state meta,
  flag-gated helpers), `src/lib/mirror/engine.test.ts` (per-page cursor persistence, empty-page
  termination, resume, cursor-error re-walk), `src/lib/sync/queue.mirror.test.ts` (drain-landing
  upsert/remove/local-id swap; flag-off is inert).

## [0.20.24] - 2026-07-20

**Perf: the notes list opens its live subscription in the lean shape — titles and previews,
not every note's full body.** The notes list (VaultSurface's All view) and the date-grouped
surfaces (Recent, Activity, Calendar) keep their react-query cache fresh over a vault live
subscription (`useLiveNotesQuery`). That subscription's snapshot shipped every matching note's
FULL content, even though the list only renders `NoteRow` (title + preview + tags + provenance)
and never reads `note.content` — so a large vault paid to stream its entire corpus on connect.
The list subscriptions now request `include_content=false`, so vault (parachute-vault #620) sends
lean `NoteIndex` frames (byteSize + preview + displayTitle + tags/metadata, no body) on snapshot
and upsert. The REST poll already omitted content by the vault's list default, so this is purely a
live-path win; the switcher (Cmd+K first-line search) and the graph/link hooks stay FULL because
they genuinely read content/links.

- **`src/lib/vault/queries.ts`** — `useNotes` and `useNotesForDateViews` now set
  `include_content=false` on the shared query params that drive both the poll and the live
  subscription. Left FULL, deliberately: `useAllNotesForSwitcher` (`include_content=true`),
  `useAllNotesWithLinks` (`include_links=true`), `useViewList`/`useViewResults`, and the single-note
  `useLiveNote`/`useNote` path (the read view + neighborhood graph).
- **Back-compat with an older vault** (predates #620, ignores `include_content` on subscribe and
  sends full frames): still renders — the full shape is a superset of the lean one, and
  `displayTitle()` falls back to the first content line when no wire `displayTitle` is present.
- **`src/lib/vault/queries.lean-list.test.tsx`** — new: the two list queries send
  `include_content=false`; the switcher/link hooks stay full; and the list renders both a lean
  `NoteIndex`-shaped note (no content) and an old vault's full frame without error.

## [0.20.23] - 2026-07-20

**Fix: Enter and Backspace are now exact inverses — predictable line breaks, Obsidian-faithful.**
Writing prose in the editor, hitting Enter then Backspace could leave "sometimes one line break,
sometimes two." Root cause: prose Enter inserted TWO newlines (`\n\n`, a paragraph gap), but the
default Backspace only removed ONE, stranding a `\n`. Enter now inserts exactly ONE newline, so
Enter-then-Backspace returns the document to its byte-identical prior state in every context. A
paragraph gap is a genuine blank line you make by pressing Enter twice (`\n\n`) and un-make with two
Backspaces — exactly how Obsidian behaves. The ratified rendering is preserved: a single newline
still renders as a `<br>` line break (surface-render `breaks: true`), so one Enter shows a visible
break. **Revises the 2026-07-15 Typora-school ratification (Enter = paragraph) in favour of the
Obsidian source-faithful model Aaron named; wants his on-device confirmation.**

- **`src/lib/editor/paragraph-break.ts`** — prose/fence/table Enter now delegates to CM6's
  `insertNewline` (a single `\n`), the exact inverse of the default `deleteCharBackward`. List/quote
  Enter is unchanged (`insertNewlineContinueMarkup` — marker continuation and empty-item-exits-list).
  Renamed the command `insertParagraphBreak` → `insertContextualNewline`, since it no longer inserts a
  paragraph break. `insertHardOrPlainBreak` (Shift+Enter, explicit `\`-hard-break) is unchanged.
- **`src/components/CodeMirrorEditor.tsx`** — bind Backspace to lang-markdown's `deleteMarkupBackward`
  ahead of `defaultKeymap`, the canonical inverse of `insertNewlineContinueMarkup`: a Backspace right
  after a continued list/quote marker strips the marker cleanly (one level per press) instead of
  nibbling a single character; off markup it returns false and falls through to `deleteCharBackward`.
- **`src/components/CodeMirrorEditor.newline.test.ts`** — updated the prose Enter test to expect one
  newline; added an "Enter then Backspace — byte-identical round-trip" block asserting the invariant
  across five prose contexts (end/mid/empty/after-paragraph/start-of-doc) plus the two-Enters/
  two-Backspaces paragraph-gap case, and a list-continuation clean-reversal test.

## [0.20.22] - 2026-07-20

**Fix: the first line of a note now reads as its title in the read view and the note list, not just
the editor.** The editor already styles a note's first non-empty line at title scale in place (the
Bear / Apple Notes model — no literal `#` written; the vault's `displayTitle`). But when VIEWING a
note or scrolling the note LIST, that same first line did not render as the title: the read view
only promoted a literal leading `# H1`, and the list fell back to the path/timestamp. So a note that
starts with plain text (by design) looked titled while editing and untitled everywhere else. All
three surfaces now agree that the first non-empty content line IS the title.

- **`src/lib/note-title.ts`** — added `firstLineTitle`, the app's byte-for-byte mirror of the vault
  core's `computeDisplayTitle` (first non-empty line, one leading `#{1,6}` marker stripped, leading
  YAML frontmatter skipped, hard 120-code-point cap, `null` for empty content), and
  `stripFirstTitleLine`, which lifts that exact line out of a body. `displayTitle()` now PREFERS the
  vault's computed `displayTitle` field — which already rides the lean list shape (`toNoteIndex`) on
  the wire — so the list agrees with the vault by construction, and derives from content only when
  that field is absent (a full-content fetch, or a pre-`displayTitle` vault). `noteTitle` /
  `displayTitle` share this one derivation, so read / editor / list can't drift. Truncation is now a
  hard cap with no ellipsis, matching the vault (the sole behavior change to the existing helpers).
- **`src/app/routes/NoteView.tsx`** — the read view now derives its page title from
  `firstLineTitle(note.content)` (plain first line OR literal `#` heading) instead of a literal-H1
  check, and strips that line from the rendered body via `stripFirstTitleLine` so the note isn't
  headed by its own first line twice (the extract-and-strip model the header already used for H1s,
  generalized). A one-line note whose only line became the title renders no body rather than the
  misleading "Nothing here yet" prompt; a genuinely empty note still shows that prompt with a
  timestamp/path title.
- **`src/components/NoteRow.tsx`** — unchanged; it already renders `displayTitle(note)`, so the list
  fix flows through the `displayTitle` wire-preference above.
- Cross-door: this is app-side rendering keyed off the vault's `displayTitle`, identical on
  self-host and cloud once shipped. Tests: `note-title.test.ts` (firstLineTitle / stripFirstTitleLine
  / the wire-preferred `displayTitle`), `NoteView.test.tsx` (plain-first-line title + strip, buried
  heading stays in-body, one-line note has no empty-state, genuinely-empty note keeps it),
  `NoteRow.test.tsx` (the vault's `displayTitle` renders as the row title, not the quickPath stamp).

## [0.20.21] - 2026-07-20

**Fix: the "Vault session expired / Reconnect to vault" banner no longer sticks forever on the
home-door vault.** On a self-hosted box where the hub serves the app at its own origin root, opening
the app could show the red auth-halt banner; reconnecting loaded vault data correctly but the banner
stayed pinned at the top and survived a full page reload.

- **`src/components/VaultStatusBanner.tsx`** — root cause: the auth-halt banner is a CROSS-ORIGIN
  OAuth-vault affordance. Its recovery action is `beginOAuth`, and its `lens:auth-halt:<id>` marker
  is only ever cleared on the OAuth refresh path (`refresh.ts`). A HOME-DOOR vault (`clientId ===
  "home-door"`, served same-origin by cloud or a hub) has no OAuth client — its per-vault token is
  re-minted from the account session cookie, and no home-door connect path (`openHostedVault` /
  `remintHostedVault`) touches the auth-halt store. So once a home-door vault acquired a halt (via
  `queries.ts` `onAuthRevoked` when a post-remint retry still 401s), it was orphaned: the successful
  re-mint loaded data but never cleared the localStorage-backed halt, and the banner re-appeared on
  every reload. Fix: the auth-halt banner now excludes home-door vaults
  (`halt && !isHostedVaultRecord(vault.clientId)`). Home-door session loss is already covered by the
  non-blocking `AccountSessionBanner` ("your sign-in ended → sign in"), which is the correct recovery
  door. The cross-origin OAuth reconnect banner is unchanged, and the network-unreachable axis still
  applies to home-door vaults (a home-door vault can be genuinely offline).
- **`src/components/VaultStatusBanner.test.tsx`** — pins the visibility condition at the banner's
  logic layer: a home-door vault with a lingering halt renders nothing; a cross-origin OAuth vault
  with a halt still shows the reconnect banner (unbroken); a home-door vault that is both halted and
  unreachable still surfaces the unreachable banner.

## [0.20.20] - 2026-07-20

**Voice: the per-capture "Transcribe" toggle now matches the app's other switches.** The switch
shipped in Wave 3 (0.20.17) used a bespoke, smaller geometry that read as misaligned — the knob
looked pushed too far to the right and sat unevenly in its track.

- **`src/app/routes/NoteNew.tsx`** — root cause: `TranscribeToggle` hand-rolled a smaller track +
  thumb (`h-6 w-11` track, `h-5 w-5` thumb) than the app's established switch chrome, while its own
  comment claimed it "mirrors Settings' switch." Settings' switches (Live preview, Transcribe-by-
  default) use `h-7 w-12` track + `h-6 w-6` thumb. Converged the toggle onto that exact geometry so
  the knob is the familiar size and seats the same way; behavior (default ON, per-capture,
  `transcribe:true/false` wiring, forced-off-when-out-of-minutes) is untouched. Display-only. jsdom
  has no layout, so the pixel-level alignment is an on-device eyeball; the existing behavior tests
  (aria-checked, presence, toggle wiring) stay green.

## [0.20.18] - 2026-07-20

**Editor: stop the viewport jumping to the paragraph top while typing.** Writing a long note
(morning pages) made the view lurch on essentially every new line, pinning the current line in a
fixed high band with dead space below — a partial typewriter/snap effect.

- **`src/components/CodeMirrorEditor.tsx`** — root cause: the Wave-1 (0.20.17) scroll block set
  `EditorView.scrollMargins.of((view) => ({ bottom: view.dom.clientHeight * 0.3 }))`. Every
  keystroke asks CM to scroll the cursor into view (`applyDOMChange` sets `scrollIntoView: true`)
  and that margin inflates the scroll target downward by ~a third of the viewport, so CM treated
  the caret as "out of view" the moment it passed ~70% of the screen and re-scrolled on every new
  visual line — holding the caret at a fixed ~70% band with a large empty gap below. Replaced with a
  small, fixed scroll-off of two line-heights (new exported `bottomScrollMargin`), tied to
  line-height rather than viewport height so a taller screen can never inflate it. The caret now
  travels naturally down the viewport and the view only scrolls when the caret truly nears the
  bottom edge — standard-editor behavior, no snapping, no typewriter centering. `scrollPastEnd()` is
  unchanged (the last line can still reach the top). Verified in a real headless browser via CDP:
  under the old margin the caret pinned at ~67% and the view scrolled on every line; with the fix
  the caret descends 35%→90% with the viewport held still.
- **`src/components/CodeMirrorEditor.scroll.test.ts`** (new) — pins the cause: the bottom scroll-off
  is a small fixed amount tied to line-height, identical on a 200px and a 10000px viewport (the old
  code would register 3000 on the tall one), and is the editor's only registered bottom scroll
  margin. jsdom has no layout, so the pixel-level scroll itself remains an on-device eyeball.

## [0.20.17] - 2026-07-18

**Voice Wave 3 — one policy, spoken once: the per-capture Transcribe toggle + a unified Voice
section in Settings.** Whether a voice note comes back as text is now a choice the user makes right
where they capture, with a per-vault default they can set once.

- **`src/lib/capture/transcribe-default.ts`** (new) — the per-vault "transcribe by default"
  preference. Deliberately CLIENT-LOCAL per-vault (localStorage, `lens:transcribe-default:<vaultId>`,
  the same pattern as the path-tree + retention-choice flags), NOT server config: the client already
  owns the `transcribe:` decision per attachment at attach time, so the DEFAULT for that per-capture
  choice belongs with the app, per device — like the other capture-surface preferences. Defaults ON.
- **`src/app/routes/NoteNew.tsx`** — a small "Transcribe this recording" switch sits with the record
  controls, ON by default (seeded from the per-vault preference). OFF makes the capture save
  audio-only: `saveWithAudio` folds the toggle into `willTranscribe` (`!outOfMinutes && transcribe`),
  so `buildVoiceCapturePlan` drops the pending markers + `segment_index` and every link sends
  `transcribe:false` — the SAME audio-only shape the out-of-minutes path already produces
  (segmentation still rolls a long recording; it just doesn't pre-seed transcription slots). The
  toggle is per-capture: it resets to the vault default at the top of every fresh capture, so a
  one-off "just the audio" never leaks into the next recording. When out of monthly minutes it renders
  OFF + disabled (Wave 2 already speaks the audio-only truth — no double-messaging). The panel copy
  now tells the truth for both states (transcript-coming vs audio-only). Capability honesty: the
  toggle only renders when the vault hasn't declared transcription disabled (the recorder is gated
  away entirely there, unchanged from #167).
- **`src/app/routes/Settings.tsx`** — the "Voice recordings" section grows into a unified **Voice**
  section: a new "Transcribe recordings by default" switch (client-local, per device — sets what the
  capture toggle starts at) above the unchanged retention control ("Keep recordings" —
  `config.audio_retention`, server-side, per vault). Both knobs are gated by the same #167
  transcription-capability check; the scope difference (this device vs every device on the vault) is
  said out loud on each. The cloud door's stored `auto_transcribe` config stays inert — its
  wiring/removal is a separate door-parity decision (W3 non-goal).

## [0.20.16] - 2026-07-18

**Voice Wave 2 — unlimited-length voice recording via invisible segmentation + honest edges.** A
recording of any length now stays a set of standalone, transcribable audio containers, and the app
tells the truth at every seam (minutes, failures, audio-only). Both server doors already merged the
per-segment support (an attachment with a numeric `metadata.segment_index` gets its own per-part
markers) and the `POST /api/notes/:id/retry-transcription` endpoint; this is the app half.

- **`src/lib/capture/segmented-recorder.ts`** (new) — `createSegmentedRecorder` rolls to a FRESH
  `MediaRecorder` every `SEGMENT_MS` (10 min) on the SAME microphone stream, so each segment is a
  standalone valid container (NOT `timeslice` chunks, which aren't independently decodable). The
  handoff is a synchronous start-next-before-awaiting-flush so effectively no audio is lost at the
  seam. `src/lib/capture/recorder.ts` gains a `releaseStreamOnStop` option (default true — the
  single-recorder callers keep "stop releases the mic") that lets the segmented recorder keep the
  stream alive across the roll; `memoFilename` gains a `-partN` suffix so same-timestamp segments
  don't collide.
- **`src/lib/capture/use-voice-capture.ts`** — the hook drives the segmented recorder; `have-audio`
  now carries the ORDERED segment list and a `parts` count (a subtle "part k" hint while a long
  recording is in flight). The UX is unchanged: one timer, one Stop button, segmentation invisible.
- **`src/lib/capture/voice-capture-plan.ts`** (new) — `buildVoiceCapturePlan` is the pure
  body-and-per-segment plan. **The common case is sacred:** a single-segment recording is
  byte-identical to 0.20.15 — bare `_Transcript pending._`, one embed, one link with NO
  `segment_index`. N>1 pre-seeds N per-part pending markers IN ORDER and each segment uploads as its
  own attachment with `transcribe:true` + a numeric `metadata.segment_index` (0-based).
- **`src/app/routes/NoteNew.tsx`** — `saveWithAudio` executes the plan: each segment runs the SAME
  `validateFile` guard every other upload uses (a failure aborts the whole save, never a partial),
  then uploads + links in order. Minutes honesty (hosted door only, capability carries
  `minutes_remaining`): a quiet remaining-minutes line near the mic under ~30 min; at 0 the mic
  STAYS available but says plainly the capture saves as audio-only and sends `transcribe:false` (no
  server churn). Self-host (no minutes field) shows nothing new.
- **`src/lib/transcription-status.ts`** — the derivation now scans ALL audio attachments: ANY
  pending → "Transcribing…" (with a "part k of n" hint via `deriveTranscriptionProgress` when
  segmented counts are known); none pending + any failed → the failed chip; the voice-limit marker
  still distinguishes cap from failure. The marker-fallback regexes recognize both the bare AND the
  `(part N)` forms. `retryOptimisticNote` flips failed segments + failure markers back to pending.
- **`src/components/TranscriptionStatus.tsx`** + **`src/app/routes/NoteView.tsx`** — the failed chip
  gains a **Retry** action → `POST retry-transcription` (new `VaultClient.retryTranscription` +
  `useRetryTranscription`), optimistically flipping the chip to "Transcribing…"; the Wave 1 live
  subscription + pending poll track reality, and an honest 4xx ("nothing retriable") reverts the
  flip with a quiet toast rather than a stuck spinner.
- **`src/lib/sync/{types,queue}.ts`** + **`src/lib/vault/client.ts`** — `link-attachment` rows +
  `linkAttachment` carry optional `metadata` (forwarded verbatim; the door contract keys per-part
  markers on `segment_index`).

## [0.20.15] - 2026-07-17

**Voice Wave 1 — a voice note's transcript (and its failures) now appear in the open note view
LIVE, no manual refresh.** The open-note cache had no real-time bridge: transcription completes
server-side by rewriting the note body through the standard update layer (which broadcasts an
`upsert` to matching subscribers on both doors), but nothing on the note-view side subscribed, so
the transcript only showed on a reload. Three parts, no server change and no new dependencies:

- **`src/lib/vault/live-note.ts`** (new) — `useLiveNote(cacheId, note)` opens ONE live-query
  WebSocket subscription per open note, scoped to that note by its server `path` (exact-match,
  subscribable), over the same SDK `VaultClient.subscribe` the list hooks use. On any
  `upsert`/`remove` it INVALIDATES the `["note", vaultId, cacheId]` cache rather than writing the
  event's note through — the view fetches `includeAttachments`, the live event's note is
  list-shaped (no attachments), so an invalidate + refetch pulls the fresh body AND the fresh
  attachment `transcribe_status` the chip reads. Deltas-only (not the initial snapshot) to avoid a
  mount double-fetch; reconnect/backoff/token-refresh are the SDK's job. Wired in
  `src/app/routes/NoteView.tsx`; torn down on unmount / note-switch.
- **`src/lib/vault/queries.ts`** — `useNote`'s `refetchInterval` is now `noteRefetchInterval` (new,
  exported, pure): the local-id bridge (2s) is preserved AND extended with a pending-transcription
  poll (4s) that keeps refetching while the note's own transcription is non-terminal, stopping on
  any terminal state (done / failed / voice-limit). The socket handles the live case; this poll is
  the safety net for drops/reconnects — belt and suspenders.
- **`src/lib/transcription-status.ts`** (new) + **`src/components/TranscriptionStatus.tsx`** — the
  status chip now reads the AUDIO ATTACHMENT's `transcribe_status` (pending/done/failed) as the
  primary source, with the body markers kept as the fallback (they're the portable-markdown
  cross-door contract — never removed). `deriveTranscriptionState` is the one shared read (chip +
  poll can't disagree). Adds the cloud monthly voice-cap state as its own calm resting chip
  (distinguished from a genuine failure only by the `_Monthly voice limit reached…_` body marker,
  since the attachment stores `"failed"` for the cap too). The pending→failed/limit flip now
  surfaces live via the subscription + poll above.

## [0.20.14] - 2026-07-17

**Polish — mobile formatting bar docks above the keyboard; note header's path/tags recede; the
first line renders as a title; single-newline lines read as one thought.** Four feel-fixes from a
live tablet test of 0.20.13. Display-only: no data-model changes and no new capabilities — only
where things sit and how they read (FIX 3 writes NO markdown into the note; FIX 4 is CSS only).

- **`src/lib/editor/selection-toolbar.ts`** — on touch the selection formatting bar no longer
  floats at the selection (where Android paints its Copy / Select all callout directly over ours
  and iOS the loupe/handles, leaving ours untappable). It now DOCKS as a fixed bar at the bottom of
  the visual viewport, riding above the virtual keyboard — the Google Docs / Notion / Bear pattern.
  Rebuilt from a CM6 `showTooltip` StateField into a `ViewPlugin` that owns a plain fixed-position
  node in `document.body` (the only reliable containing block for `position: fixed` — a lingering
  `.enter-rise`/`.fade-up` transform on an ancestor would otherwise capture it). `bottom` tracks
  `window.visualViewport` (`innerHeight − height − offsetTop`) on its resize/scroll events, so the
  bar stays glued to the keyboard's top edge as it opens and closes and rests at the screen bottom
  when it's shut. Still coarse-pointer only (`matchMedia("(pointer: coarse)")`, read dynamically):
  desktop is unchanged — no bar, the `Mod-b`/`Mod-i`/… keymap drives formatting there. Same five
  buttons (B/I/S/`<>`/🔗) calling straight into the shared `format-commands` — the bar
  re-implements no transform of its own. Shown on a non-empty selection, hidden the instant it
  collapses; built lazily on first show so desktop never mounts a node. `pointerdown`/`mousedown`
  are still preventDefaulted (it matters more now the bar lives outside the editor — a tap must not
  blur it or drop the selection); ≥40px touch targets are set inline so the invariant holds in
  production and stays assertable in jsdom (styles/index.css isn't loaded there, and an
  `EditorView.theme` sheet no longer reaches a body-level node).
- **`src/styles/index.css`** — new `.cm-format-toolbar-docked` (layout + top hairline +
  `env(safe-area-inset-bottom)` so the buttons clear the home indicator + the `enter-rise`
  entrance, registered in the one reduced-motion gate); the translucent surface reuses
  `.glass-panel`.
- **`src/app/routes/NoteView.tsx`** — the note header's path and tags recede (Aaron: "we're really
  not orienting toward people updating the path"). The path leaves the primary header flow — it was
  a prominent mono `break-all` line right under the title — and becomes a single small, muted,
  TRUNCATING meta line at the FOOT of the header. Capability is preserved, not removed: the whole
  line is a one-tap copy button (path → clipboard, the "hand it to an AI agent" use case ratified
  2026-07-17), with a small clipboard glyph and a distinct **"Copy path"** label so it never
  collides with the metadata card's "Copy note path". Tags reweight to normal-weight, tighter-
  spaced compact chips (were `font-medium`) — a quiet label strip under the title rather than a
  second headline. The reclaimed vertical space goes to content.
- **`src/lib/editor/first-line-title.ts`** (new) + **`CodeMirrorEditor.tsx`** — the Bear / Apple
  Notes move: the note's first non-empty content line IS its title (the vault's `display_title` —
  first line, leading `#` stripped, frontmatter skipped, vault 0.7.3-rc), so the editor RENDERS
  that line at title scale (serif, `--text-3xl`, weight 650 — the same H1 top-of-ramp as the live-
  preview `.cm-lp-h1`). A CodeMirror **line decoration**, mode-agnostic (raw + live) — **not one
  byte of `# ` or any structure is written into the note**. Frontmatter is skipped via the shared
  `frontmatterEnd` helper (now exported from `live-preview.ts`, single source with the reveal
  guard, so the two never drift); it defers to an explicit ATX heading (`/^ {0,3}#{1,6}(?: |$)/`) so
  the styling never stacks on the editor's own heading treatment; and it tracks live — deleting the
  first line promotes the next non-empty one (recomputed on `docChanged`).
- **`src/styles/index.css`** — line spacing for single-newline lines. A single newline renders as a
  `<br>` INSIDE one paragraph (surface-render's `breaks: true` / `remark-breaks` — verified: `line
  A\nline B` → `<p>line A<br>line B</p>`), so consecutive single-newline lines were inheriting the
  1.78 long-form reading leading and reading as far apart as separate paragraphs. New
  `--lh-prose-tight: 1.5` token, applied surgically via `.prose-note p:has(br)` — **only** paragraphs
  that actually contain a line break tighten; normal wrapping paragraphs keep 1.78, and blank-line-
  separated blocks are separate `<p>`s that keep their real `0.75em` margins. Baseline-to-baseline
  step for single-newline lines (rendered view): **18px → 32.04px ⇒ 27.00px** (−15.7%), 22px →
  39.16 ⇒ 33.00, 26px → 46.28 ⇒ 39.00; a paragraph step stays 45.54px @18px, so same-thought lines
  (27px) now read clearly distinct from paragraph breaks (45.5px). Theme-invariant (line-height
  carries no colour — one value, both light and dark). The **editor** needs no change: its lines
  are `.cm-line`s at line-height (`--lh-live` 1.7 live / 1.6 raw) with NO inter-line margin, so
  single-newline lines are already line-spacing-apart there and a blank line is a genuine empty line
  — it never had the paragraph-spacing problem the rendered `<br>` did.

Judgment calls (reviewer-facing):

- **Desktop is unchanged.** The 0.20.13 floating bar was already coarse-pointer-only — desktop
  showed no bar and drove formatting from the keymap — so "desktop keeps its current behavior"
  means it still shows nothing. Adding a floating bar to desktop would be a new feature, outside the
  display-only charter, so it was NOT added.
- **Command set held.** The brief listed "bold/italic/code/link/todo"; the shipped bar keeps the
  existing `FORMAT_COMMANDS` set (bold/italic/strikethrough/code/link) rather than swapping
  strikethrough out for a todo button, so this stays a pure re-dock of the existing toolbar. A todo
  button is a one-line follow-up if wanted.
- **Touch detection.** `matchMedia("(pointer: coarse)")`, read dynamically per update (a hybrid
  device can gain/lose a pointer mid-session), the same approach the 0.20.13 toolbar used;
  `window.visualViewport` drives positioning and degrades to `bottom: 0` where it's absent.

Gates (literal): `bun run test` (vitest) — **1869 passed / 1869 across 167 files, deterministically
green, when the one PRE-EXISTING-flaky file is excluded** (`--exclude "**/nav-history.test.tsx"`);
the full 168-file suite is **1872 / 1872** on a clean run. `bun run typecheck` — clean; `bun run
lint` — clean (2 pre-existing `src/lib/vault/live-query.ts` `useExhaustiveDependencies` warnings,
present on `main`); `bun run build` — ✓. The editor toolbar suite is rewritten for the docked
mechanism (bar in `document.body`, coarse-only, show/hide-on-collapse, ≥40px targets, command
dispatch, pointerdown containment); the NoteView metadata test folds in the header's one-tap "Copy
path"; `first-line-title.test.ts` is new (plain-line title, no-stack-on-heading, live mode,
frontmatter skip, leading-blank skip, live tracking across an edit). FIX 4 adds no tests (CSS only,
verified via compiled-CSS grep + a real `remark-breaks` render probe). Note: `nav-history.test.tsx`
carries a PRE-EXISTING, intrinsic flake (real 3s `setInterval` + real `window.history` + `waitFor`
timing) — it fails ~2/5 runs **running entirely on its own**, machine-load-dependent, and is
byte-identical to `main` (untouched by this diff). Flagged as a follow-up (fake-timers or `retry`).

## [0.20.13] - 2026-07-17

**Editor Wave 2, PR 5 — the shared format commands, selection toolbar, and swipe-indent.**
POLISH-WAVE PR 5 (5a swipe-indent, 5b selection toolbar) + EDITOR-STUDY §5-6's adopt list (real
⌘B/⌘I via a shared format-command module, ⌘⏎ create/toggle to-do, coarse-pointer-only selection
toolbar, swipe right/left on list items to indent/outdent). Version note: rebased onto `main`
after `0.20.9`–`0.20.12` landed from sibling branches; this one takes `0.20.13`.

- **`src/lib/editor/format-commands.ts`** — the ONE place bold/italic/strikethrough/code
  wrap-unwrap and link-wrap write bytes, used by both the toolbar and the keybindings below.
  Toggle detection is syntax-tree-based (`StrongEmphasis`/`Emphasis`/`Strikethrough`/`InlineCode`
  nodes), not character counting — a naive `**`-vs-`*` prefix check would confuse bold and italic;
  the tree already disambiguates them. A narrow string fallback handles the one case the tree
  can't see: an empty `**|**` pair (CommonMark requires content between emphasis delimiters, so it
  never parses as a mark node) collapses on a second press instead of nesting further markers.
  `toggleTodo` (⌘⏎) creates/toggles a to-do per touched line, deduped by ListItem node identity —
  a lazy-continuation line (no marker, no blank line, CommonMark keeps it part of the SAME list
  item) would otherwise resolve to the same TaskMarker as its neighbor and emit two colliding
  writes to one position.
- **`src/lib/editor/list-indent.ts`** — "one grammar, three doors": `isListItemLine` (tree-based,
  shared), `listAwareIndent`/`listAwareOutdent` (Tab/Shift-Tab, live mode only, `return false` off
  a list line so native Tab is untouched elsewhere), and `swipeIndent()` (the pointer-gesture
  extension) all funnel through `@codemirror/commands`' own `indentMore`/`indentLess` — the same
  bytes Tab always produced. The swipe claims `pointerdown` on a list line (mirroring the checkbox
  widget's containment pattern) so a would-be swipe never flash-reveals the line, then either
  commits an indent/outdent, replays a plain tap (cursor placement) if the drag never crossed the
  threshold, or hands control back to native scroll — vertical scroll wins ties by never calling
  `preventDefault` on a `pointermove` until horizontal intent (≥48px, `|dx| > 2·|dy|`) is
  confirmed. IME-safe: composing state suppresses the commit.
- **`src/lib/editor/selection-toolbar.ts`** — a CM6 `showTooltip`-facet floating toolbar (never a
  decoration), coarse-pointer-only (`matchMedia("(pointer: coarse)")`, checked dynamically, not
  cached at mount), non-empty-selection-only, `above: true` (CM auto-flips at screen edges). Five
  buttons (B/I/S/`<>`/🔗) call straight into the shared format-commands — the toolbar never
  re-implements a wrap of its own. `.glass-panel` + `--radius-lg` + `--shadow-lift` (the slash-menu
  family); button touch-target sizing lives in the tooltip's own `EditorView.theme()` (≥2.5rem)
  rather than a utility class, for the same reason the checkbox widget's hit-area does.
- **`CodeMirrorEditor.tsx`** — wires `Mod-b`/`Mod-i`/`Mod-Shift-x`/`Mod-e`/`Mod-Enter` ahead of
  `defaultKeymap` in BOTH editor modes (raw mode's markdown is just as toggle-able as live mode's);
  `Tab`/`Shift-Tab` list-aware indent and the swipe gesture are live-preview-mode only; the
  selection toolbar is mode-agnostic.
- **Review delta (ragged-selection byte corruption).** `findMarkNode`'s node-aligned check only
  recognized selections that matched a mark's boundary exactly — a ragged drag crossing a mark's
  edge (e.g. selecting `two** thr` inside `one **two** three`) fell through to the plain "wrap the
  selection" path and produced unbalanced markers (`one ****two** thr**ee`, an orphaned pair). Fixed
  with `findOverlappingMarks` + `wrapWithNormalization`: any selection that partially overlaps one
  or more marks of the toggled type expands to the union of the selection and every overlapping
  mark's full range, strips those marks' own delimiters, and wraps the resulting plain text fresh —
  "touch a mark, extend to cover it," the common editor convention for ragged selections, and
  self-consistent (re-selecting the result and toggling again hits the clean node-aligned unwrap
  path). Covers the single-mark-crossing case, the mirror (selection starts before/ends inside),
  and the double-mark-crossing case (selection spans two separate marks with plain text between).
- **Review delta (IME safety gap).** None of the five keybindings checked composition state — CM's
  keymap dispatcher doesn't gate on it, so `Mod-Enter`/`Mod-b`/etc. could fire and mutate the
  document mid-IME-composition. Every exported command now bails (`return false`) when the calling
  `EditorView`'s `.composing` is true, mirroring the guard already in `swipeIndent()` and
  `live-preview.ts`'s checkbox widget.

Tests: `format-commands.test.ts` (wrap/unwrap on selection/caret-only/multi-line, the bold-vs-
italic tree-disambiguation regression, the lazy-continuation todo-dedup regression, the three
ragged-selection repro shapes plus an offset sweep asserting marker balance, IME-composing guards
on every exported command including `toggleTodo`), `list-indent.test.ts` (tree-based list
detection, Tab/Shift-Tab fall-through off a list line), `CodeMirrorEditor.format-commands.test.ts`
(keybindings through the real wired keymap, both modes, plus Mod-b's IME guard through a real
dispatch — Mod-Enter's own guard is proven at the unit level instead: CM6 has a separate "Enter
confirms an in-progress IME composition" fallback that a `defineProperty`-faked `composing` signal
[without the real event sequence backing it] triggers on its own, an unrelated code path the test
file's own comment traces through in detail), `CodeMirrorEditor.touch-grammar.test.ts` (toolbar
coarse/fine-pointer gating, swipe indent/outdent, vertical-scroll-wins-ties, plain-tap replay,
mouse-ignored, IME-composing guard, raw-mode-unwired). Full suite: 167 test files / 1866 tests,
clean (one unrelated pre-existing flake observed intermittently in `src/app/nav-history.test.tsx`,
an `act()`-timing race untouched by this PR — passes cleanly in isolation); `typecheck` clean;
`lint` clean (2 pre-existing warnings remain in `src/lib/vault/live-query.ts`, untouched by this
PR); `build` clean.

## [0.20.12] - 2026-07-17

**Auth Wave 2 — the app half (AUTH-W2-BRIEF §2, moves 2 + the app's app portion of W1's code
endpoint).** Version note: the sibling chain (views-wave-2a, editor-w2-pr5, error-boundary) claims
0.20.9/.10/.11; this one takes 0.20.12, flagged for merge sequencing only — files are disjoint
(`src/lib/account/*`, `src/components/VaultSwitcher.tsx`, `src/app/routes/{Account,CheckEmail}.tsx`),
verified against each sibling branch's diff before starting.

- **The cached account bearer can't outlive the cookie's identity (move 2).** `store.ts`'s account-
  token cache now holds `{ token, identity }` instead of a bare token — `identity` is `email ??
  username` at mint time. `client.ts`'s `getSession()` (the boot oracle, fired on every session
  read — polling, page boots, mints) is the reconciliation chokepoint: it compares the door's answer
  against whichever identity the cached bearer was minted for, and on a mismatch (another tab
  signed out/in as someone else, or signed out entirely) drops the bearer AND bumps a new
  `useAccountSessionStore().identityEpoch` counter. Ambient consumers key off that epoch so a stale
  identity's cached rows can't linger past the switch: `use-summary.ts`'s shared `useAccountSummary`
  query, `VaultSwitcher.tsx`'s `["account","vaults"]` query, and `Account.tsx`'s own "Signed in as"
  boot fetch + vault-list effect all fold `identityEpoch` into their re-fetch trigger. A pre-
  migration bare-token sessionStorage entry fails the JSON parse and reads as absent — a silent
  one-time re-mint, no user-visible effect (pinned directly by a migration test).
- **The `/check-email` 6-digit code field.** Probed the REAL deployed reality first (parachute-cloud
  `workers/identity/src/auth-handlers.ts` `handleCodeVerifyPost`): the JSON variant of `POST
  /auth/code` was deferred out of W1 — the endpoint unconditionally reads `req.formData()` and
  answers either a same-origin redirect (success) or a 200 HTML re-render (every failure, folded
  into one neutral message by design). `client.ts`'s new `verifySignInCode` posts form-encoded with
  `redirect: "manual"` and reads the RESPONSE SHAPE, not the body: a same-origin redirect becomes an
  opaque `res.type === "opaqueredirect"` response (the browser applies the Set-Cookie before
  filtering it into that shape, so the session is live); anything else is a failure. `CheckEmail.tsx`
  gains an "Or type the code from the email" disclosure: a single numeric input (not a 6-box grid —
  paste-robust against the full email line, e.g. "Your Parachute code: 123 456") that auto-submits
  at 6 digits, filters non-digits so paste-with-surrounding-text works, and shows the endpoint's own
  neutral error on a wrong code. KNOWN GAP, documented in `verifySignInCode`'s doc comment and not
  silently swallowed: a TOTP-enrolled account diverts through the same redirect shape without
  minting a session — the flow safely degrades (Welcome.tsx already bounces `!signed_in` to the
  front door) rather than hanging; TOTP is explicitly out of scope for this wave and the app has no
  2FA UI on any sign-in path yet.

Tests: `client.test.ts` — identity-reconciliation suite (matching identity no-ops, a different
identity drops bearer + bumps epoch, signed-out also drops, first-load isn't a false mismatch, a
subsequent Bearer call re-mints against the new identity, username-fallback parity) + the bare-token
migration-reads-as-absent pin + `verifySignInCode`'s form-encoding/opaqueredirect/failure-shape
tests — 35 tests total (was 24). `CheckEmail.test.tsx` — the code field's reveal toggle, auto-submit
at 6 digits with navigation, paste-with-context digit extraction, no-submit-before-6-digits, and the
wrong-code error state (field cleared, no navigation) — 11 tests total (was 6). Full suite: 158 test
files / 1778 tests, ×2 clean; `typecheck` clean; `lint` clean (2 pre-existing warnings remain in
`src/lib/vault/live-query.ts`, untouched by this PR).
## [0.20.9] - 2026-07-17

**Views Wave 2a — the first default-pages cutover (Pinned + Archive).** VIEWS-RENDER-SPEC §7's
ratified direction ("the pack is an override, never a dependency") lands for the two smallest
lenses: `/notes?view=pinned` and `/notes?view=archived` now resolve their tag filter from a
`ViewDef` instead of a hardcoded literal, while everything else about those pages — search,
Filters panel, pagination, `NoteRowList` rendering — is unchanged.

- **`src/lib/views/defaults.ts`** — `builtInDefaultViewDef(pageId, roles)`: the app's own
  fallback `ViewDef` for Pinned/Archive, mirroring the `starter-ontology` pack's own queries
  (`{tag: "pinned"}` / `{tag: "archived"}`, `core/src/seed-packs.ts`) byte-for-intent but through
  `roles.pinned`/`roles.archived` — a vault that renamed those tags still gets a correct default.
  `resolveDefaultViewDef(pageId, packNote, roles)`: the pure resolver — a `Views/Pinned` or
  `Views/Archive` note wins when it's present, tagged `#view`, and its query parses
  (authoring-time-explicit); anything else (no note, wrong tag, unparseable query) falls back to
  the built-in instantly. A default page is load-bearing navigation, not a place to show "this
  view is broken" over someone else's corrupted note — that honesty stays scoped to `/views/:id`.
  Also lifted the pack's four view paths to named constants (`PINNED_VIEW_PATH`, etc.) so
  `DEFAULT_VIEW_PATHS` and the new page-path lookup can't drift from each other.
- **`src/lib/views/queries.ts`** — `useDefaultViewDef(pageId, roles)`: looks up the pack note at
  its canonical path (exact `path=` match, not `path_prefix`) via TanStack Query, then resolves
  through the pure function above. `pageId === null` skips the lookup (every other preset).
- **`VaultSurface.tsx`** — `SearchableLenses`'s `effectiveTags` for the pinned/archived presets
  now reads `queryTags(resolvedDef.query)` (unioned with whatever the Filters panel's TagBrowser
  adds) instead of inlining `roles.pinned`/`roles.archived` directly. Resolution never blocks or
  blanks the page: the built-in def is available synchronously on first render, and the query
  quietly upgrades if/when a pack note resolves.

Tests: `defaults.test.ts` (10, pure — built-in query shape, role indirection, pack-wins,
malformed-note fallback, non-`#view`-tagged decoy ignored), `VaultSurface.defaultViews.test.tsx`
(5, integration — no-pack-note is byte-equivalent to today's hardcoded `tag=pinned`/`tag=archived`
query, a well-formed pack note's tag wins, a malformed pack note falls back without blanking the
page). All-notes + Recent are unaffected (wave 2b).

## [0.20.10] - 2026-07-17

**The ErrorBoundary net (issue #48).** Surfaced by the #47 review: the app had zero React
ErrorBoundaries — any render-time throw during render took down the entire shell, not just the
failing surface. Matters more now that views make agent-authored input reach render paths
routinely (the #47 metadata-operator throw was the concrete instance; fixed at the source, but
the class of bug remained). Display-only, small.

- **`src/components/ErrorBoundary.tsx`** (new) — the standard React class-component idiom (no
  `react-error-boundary` dependency in this repo). One generic `ErrorBoundary` class plus two
  calibrated fallbacks:
  - **`RouteErrorBoundary`** — wraps a single routed surface. On a throw, shows the same honest
    `ErrorState` card pattern NoteView's `NoteErrorBlock` already uses (title, human copy, the
    wire-level message tucked behind a collapsed "Technical detail" `<details>`, "Back to notes").
    Keyed by `location.key` — React Router doesn't remount a Route's element when only its params
    or search string change (e.g. `/n/1` → `/n/2` both match `/n/:id`; `/views/:id`'s refinements,
    Calendar's `?month=`, and DayView's `?date=` all update in place too), so without a key a
    caught error would keep showing over content that would otherwise render fine. Review caught a
    real gap here pre-merge: an earlier version keyed on `location.pathname` alone, which missed
    any search-only navigation (`?view=pinned` → `?view=archived`, same pathname) — `location.key`
    is react-router's own per-navigation-entry identity, so it changes on every push/replace
    (pathname, search, hash, or even a repeat push to the identical URL) without having to
    hand-assemble a composite string.
  - **`AppErrorBoundary`** — the last net. Full-page card + a plain reload button (no "Back to
    notes" — if this fired, the router subtree itself is gone).
- **`src/app/App.tsx`** — every lazy-loaded route in the route table (Account, Activity, AddVault
  and its ceremony steps, Calendar, ConnectAI, DayView, Export, Import, NoteEditor, NoteNew,
  NoteView, OAuthCallback, Settings, Tags, VaultGraph, Vaults, Welcome, CheckEmail, ViewNew,
  ViewSurface) now renders behind its own `RouteErrorBoundary`. `App()`'s return is wrapped in one
  `AppErrorBoundary`, mounted above `QueryProvider`/`SyncProvider`/`BrowserRouter` so it also
  catches a throw from the chrome itself (Rail, Header, a provider), not just a routed surface.
  The eager routes (`BootGate`, `VaultSurface`) and the catch-all `NotFoundPage` are unwrapped —
  the top-level net is still their backstop. (VaultSurface's own containment is filed as a
  fast-follow, out of scope here.)
- Tests: `src/components/ErrorBoundary.test.tsx` (the boundary in isolation — card shown, sibling
  chrome outside it survives, resets on an in-router navigation to a different note, resets on a
  search-only navigation under the same pathname — the review-caught regression) plus two
  integration files exercising the real `<App/>` tree — `App.error-boundary.route.test.tsx`
  (a mocked lazy route throws → card + chrome-stays-alive + Back to notes recovers) and
  `App.error-boundary.chrome.test.tsx` (a mocked `Header` throws → the top-level net's full-page
  card, no route chrome survives).

## [0.20.8] - 2026-07-17

**Editor Wave 2 — focus mode.** POLISH-WAVE PR 4, plus EDITOR-STUDY §3.3's addition: one gesture
and the room goes quiet. Scoped to the reading/writing rooms only (`/n/:id`, `/n/:id/edit`) — not
a global mode. Version note: this PR was built in parallel with a sibling capture-chip PR that
claims `0.20.7`; this one takes `0.20.8` on the assumption the sibling lands first (or adjacent) —
flagged for the merge sequencing, not a collision either PR needs to resolve itself.

- **`src/lib/focus-mode.ts`** — a tiny, non-persisted zustand store (`on`/`setOn`/`toggle`, the
  `useQuickSwitchOpen` shape) plus `isFocusablePath()`, matching only `/n/:id` and `/n/:id/edit`.
- **`FocusModeMount`** (`src/components/FocusModeMount.tsx`), mounted once inside the router:
  owns the `⌘.` door in (a no-op off a focusable route) and the route-change reset that keeps
  focus mode ephemeral — any navigation, including the read↔edit hop on the same note, leaves it
  behind.
- **`AppShell`** (`App.tsx`, pulled out of `App()` so it can read the route): gates
  Rail/Header/BottomTabBar/AppFooter/SpeedDial/AmbientMapFab off the store AND `isFocusablePath`
  (belt-and-suspenders — the guard can't matter if the reset already fired, but it's the literal
  spec ask). Chrome disappears instantly rather than animating out, matching PR1's already-shipped
  "entrances only, exits stay instant" rule instead of relitigating it for this case. The Header/
  Rail's `env(safe-area-inset-top)` relocates onto the content wrapper while they're gone.
- **Doors out:** `⌘.`, a floating top-right exit chip (`FocusModeExitChip`, `.glass-panel` +
  `.enter-fade` — PR1's floating-surface family), and — read route only — Escape. The editor route
  deliberately has no Escape handler: CodeMirror already binds Escape to cancel-edit
  (`CodeMirrorEditor.tsx`), so stacking a second meaning on the same key there would be unsafe;
  `⌘.` is the edit route's only keyboard door out, per spec.
  A quiet ghost "Focus" button (new `IconExpand`/`IconShrink` glyphs) lives in NoteView's action
  row and NoteEditor's header.
- **EDITOR-STUDY §3.3's addition:** in the edit route, focus also collapses the editor's whole
  header card (path input, tag editor, Pin/Delete/Revert/Cancel/Save) down to a single floating
  save-state whisper — the SAME indicator from PR2 (`SaveStateWhisper`, extracted, not
  reinvented), relocated rather than rebuilt. `⌘S` and Escape-to-cancel keep working from the
  keyboard regardless — CodeMirror owns those bindings independent of what chrome is on screen.

Tests: `focus-mode.test.ts` (store + route matcher), `FocusModeMount.test.tsx` (⌘./Ctrl+.
toggling, route-change reset), `NoteView.test.tsx` + `NoteEditor.test.tsx` (ghost buttons, header
collapse/restore, Escape semantics per route), `AppFocusMode.test.tsx` (full-shell integration:
chrome hide/restore, the safe-area-inset relocation, the `isFocusablePath` guard in isolation).
## [0.20.7] - 2026-07-17

**Capture chip: visible-default-removable + note-path copy affordance.** Two Aaron-ratified
items.

- **Capture chip loosening.** `buildTextNotePayload` (`src/lib/capture/text-note.ts`) no
  longer force-injects the capture role tag at save time — it takes the tag row's chips as
  given. Both typed-composer surfaces (`NoteNew`'s tag editor and Home's `Composer`, which
  gains its own compact tag row once the card opens) now pre-populate the capture role tag as
  a visible, removable chip at compose time, and sync it in until the operator explicitly
  adds or removes a chip in that session — after which their chip set is authoritative and a
  deliberately-removed capture tag is never re-added underneath them. Someone who never
  touches the tag row still gets byte-identical behavior (the tag ends up in the payload,
  same as before); the pre-populated chip alone also doesn't trip the draft-autosave dirty
  check or NoteNew's leave-guard/Cancel confirm. Voice capture (`NoteNew`'s `saveWithAudio`)
  is untouched — it builds its own payload directly and keeps unconditionally applying its
  role tags, by design (out of scope for this loosening).
- **Note-path copy affordance.** The note view's metadata card gets a **Path** row (reusing
  `CopyField`, the app's existing copy-with-toast-and-transient-label pattern) plus a
  standalone **Copy reference** button — path is plumbing, but on a note it stays grabbable
  because it's how you reference a note to an AI agent.

## [0.20.6] - 2026-07-17

**Views Wave 1 — the view organ.** From VIEWS-RENDER-SPEC: a view is a note tagged `#view`
whose metadata (`kind`, `query`, `lane_by`, `date_field`) is the definition — the note body
stays prose for people. This wave lands the module, the list-kind renderer, and the Rail's
new Views band. Purely additive: nothing about the four existing default pages changes
behavior (their cutover to the same pipeline is Wave 2).

- **`src/lib/views/`** — the canonical module: `decodeViewDef()` never throws and never
  returns null for a `#view` note (unknown/absent `kind` degrades silently to `list`;
  malformed `query` JSON degrades to `query: null` + a recorded problem, never an implicit
  "everything" query); `viewQueryToNotesQuery()` maps the MCP-grammar query object to the
  vault's typed `NotesQuery`, dropping unrecognized keys with a named problem rather than
  silently passing them through to a server 400; `partitionPinned()` groups pinned results
  above the rest within the view's own result set (replacing the sort-to-top VaultSurface
  uses today). The spec's §8 legacy-saved-views adapter is **void** — that old
  `{kind:"saved-view", filters}` shape at `UI/Views/<name>` was confirmed unused in practice
  and is out of scope entirely: no adapter, no reconciliation, and such notes are explicitly
  excluded from the Rail band. `src/lib/saved-views/` is untouched (dead code; a follow-up
  deletes it outright).
- **`ViewSurface`** (`/views/:id`, note id not path) — list kind this wave; a problems banner
  degrades honestly instead of blanking the page on a malformed view; a refinement bar
  (tag-include, tag-exclude-toggle on the base query's own chips, search, sort) reads/writes
  the URL so refinements survive reload and are shareable; the Save sheet offers "Update this
  view" or "Save as new view," defaulting on whether the signed-in principal's JWT `sub`
  matches the note's `createdBy` (display-only — never a security boundary).
- **The Rail's new "Views" band** (between "Your notes" and "Explore") — fed by a `tag=view`
  query with no path prefix, the four shipped default-page paths excluded (they already have
  Rail rows), each item wearing a combined hue-dot + kind-glyph mark; a permanent "New view"
  row creates a `#view` note at `Views/<name>` (kind list, empty query) via the new
  `/views/new` ceremony and opens it.
- **`src/lib/hue/hue.ts`** — the surface-owned hue module EDITOR-STUDY §7/§9 called for: a
  tag name resolves to one of 8 curated "garden" hues (sage/sky/sun/coral/grass/clay/ochre/
  plum) — hand-assigned for a handful of known roles, deterministically hashed for everything
  else. Zero data change; nothing is stored. A view's hue comes from its query's primary tag
  (the subject); the kind carries the glyph. Landed here per VIEWS-RENDER-SPEC §9 ("whichever
  PR train lands it first, the other imports") — no hue module existed on `main` yet.
- **`NoteView`** gains the bridge's other half: a `#view`-tagged note shows "Open as view,"
  linking to `/views/:id`; `ViewSurface`'s own "Edit view note" is the trip back — two faces
  of one note, no separate view-editing UI.

## [0.20.5] - 2026-07-17

**Editor Wave 1 — "one voice."** From the editor-experience design study: the editor and the
reader become the same room. Presentation-only, no storage/path/wire changes.

- **Type-scale unification.** The page-title clamp is retuned to
  `clamp(var(--text-2xl), calc(var(--text-xl) + 1.2vw), 2.25rem)` — ~27px phone / ~31px tablet
  portrait / 36px desktop cap, a document heading rather than a poster. Live-editor headings move
  onto the shared serif ramp (`.cm-lp-h1` → `--font-serif` + `--text-3xl`, H2 → `--text-2xl`, H3 →
  `--text-xl`, H4-6 → `--text-lg`/600) instead of an ad-hoc sans em scale, so a heading is the same
  object at the same size in edit and read. A new `--lh-live: 1.7` token (meeting reading's 1.78
  and the old code-editor 1.6 in the middle) drives the live editor's scroller and every
  height-locked live-preview widget (`.cm-lp-hr`, `.cm-lp-embed-chip`) together, so the
  reveal-never-reflows invariant holds.
- **Humanized default titles.** A `displayTitle()` refinement in `note-title.ts` pattern-matches
  `quickPath()`-shaped leaves (`Notes/YYYY/MM-DD/HH-MM-SS`) and renders them as a formatted
  timestamp ("July 16 · 10:48 PM", muted, placeholder weight) instead of the raw date-path leaf —
  in NoteRow, the Recent timeline (via NoteRow), QuickSwitch, and NoteView's page-title slot.
  Notes with real content keep today's title logic byte-identical. Composer placeholder copy is
  now "Name your note — or just start writing."
- **Scroll-past-end.** CM6's stock `scrollPastEnd()` plus a ~30%-viewport bottom scroll margin, so
  typing at the bottom of a long note no longer pins the caret to the floor.
- **Wikilink/external link distinction.** Solid underline for wikilinks ("stays home"), dashed
  underline for external links ("leaves") — in both the live editor (`.cm-lp-link` vs
  `.wikilink`) and the read view, which additionally gets a small departing-arrow after external
  links (CSS `::after`, no extra DOM).
- **Tailwind v4 bracket-syntax fix (app#41).** 17 `text-[--color-x]`/`max-w-[--w-x]`-style
  arbitrary values across the app were silently compiling to invalid CSS (`color: --color-x`,
  missing the `var()` wrap) — converted to the `(--var)` parens shorthand, matching the fix
  already landed in Toaster.tsx. This restores the dark-accent WCAG-AA on-accent color override on
  every affected button/badge.

## [0.20.4] - 2026-07-16

**Atmosphere set (uni-surface adoption, display-only — awaits Aaron's morning review, not
merged on landing).** Four finishing touches adopted from Aaron's uni-surface "feels really
good to write in" reference, working entirely within the app's existing coral/warm-forest
token system (no palette import, no re-skin):

- **A second ambient ground wash.** `.app-canvas` already carried one grass-tinted radial wash
  top-center; it now carries a second, coral-tinted wash from the opposite corner
  (`--canvas-wash-accent`, tuned separately per theme: 5% light / 4% dark), so the page ground
  has two soft light sources instead of one. No `background-attachment: fixed` — it's painted on
  the normal-flow shell, so it scrolls with content (no mobile jank).
- **Dark-theme shadows re-tinted off pure black.** Light-theme shadows were already
  forest/sage-tinted; dark-theme `--_d-shadow-*` used flat `#000`. A new `--_d-shadow-ink` mixes
  a whisper of the dark accent into black, so dark-mode elevation now reads as warm-near-black
  rather than neutral black, without losing the contrast a dark shadow needs against the night
  ground.
- **`::selection` carries a soft accent wash** instead of the browser default, in both themes for
  free (one `color-mix(in srgb, var(--color-accent) 24%, transparent)` rule — no dark override
  needed since the accent token already flips per theme). AA-checked in both directions.
- **`.note-row` hover-lift.** THE note row (Recent, day drill-in, `/notes` — one shared anatomy)
  now lifts `translateY(-1px)` with a soft shadow on hover, riding the existing
  `--dur-move`/`--ease-out` tokens. Gated to `(hover: hover)` (no stuck-lift on touch taps) and to
  `prefers-reduced-motion: no-preference` (double-guarded with the token-zeroing gate, same
  pattern as `.btn-primary`'s hover lift).

## [0.20.3] - 2026-07-16

**UI-audit display train.** Display-only fixes from the overnight UI look-and-feel audit
(walker capture across 6 viewport/theme configs) — no data-model changes, no IA restructuring,
no new features.

- **Wide tables reachable on phone.** `.prose-note table` gets its own horizontal scroller
  (the GitHub-markdown-body `display: block; width: max-content; max-width: 100%; overflow-x:
  auto` pattern) instead of being silently clipped by `.app-canvas`'s `overflow-x: hidden` — an
  8-column table's rightmost ~330px was permanently unreachable on a 390px viewport, with no
  scrollbar and no affordance.
- **Human copy on note-load errors.** A missing/failed note used to show the literal internal
  request line (`GET /api/notes?id=…→404`), unwrapped and clipped on phone. Now: friendly copy
  ("Couldn't find this note…"), a "Back to notes" action beside "Try again", and the raw detail
  tucked into a collapsed, word-broken `<details>` so it can never clip again.
- **A real not-found page.** An unrecognized multi-segment route (or the reserved `/vault/*` /
  `/u/*` path-space) used to silently teleport home with only a toast. It now renders a proper
  "Page not found" page with a "Back to notes" action, at the address you actually landed on.
- **New-note surface, three fixes:** the auto-generated date-path title renders small/muted while
  untouched (a suggestion, not a headline) and switches to the normal display treatment once you
  type your own; the empty editor canvas shows a "Start writing…" placeholder (serif, italic,
  warm-muted ink — same quiet voice as the empty-note placeholder below); the compose screen's
  implicit `capture` tag stays as-is (investigated — see PR body).
- **Search palette scrim.** ⌘K's command palette gets a proper backdrop — tinted with the app's
  own ink (not flat black) plus a soft blur, fading in over ~180ms, so the world behind recedes
  warmly instead of going dark; reduced-motion-gated like every other overlay. The floating
  pill/panel no longer reads as a transparent inline layer.
- **Empty-note body placeholder.** An empty note's body used to be blank whitespace,
  indistinguishable from a failed load. Now: quiet "Nothing here yet." copy (serif, italic,
  warm-muted ink — the same voice `.prose-note blockquote` already carries) + a "Start writing"
  link into the editor.
- **Tag-row touch targets.** The Tags page's Pin/Schema/Rename actions pad to a ≥44px effective
  hit area (padding + a negative-margin claw-back, so the visible row height is unchanged).
- **No duplicate wordmark on phone arrival.** The mobile top-bar chrome (with its hamburger,
  which had nothing to open on a signed-out screen) no longer renders on the arrival route —
  Landing's own wordmark lockup is the only one on screen there.
- **Task-list view/edit consistency.** View mode no longer shows both a bullet dot and a checkbox
  on the same task item — the bullet is redundant once the checkbox exists, and edit mode never
  showed it.
- **Account email wraps instead of ellipsizing** on phone — exactly the string you'd want to read
  in full.
- **Tag schema dialog teaches, not just asks.** An intro paragraph explains what a meta tag is;
  a live example (`status — string`, `meeting_date — date`) sits under the Fields legend. Copy
  only — the `date` field type was already wired end-to-end.
- **`@openparachute/surface-render` bumped `^0.2.0` → `^0.3.0`.** Single newlines in a note's
  markdown now render as line breaks (Shift+Enter shows what you typed), matching the shared
  package's new `breaks: true` default — the app never overrides it.

## [0.20.2] - 2026-07-16

**Type & spacing sweep (Polish PR 3/6).** Third of the polish-wave train (display-only — no
data-structure, note-format, or wire-contract changes). Closes the gaps in rows, digits, and
corners so the app reads as one set of decisions rather than five.

- **Tabular digits.** `tabular-nums` on every place a count or timestamp sits where digits should
  hold a column: `NoteRow`'s relative-time stamp, `QuickSwitch`'s tag counts + results-footer
  count, `Tags`'s per-tag count badge + the "N / M tags" footer, the Calendar day-grid numerals,
  and `NoteView`'s Outbound/Inbound link-count heading.
- **Title balance.** `text-wrap: balance` on `.page-title` and `.hero-title`; `text-wrap: pretty`
  on `.prose-note p` — free elegance on every heading and paragraph that wraps. CodeMirror owns
  its own wrapping in the editor pane, untouched.
- **Row title step.** `NoteRow`'s title moves from `text-sm` to `text-base` — it was sitting at
  the same size as its own preview line, flattening the hierarchy a list needs. Preview stays
  `text-sm`, the timestamp stays `text-xs`; the `items-baseline` row alignment and truncation are
  unaffected.
- **Radius coherence.** STYLE.md's ramp puts interactive chrome at `lg`+; a `rounded-md` grep
  across `src/components` and `src/app/routes` turned up ~45 stray call sites still at the
  code/table radius. Buttons, inputs, and clickable rows move to `rounded-lg`; the mobile editor's
  pane-toggle tabs drop to `rounded-sm` to nest inside their already-`rounded-lg` tablist wrapper;
  floating popovers/dropdown menus (`TextSizeControl`, the saved-views + tag-suggestion menus in
  `VaultSurface`) move to `rounded-xl` + `shadow-lift`, matching the sync popover's PR-2 precedent;
  standalone confirm-dialog panels (`TagRenameDialog`, `DeleteNoteButton`, `RemoveAttachmentButton`,
  the iOS install hint) move to `rounded-2xl` + `shadow-lift`, matching `.dialog-panel`. Left
  alone by design: code/kbd/table chrome, non-interactive status/warning/error boxes (several
  carry pre-existing raw-color literals — a separate token-contract cleanup, not this PR's job),
  skeletons, and inline text chips.

## [0.20.1] - 2026-07-16

**Calm micro-states (Polish PR 2/6).** Second of the polish-wave train (display/interaction only
— no data-structure, note-format, or wire-contract changes). Every new transition consumes PR 1's
motion tokens; nothing here escapes the reduced-motion gate.

- **"Saved" whisper.** After a checkpoint save (⌘S) succeeds, the editor header shows `Saved ✓` in
  accent for ~1.5s, then settles back to `saved just now` — a state + timeout in `EditorSurface`
  (`NoteEditor.tsx`), cleaned up on unmount. No spinner, no toast; the Save button's "Saving…"
  label is unchanged. The "unsaved" dot still wins the moment you resume typing.
- **Sync dot token hygiene.** `SyncStatusIndicator`'s dot dropped its raw Tailwind color literals
  (`emerald-400` / `amber-400` / `sky-400` / `red-400` / `red-500`) for the semantic tokens:
  online → `--color-grass`, offline → `--color-warning`, syncing → `--color-sky` (pulse kept),
  halted → `--color-danger`, unreachable → a `color-mix()` toward canvas (keeps the
  lighter-red distinction from colour-blind-safe halted/unreachable). The popover's chrome moved
  from `rounded-md`/`shadow-lg` to the `--radius-xl`/`shadow-lift` floating-surface pair.
- **Toaster surface.** Same floating-surface pair (`--radius-lg` + `shadow-lift`); the dismiss `×`
  button picks up `.focus-ring`. Entrance motion already landed in PR 1. Also fixes a live bug on
  the error-tone toast: Tailwind's `[--foo]` bracket arbitrary-value syntax takes the value
  literally (no `var()` wrap), so `border-[--color-danger-border]` etc. were compiling to the
  invalid `border-color: --color-danger-border` — silently dropped by the browser. Switched to the
  `(--foo)` parens form (the CSS-var shorthand that *does* wrap; the same form PR 1 already relies
  on for `duration-(--dur-move)`), confirmed against the built CSS. The same bracket-syntax bug is
  pre-existing in ~11 other files outside this PR's scope — flagged as a follow-up, not fixed here.
- **Skeleton consolidation.** `VaultSurface`'s hand-rolled `RecentSkeleton` rows now render through
  the shared `Skeleton` primitive instead of a bespoke `animate-pulse` div, so reduced-motion
  coverage is inherited rather than re-implemented.
- **Focus-visible sweep.** `.focus-ring` added to the note back-links (`NoteView`, `NoteEditor`),
  the footer's ecosystem link (`App.tsx`), and the draft-offer Restore/Discard buttons
  (`NoteEditor.tsx`) — every one of those stops was previously invisible on keyboard tab.

## [0.20.0] - 2026-07-16

**Motion as a system (Polish PR 1/6).** Aaron's steer: "keep on cooking on the UI stuff — the
focus is definitely polish, how it feels overall." First of the polish-wave train
(display/interaction only — no data-structure, note-format, or wire-contract changes). The audit
found five ad-hoc duration values, three easings, and every floating surface (NavSheet,
QuickSwitch, the sync/vault/text-size popovers, the Toaster, `.dialog-panel`) appearing with zero
entrance acknowledgment; reduced-motion was honored by hand in eight `motion-reduce:` sprinkles
plus two CSS blocks rather than by system. This PR replaces all of it with one vocabulary.

- **Five motion tokens**, `@theme` in `index.css`: `--dur-quick` (120ms, state changes) /
  `--dur-move` (200ms, transforms/resizes) / `--dur-enter` (280ms, surfaces arriving) /
  `--ease-out` (the new calm-settle curve, promoted to the theme's `ease-out`) / `--ease-spring`
  (the existing `.btn` spring, promoted and reused).
- **Every existing transition retimed to a token** — no visual redesign, nearest-token retiming
  only: `.btn`, `.input`/`.textarea`/`.select`, `.composer`, `.note-row`, `.tile` (CSS); Rail's
  width + chevron rotate, SpeedDial's three scale/rotate transitions, Composer's inline
  min-height transition (Tailwind `duration-(--dur-move)` / arbitrary-property call sites).
  `fade-up`'s duration moves to `--dur-enter`. Bare `transition-colors`/`transition-shadow` in
  files this PR was already touching (Rail, Composer, NavSheet, SpeedDial, QuickSwitch) picked up
  explicit `duration-(--dur-quick) ease-out` instead of Tailwind's implicit 150ms default; the
  remaining ~11 untouched `transition-colors` call sites elsewhere are left alone (within a hair
  of the token already, converting them is separate-PR churn).
- **Entrances** — two new keyframe classes, `.enter-rise` (opacity + translateY(10px)→0,
  `--dur-enter`) and `.enter-fade` (opacity only, `--dur-quick`), both on `--ease-out`. Applied to
  every floating surface that used to pop: NavSheet's panel + scrim, QuickSwitch's dialog + pill
  column + results panel, the SyncStatusIndicator popover, the VaultSwitcher rail popover, the
  TextSizeControl popover, each Toaster entry, and — baked directly into the shared classes so
  future consumers inherit it for free — `.dialog-overlay`/`.dialog-panel`. Exits stay instant by
  design (calmer than deferred-unmount machinery for a one-frame dismissal).
- **One reduced-motion gate.** `--dur-move`/`--dur-enter` zero to 0ms under
  `prefers-reduced-motion: reduce`, so every transform/resize/entrance that consumes them goes
  instant automatically — no per-component opt-in needed for new motion. `--dur-quick` is left
  alone (color/border/shadow settles aren't the vestibular-safety concern WCAG 2.3.3 targets).
  The eight per-callsite `motion-reduce:transition-none` sprinkles are retired in favor of this
  one block; the two SpeedDial `motion-reduce:hover:scale-100`/`group-hover:scale-100` guards are
  kept as-is (a distinct, stricter concern — suppressing the hover scale value itself, not just
  its transition timing).

## [0.19.2] - 2026-07-16

**Reserve `/vault` + `/u` path-space for the one-origin domain (my. Phase A2).** Prep work for
`my.parachute.computer`, the ratified one-origin door where `/vault/<name>/*` is a Cloudflare
zone route to the vault worker (the data plane) dispatching ABOVE this app, and `/u/<handle>/*`
is reserved for Phase B's per-account vault namespace. This app must never intercept either as
its own — no wire/route change (nothing here already claims those prefixes), pure guardrails +
pins so a future change can't accidentally collide. Patch bump — no user-visible behavior change.

- **Service worker**: `pwa-navigation-denylist.ts` denies `/^\/vault\//` and `/^\/u\//` — an
  installed PWA's `navigateFallback` must never swallow a `/vault/<name>/...` or
  `/u/<handle>/...` navigation into the cached SPA shell, even if the zone route is ever
  misconfigured. Bare `/vault` and `/u` (no further segment) stay undenied — there's no
  server-owned page at exactly that path, so a note literally named "vault" or "u" keeps
  resolving as it does today.
- **Router-root reservation**: a comment block in `App.tsx` documents `/vault` and `/u` as
  permanently foreign prefixes; confirmed (and pinned via `App.test.tsx`) that the single-segment
  `/:id` bare-path shim can't collide with a two-segment `/vault/<name>` or `/u/<handle>/...`
  path — both already fall through to the `*` catch-all today.
- **`base-url.ts` sanity**: pinned that `detectMountBase()` never misreads `/vault/*` or `/u/*`
  as a sub-mount — `MOUNT_PATTERNS` only recognizes `/surface/<slug>` and `/notes/`.

## [0.19.1] - 2026-07-16

**Live-preview polish: reveal/containment/quote nits (A5), drop Pages-era public artifacts.**
Three cosmetic fixes from PR #36's review, plus the app-side half of cloud#156's belt-and-
suspenders cleanup. Patch bump — decoration-correctness fixes only, no new room.

- **N1 — wikilink reveal keeps its color mark.** Revealing a wikilink's line used to drop the
  `wikilink` style mark along with the hide-marks (the whole match was skipped on reveal); inline
  links never had this bug since their `style()` call was already unconditional (invariant 2). The
  wikilink loop in `buildDecorations` now uses the same `hide()`/`style()` split as the Link case:
  markers hide on reveal, the display-text color mark never does.
- **N2 — wikilink containment symmetry.** The `Link` containment case used `break` (still descends
  into children) while `Image` used `return false` — so a wikilink like `[[target with **stars**]]`
  got its nested `**` hidden by the incidental StrongEmphasis parse of the fake inner Link node,
  splitting the display text out of its own color span. `Link` now matches `Image`'s `return false`.
- **N3 — blockquote lazy-continuation border.** The quote-border line class was applied per-
  `QuoteMark`, so a lazy-continuation line (quote content with no leading `>`, per CommonMark) —
  still part of the same `Blockquote` node — missed its border. The line class now applies across
  the node's whole line range, same pattern as the FencedCode/CodeBlock loop just above it.
- **Drop `public/_redirects`** (Cloudflare-Pages-era SPA-fallback rule) — this app deploys as a
  Cloudflare Worker (Static Assets + `run_worker_first`), and the identity worker does its own SPA
  fallback; Pages is dead for this app. `public/CNAME` didn't exist in this repo (nothing to drop
  there). cloud's `build-spa.sh` keeps its defensive strip of both files — belt (there) and
  suspenders (here), cloud#156.

## [0.19.0] - 2026-07-16

**Live-preview editor — markup fades, todos become checkboxes, one calm pane (A4, the editor
arc's flagship).** The CM6 editor stops dressing like a code editor: every line renders formatted
(markup faded/hidden, `**bold**` styled bold, headings scaled up), the line(s) the cursor touches
reveal raw markdown underneath. Live preview is the new default single-pane editing mode; the
split-pane raw editor stays reachable via one Settings toggle (the escape hatch). Minor bump —
default-ON behavior change to the editing surface, no wire/data-shape change.

- **Engine: `src/lib/editor/live-preview.ts`** (new) — a `ViewPlugin` computing decorations from
  the syntax tree over `view.visibleRanges` ONLY (never the whole doc), rebuilding on
  `docChanged || selectionSet || viewportChanged` and skipping rebuilds mid-IME-composition. Two
  invariants the whole design hangs on: (1) the module has exactly ONE `view.dispatch` call — the
  checkbox widget's tap handler; everything else only ever reads state and produces decorations;
  (2) reveal never changes vertical layout — heading font-size / code background / widget heights
  apply unconditionally, only marker VISIBILITY toggles on reveal.
- **Parser switch (both modes):** `markdown()` → `markdown({ base: markdownLanguage })` — the bare
  default is commonmark-only; the GFM base is what puts `Task`/`TaskMarker` (todos),
  `Strikethrough`, and `Table` in the tree at all.
- **Decoration inventory:** ATX headings (scaled, marker hidden), bold/italic/strikethrough
  (marker hidden, existing highlight already styles the span), inline code (chip), links (text
  styled, `](url)` hidden), wikilinks/embeds (regex-mirrored from
  `parachute-surface/packages/surface-render`'s `remark-wikilinks.ts` — neutral styling only, no
  resolved/unresolved split; a follow-up issue is filed there to export the regex so this mirror
  can be deleted), task checkboxes (real tappable `<input type="checkbox">`, ≥2.5rem hit area via
  a negative-margin padding trick, toggle writes exactly the one bracket character), bullet/
  ordered lists, blockquotes (border + existing italic), horizontal rules (widget), images/embeds
  (placeholder chip, v1 — no inline rendering). Fenced/indented code interiors and frontmatter are
  fully opaque to every pass — provably undecorated, tested. GFM tables render raw (out of scope
  for v1; dedicated editing UI later).
- **Chrome (live mode only):** gutter gone (`lineNumbers()` omitted), prose font stack + size
  mirroring `.prose-note`, capped measure (`--w-prose`). Raw mode is byte-for-byte today's editor.
- **Flag + Settings:** `src/lib/editor-mode.ts` (mirrors `text-size.ts`'s read/write pattern),
  key `notes:livePreview`, default ON (`"off"` is the one persisted sentinel). New "Live preview"
  toggle in Settings, adjacent to Text size. `CodeMirrorEditor` gains a `livePreview` prop, read
  once at `NoteEditor`/`NoteNew` mount — a runtime kill-switch, not a live Compartment swap. When
  ON, both routes collapse to single-pane (no `NoteRenderer` preview column, no mobile edit/
  preview tab strip); OFF is the exact split-pane raw editor, unchanged.

**Riders (separate commits, same PR):**
- **R1 — `useAllNotesForSwitcher` (Cmd+K) and `useAllNotesWithLinks` (the graph) send `sort:
  "desc"`** (`src/lib/vault/queries.ts`): both previously sent a hard `limit` with no explicit
  sort, so the vault's `created_at ASC` default silently dropped the NEWEST notes — not the
  oldest — off a vault past `VAULT_GRAPH_NOTE_CAP`. Now matches the other capped-window queries.
- **R2 — GFM table Enter/Shift+Enter route** (`src/lib/editor/paragraph-break.ts`, closes app#35):
  once the parser switch put `Table` in the tree, a table row gets the same treatment as a fence
  — a plain newline, never a paragraph break (which would explode a blank line into the table) or
  a hard-break backslash.
- **N3 — the slash-menu's deliberately-deferred indented-code edge is closed**
  (`src/lib/editor/slash-completion.ts`): the completion SOURCE now gates on
  `syntaxTree(state).resolveInner(pos, -1)`, refusing to open inside `FencedCode`/`CodeBlock`/
  `InlineCode`/`CodeText` — while correctly still opening on a list-item continuation line
  indented 4+ spaces, which is NOT code to lezer (list context wins), where the old pure-regex
  matcher couldn't tell the difference. Applies to both editor modes.

**Review fixes (pre-merge, PR #36):** the PR's review pass (33/33 scripted real-browser checks at
tablet + phone viewports, via Playwright) caught three issues fixed before merge:

- **M1 (font/theme precedence):** live mode was silently rendering mono@15px with zero inline
  padding instead of the intended prose look — `livePreviewChromeTheme` and the original shared
  `lensTheme` set `fontFamily`/`fontSize`/inline-padding on the SAME selectors at EQUAL
  specificity, and CM6 resolves that tie by observed stylesheet order, not by position in the
  `buildExtensions` array (the original "ordered after `lensTheme` so it wins" comment was
  verified false in a real browser). Fixed by making the two modes mutually exclusive font/padding
  authorities: `lensTheme` now carries only mode-agnostic chrome, a new `rawModeTypographyTheme`
  (`CodeMirrorEditor.tsx`) is raw mode's authority, `livePreviewChromeTheme` stays live mode's —
  never both included at once, so there's no tie to lose.
- **S1 (reference-style links/images should render raw):** `[sic]` / `[text][ref]` / `![alt text]`
  have no `URL` child in the tree (confirmed against the actual parse output — true even when a
  matching `[ref]: url` definition exists elsewhere), so the `Link`/`Image` decoration cases now
  bail (`if (!url) break`/`return false`) before decorating — they were being treated as real
  links/embeds, which A4-SPEC §2 explicitly puts out of v1 scope.
- **S2 (IME staleness, silent 1-char corruption):** the checkbox widget's tap handler used its
  build-time `markerFrom` closure to compute the dispatch range; a composition edit between when
  the widget was built and when it's tapped remaps the decoration set's ranges but never touches a
  widget instance's own captured fields, so a stale `markerFrom` could silently write into whatever
  character now sits at that old offset. Fixed: the tap handler derives its position FRESH via
  `view.posAtDOM`, then guards the dispatch on the live doc text at that position actually matching
  `[ ]`/`[x]` — a mismatch (including a fully detached/stale widget) downgrades to a missed tap,
  never a write.

**Manual pass:** the review's own scripted Playwright pass (33/33 checks, tablet 768×1024 + phone
390×844) covers A4-SPEC §10's manual checklist — live-mode chrome, markup fade/reveal, zero
scroll-jump on reveal, checkbox tap-toggle + buffer proof, slash-menu-still-opens, and the full
Settings-toggle round trip (ON → OFF raw mode → back ON). Re-run clean against this fix commit.

- Tests: `src/lib/editor/live-preview.test.ts` (33 — the invariant test across 5 corpus fixtures,
  reveal correctness, checkbox toggle exactness/undo/onChange-once/tap-never-eaten-by-reveal/
  stale-widget-guard, touch-target computed style, one-font-authority-per-mode computed style,
  fence/indented-code/table sanctity, frontmatter guard, wikilink/embed decoration incl. the
  Link-node double-decoration regression and reference-style links/images rendering raw, and the
  <50ms full-doc perf bound), `src/lib/editor-mode.test.ts` (3), `src/lib/vault/queries.sort.test.tsx`
  (2 — real fetch URL assertions, not a mocked `queryNotes`), plus additions to
  `src/components/CodeMirrorEditor.slash-menu.test.ts` (+5 — the N3 gate) and
  `src/components/CodeMirrorEditor.newline.test.ts` (+2 — the table Enter route). Fixtures:
  `src/lib/editor/__fixtures__/corpus/` (representative, not real vault content).

## [0.18.0] - 2026-07-16

**Provenance badge + paragraph-break Enter (A2+A3 of the editor arc).** Two independent,
Aaron-ratified pieces bundled in one PR: who/what wrote a note, and how Enter behaves while
writing one. Minor bump — new display data + a keymap behavior change, no wire/data-shape
change.

- **`ProvenanceBadge`** (`src/components/ProvenanceBadge.tsx`, `src/lib/note-provenance.ts`) —
  a small, factual attribution line reading the write-attribution fields vault#298 landed on the
  wire (`createdBy`/`createdVia`/`lastUpdatedBy`/`lastUpdatedVia`, all nullable), now on the app's
  `Note`/`NoteSummary` types via `@openparachute/surface-client` 0.3.5 (bumped from `^0.3.4`; see
  the PR description for why a dependency bump won over local types). Mounted in BOTH `NoteRow`
  (compact — one short fragment beside the relative-time stamp) and `NoteView`'s metadata panel
  (detail — the fuller created/updated pair, shown only when the two differ). FACTUAL PROVENANCE
  ONLY: `*Via` channels map to a friendly noun (`mcp` → "via MCP", `agent:<id>` → "via agent",
  `surface:notes` → "via Notes") — never a human-vs-AI guess. The raw principal (`*By`) never
  appears as visible text, only in a `title` tooltip. Null/legacy records render nothing — no
  "unknown" placeholder noise.
- **Enter — context-aware paragraph break** (`src/lib/editor/paragraph-break.ts`, wired into
  `CodeMirrorEditor.tsx`'s keymap ahead of `defaultKeymap`, which otherwise binds Enter to
  `insertNewlineAndIndent`): in prose, a REAL blank line (two `\n`) so the file stays unambiguous
  CommonMark; in a list item or blockquote, delegates to `@codemirror/lang-markdown`'s own
  `insertNewlineContinueMarkup` (marker continuation, and an empty list item still exits the
  list — native behavior, untouched); inside a fenced code block, a single plain newline. **Shift
  +Enter — explicit hard break**: `\`-before-newline in prose (survives whitespace trimming,
  deliberately not the trailing-two-spaces convention); a plain single newline in
  lists/quotes/fences (a bare backslash there would land on a marker-less continuation line and
  misparse, or corrupt a fence's literal bytes). Both commands sit at the editor's default keymap
  precedence, so the slash-menu's own Enter-commits-completion binding (`Prec.highest` inside
  `@codemirror/autocomplete`) is tried first and still wins while the menu is open — nothing
  about A1 changed.

| Context | Enter | Shift+Enter |
|---|---|---|
| Prose | blank line (`\n\n`) | hard break (`\\\n`) |
| List item | marker continuation (empty item exits) | plain newline |
| Blockquote | marker continuation | plain newline |
| Fenced code | plain newline | plain newline |
| Slash-menu open | commits the completion | commits the completion |

- Tests: `src/lib/note-provenance.test.ts` (12 — the null/legacy case, created-only, same-vs-
  differing-principal, the raw-tooltip/never-visible-label contract, and the full via-label
  mapping table) and `src/components/ProvenanceBadge.test.tsx` (8 — both mount-point variants:
  renders-nothing, created-only, created+updated-differ, and the same-principal-suppresses-
  updated case in detail). `src/components/CodeMirrorEditor.newline.test.ts` (7 — prose/list/
  empty-list/fence Enter, prose/fence Shift+Enter, and Enter-with-menu-open-still-commits) against
  a real headless CM6 `EditorView`, the same pattern `CodeMirrorEditor.slash-menu.test.ts` uses.

## [0.17.0] - 2026-07-16

**The "/"-command menu (Editor P0, editor arc).** First visible step of the "Notion-feel,
markdown-underneath" editor direction (EDITOR-RESEARCH.md, Aaron's 2026-07-14 morning-pages
mandate) — deliberately narrow: no live-preview work here, just a fast way to insert common
markdown blocks without hand-typing `#`/`-`/`` ``` ``. Minor bump — a new interaction on the
existing editor, no behavior change to anything that isn't typing `/`.

- **Engine: `@codemirror/autocomplete`**, wired into `CodeMirrorEditor.tsx` as the editor's
  ONLY completion source (`autocompletion({ override: [...] })`) — no clash surface with
  anything else, and it's a no-op outside its own trigger. ↑/↓, Enter, Esc, and click all come
  free from the library; nothing hand-rolled for keyboard nav or click-to-select.
- **Trigger**: `/` at the start of a line, or with only whitespace before it on the line — never
  mid-word (`src/lib/editor/slash-commands.ts`'s `matchSlashTrigger`, a plain regex against the
  current line's text up to the cursor). Typing "and/or" never opens it. Filters live as more
  characters follow the `/`, matching against each command's label or a short keyword list
  (`matchesQuery`).
- **The v1 command set** (label — inserts): Heading 1/2/3 — `# ` / `## ` / `### `; Bulleted list
  — `- `; Numbered list — `1. `; To-do — `- [ ] ` (GFM task list); Quote — `> `; Code block —
  fenced ` ``` ` pair with the cursor on the blank line inside; Divider — `---`, padded with a
  blank line on either side that doesn't already have one (a bare `---` right under a text line
  is a CommonMark Setext-heading underline, not a divider — `"Heading\n---"` renders as an H2);
  Image / attachment — opens the SAME upload flow the page's Attachments section already uses
  (`AttachmentPicker`'s new imperative `open()`, wired through a new `onRequestAttachment` prop on
  `CodeMirrorEditor`), not a second upload path.
- **Every insert is a plain-text buffer edit** — literal markdown characters written straight into
  the doc via the same primitive `CodeMirrorEditorHandle.insertAtCursor` already uses for uploads,
  never a structured object that gets serialized afterward. That's the whole point of staying on
  CodeMirror 6 rather than a block-WYSIWYG engine (EDITOR-RESEARCH.md §5): there's only ever one
  representation of the note, so there's nothing for a second implementation to drift out of sync
  with.
- **Esc layering preserved**: `@codemirror/autocomplete`'s own keymap runs at `Prec.highest`, so
  the first Escape closes an open menu (`closeCompletion`) without ever reaching the editor's own
  Escape binding; only a second Escape (menu already closed) falls through to the existing
  `onCancel`. Same precedence protects ⌘S, paste-file handling, and draft autosave — none of them
  sit inside the completion keymap, so they're untouched.
- **Menu styling**: CodeMirror's own tooltip positioning (flip/clamp to stay on-screen) handles
  the same on-screen-on-tablet job the recent `TextSizeControl` fix did by hand — nothing bespoke
  needed here. Themed as a `.glass-panel`-family popover per STYLE.md's "command palette" surface,
  with touch-sized (2.5rem-min) rows.
- **Deliberately out of scope**: live-preview decoration (Phase 1 of the editor arc), a GFM table
  skeleton (real tables are painful to hand-edit as raw markdown even with live preview — a
  dedicated table UI is a later, separate piece of work), and a `[[`-triggered wikilink
  autocomplete (needs a note-index search the editor doesn't have inline access to yet — a natural
  v1.1).
- Tests: `src/lib/editor/slash-commands.test.ts` (22 tests — trigger matching incl. the mid-word
  negative, query filtering, and every command's `apply()` against a real headless CM6
  `EditorView`, exact-string doc + cursor-position assertions) and
  `src/components/CodeMirrorEditor.slash-menu.test.ts` (8 tests — the actual wiring
  `buildExtensions()` assembles, not a re-description of it: the full 10-command list opening on
  bare `/`, the "and/or" negative through the real completion source, live filtering, a
  real-Enter-keypress commit, the image command driving `onRequestAttachment`, and all three legs
  of the Esc-layering behavior via real `KeyboardEvent` dispatch on `contentDOM`).

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
