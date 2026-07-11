# Parachute App — navigation history policy

This is the written policy every `navigate(...)` / `<Navigate>` call in `src/` must be
justifiable against. Ratified in DESIGN-SPEC §4.3 (the Wave-2 IA redesign spec); this file
is that section's decision table, kept in the repo as the thing builders and reviewers
actually check PRs against.

**Why this exists:** F7 (the navigation audit's finding register) — the auth/vault ceremony
flows chained `replace: true` so aggressively that the browser history stack barely grew.
Two measured shapes: a same-tab sign-in nets a `[/, /]` stack (Back does nothing once, then
exits the app), and a magic-link opened in a new tab has exactly one history entry (the
first Back press exits with no warning). See `WALK-nav.md` (this repo's audit trail) for the
live-measured numbers.

## The principle

> **User-initiated steps push. `replace` is reserved for (a) redirect shims, (b) one-shot
> param consumption, (c) transient auto-advancing beats, and (d) the single post-auth
> landing.**

A "user-initiated step" is any navigation that follows a deliberate click/tap on a link,
button, or card — the kind of transition where landing back on the *previous* screen via
Back is a normal, expected, harmless thing to do. `replace` exists for the opposite case:
transitions where the screen being left was never really "a place" (a redirect shim, a
transient loading beat, a one-shot query param) or where going back to it would show stale
or misleading state (a consumed compose form, a session that no longer exists).

## The decision table

| Transition | push / replace | Rule |
|---|---|---|
| Any rail / tab / sheet / footer / card link | **push** | user-initiated |
| Redirect shims: `/all→/notes`(pre-W2-7: `/all` IS the canonical route), `/graph→/map`(pre-W2-7: N/A), `/pinned`/`/archived`/`/untagged`/`/orphaned`→`/all?view=`, `/capture→/new`, `/:id→/n/:id`, `/today`(no-param — post-W2-3), catch-all `*→/` (+toast) | **replace** | (a) shims leave no trace |
| BootGate `?add=` → `/add` | replace | (b) one-shot param |
| Landing: submit email → `/check-email` | **push** | user-initiated |
| CheckEmail poll success → `/welcome` | replace | (c) auto-advance; returning to a consumed check-email would be wrong |
| `/welcome` dispatcher → any branch destination (naming / welcome-back / picker / net-error) | replace | (c) the dispatcher is transient |
| Welcome-back beat (auto-opens the account's one vault) → `/` | replace | (d) the single post-auth landing |
| Landing "already signed in" card: Open {vault} → `/` | **push** | user-initiated |
| Landing "already signed in" card: Open fails → `/welcome` (fallback to dispatcher) | replace | (c) dispatcher re-entry, not a new place |
| Sign out → `/` | replace | session context is gone; Back into a signed-in page would lie |
| Picker: user picks a vault → `/` | **push** | user-initiated (Back to the picker is harmless and useful) |
| Picker: "＋ Create a new vault" → naming form | **push** | user-initiated (picker → naming) |
| Chooser card (`/add-vault`) → `/welcome?pick=1` / `/welcome?new=1` / `/add` | **push** | user-initiated |
| Switcher verbs (W2-4 — the chooser's cards inlined): Create → `/welcome?new=1` · Connect your own → `/add` · at-limit Upgrade / trial line → `/account` · Manage vaults → `/vaults` | **push** | user-initiated |
| Ready beat "Open my vault →" → `/` | **push** | user-initiated |
| `Account.tsx` VaultsBlock: Open {vault} → `/` | **push** | user-initiated |
| NoteNew save (text or audio) → `/n/<id>` | replace | (b) consumes the compose form (Back to a ghost draft would lie) |
| Note delete (confirmed) → `/` | replace | going back to the deleted note's now-dead `/n/<id>` view would show a stale/not-found note |
| `?link=expired` carry-through, OAuth callback → target | replace | (b) one-shot params |
| Route guard: no active vault → `/` (Settings, NoteView, Today, Tags, Home, Activity, NoteEditor, Notes, VaultGraph, ConnectAI) | replace | (a) the guarded route was never really shown — a shim in spirit |
| **Accepted limit** | — | a magic-link tab will always have an empty stack behind Home, and a returning single-vault user's same-tab sign-in nets a thin `[/, /]` stack — every transition in that specific chain (CheckEmail poll, dispatcher, welcome-back beat) is independently correct as `replace` per the rules above. The cure is **not** history surgery — it's making sure Back is never the *only* escape (the wizard-chrome rule: linked Wordmark + "← Back"/"Maybe later" on every ceremony step, DESIGN-SPEC §4.1 — W2-6's scope). |

## The history-aware escape rule

Used by "Maybe later," a day-view's back link, and any leaf back-affordance that wants to
prefer "go back in history" but degrade gracefully when there's nothing behind it:

```ts
const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
if (idx > 0) navigate(-1);
else navigate(fallbackTo);
```

**Why the `idx` check, not `location.key !== "default"`:** react-router mints a *fresh* key
on every `replace`, so only the untouched initial entry is ever `"default"`. A first-entry
`replace` (e.g. a magic-link tab whose only entry is replaced `/welcome`→`/`) leaves a
non-default key with **no real history behind it** — a key-based check would believe there's
somewhere to go and `navigate(-1)` would step *off-app* (back to the email client).
react-router instead tracks a monotonic entry index on `window.history.state.idx`: it stays
`0` for the first entry no matter how many times it's replaced, and is `> 0` only once a real
push has stacked a prior in-app entry behind the current one. So `idx > 0` is the honest "is
there in-app history behind me" test — it never exits the app. Shipped as
`useHistoryAwareBack(fallbackTo: string)` in `src/lib/nav/history.ts` (reads the browser's
real `window.history`, so it's correct under the app's `<BrowserRouter>`).

## Convention for call sites

Every `navigate(...)` / `<Navigate>` call governed by a row above carries a one-line comment
citing it, e.g. `// NAVIGATION.md: user-initiated open — push` or
`// NAVIGATION.md: (c) dispatcher is transient — replace`. This is what a reviewer diffs
against; a navigation change that doesn't cite (or update) a row here should be treated as
suspect.
