# Changelog — @openparachute/parachute-app

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
