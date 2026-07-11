# Changelog — @openparachute/parachute-app

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
