/**
 * Setup-shelf derivation for the guided vault surface.
 *
 * STATE-DERIVED, not per-device sticky (Wave-3 rework). The bug this closes:
 * the shelf used to persist `dismissed` + two manual "mark done" ticks
 * (`connect`, `import`) in per-device localStorage, so an established
 * account looked un-onboarded on a fresh browser — the shelf would resurface
 * forever on any new device. There is NO localStorage read or write left in
 * this module: every step here is a live fact about the vault, so an
 * established vault reads exactly the same "done" on a brand-new device with
 * empty storage as it does on the one that did the onboarding.
 *
 * What changed from the per-device-tick model (W3 investigation, full
 * writeup in the PR body):
 *
 *   - `write`   unchanged — a user-authored note exists (`hasUserAuthoredNote`).
 *               Auto, cross-device, unaffected by this rework.
 *   - `connect` DROPPED. No client-detectable, door-agnostic signal exists
 *               for "an AI is connected to this vault": the vault's own
 *               `oauth_clients` table is vestigial (parachute-vault 0.4.x —
 *               hub is the OAuth issuer now, vault is resource-server-only);
 *               hub's grant/consent lists (`GET /api/grants`) are gated on
 *               `parachute:host:admin`, not reachable by an ordinary vault
 *               user and hub-only (nothing equivalent exists on the cloud
 *               door); and the account-summary contract
 *               (`GET /account/summary`, `src/lib/account/types.ts`'s
 *               `AccountSummary`) carries no connection field at all. A
 *               manual per-device tick here IS the bug this rework closes —
 *               so rather than keep one, the step is gone. An honest
 *               one-step checklist beats a step that lies on a new device.
 *   - `import`  folded into `write` — both are just "get notes into the
 *               vault" from `hasUserAuthoredNote`'s point of view (an
 *               imported note is exactly as real as a typed one), so a
 *               second row for the same fact was redundant even before this
 *               rework.
 *   - `install` DROPPED from this shelf. Installing a PWA is legitimately
 *               per-device, so it has no business in a cross-device
 *               "is this vault set up" signal. It still gets a nudge — see
 *               `@/components/InstallPrompt`, a fully separate, always-live
 *               (never persisted) affordance rendered in the nav sheet —
 *               but that nudge can no longer make the WHOLE shelf reappear.
 *
 * Net effect: `write` is the only tracked step. Once a real note exists,
 * `deriveSteps` reports it done everywhere, on every device, permanently —
 * there is nothing left to dismiss or resurrect. See `use-home-checklist.ts`
 * for the shelf's (now purely in-memory, per-mount) "hide for now" affordance.
 */

import type { Note } from "@/lib/vault/types";

export type HomeStepId = "write";

// Seed content the vault ships on creation is tagged `#guide` (the vault's
// skill-file tag; see parachute-vault core/src/seed-packs.ts). System notes
// (Notes' own settings) live under `.parachute/`. Neither counts as the user
// authoring a note.
const SEED_GUIDE_TAG = "guide";
const SYSTEM_PATH_PREFIX = ".parachute/";

/**
 * Does the vault hold at least one note the *user* authored (or imported) —
 * i.e. a note that isn't a shipped seed guide and isn't an app-internal system
 * note? This is the honest signal behind the "write your first note" step:
 * seed guides are real notes, but they were there before the user did anything.
 * An imported note counts too (see the module docstring's `import` fold-in).
 */
export function hasUserAuthoredNote(notes: readonly Note[] | undefined): boolean {
  if (!notes) return false;
  return notes.some((n) => {
    if ((n.tags ?? []).includes(SEED_GUIDE_TAG)) return false;
    if (n.path?.startsWith(SYSTEM_PATH_PREFIX)) return false;
    return true;
  });
}

export interface StepSignals {
  /** A user-authored (non-seed, non-system) note exists. */
  hasUserNote: boolean;
}

export interface DerivedStep {
  id: HomeStepId;
  done: boolean;
}

/**
 * Fold live signals into the shelf's step shape. Today there is exactly one
 * step (`write`) — the array shape (rather than a bare boolean) is kept so
 * the shelf's "n of m" rendering and a future additional step don't need a
 * reshape, but nothing here reads from or writes to storage.
 */
export function deriveSteps(signals: StepSignals): DerivedStep[] {
  return [{ id: "write", done: signals.hasUserNote }];
}

export function stepsComplete(steps: readonly DerivedStep[]): boolean {
  return steps.length > 0 && steps.every((s) => s.done);
}
