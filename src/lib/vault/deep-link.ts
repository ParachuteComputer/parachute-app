/**
 * Vault-scoped deep links (app#186, app#194) — `/v/<vault>/n/<note>`.
 *
 * The canonical note address is `/n/<id>`: it names a note but NOT the vault to
 * resolve it in, so a link pasted into a channel message or an agent report only
 * lands on the right note if the reader's app happens to be sitting in the right
 * vault. `/v/<vault>/n/<note>` pins the vault into the address — the app resolves
 * `<vault>` against the vaults connected on THIS device, switches to it, and then
 * hands off to the ordinary `/n/<note>` resolution.
 *
 * ## What each segment accepts
 *
 * Both segments take the same pair of forms the vault's own API does — "name or
 * id" on each side (Aaron, 2026-09-02: `/v/{vaultnameorid}/n/{notenameorid}`):
 *
 * | Segment  | Accepts |
 * |----------|---------|
 * | `<vault>` | the vault NAME (`aaron`) or its id (`box.example_vault_aaron`) — {@link resolveVaultRef} |
 * | `<note>`  | the note's ULID id (`01JB…`) or its PATH (`Projects/2026/Roadmap`) — the vault's `GET /api/notes?id=` resolves either |
 *
 * A path contains `/`, so it can arrive either percent-encoded into one segment
 * (`/n/Projects%2F2026%2FRoadmap` — what the app emits, and unambiguous) or
 * spread across segments (`/n/Projects/2026/Roadmap` — what a human writes).
 * Both land on the note; the multi-segment form is parsed by {@link parseNoteRef}.
 *
 * ## Why `/v`, not `/vault`
 *
 * `/vault/<name>/...` is already spoken for, twice over, and both claims sit
 * ABOVE this app:
 *
 *   - **Hub** (`parachute-hub/src/hub-server.ts`): `/vault`, `/vault/`,
 *     `/vault/new` 301 to `/vault/admin/`, and `/vault/<name>/*` proxies to the
 *     vault backend — dispatched long before the serve-app SPA tail.
 *   - **my. Phase A2** (URL-TOPOLOGY.md §2.3): `/vault/<name>/*` is the vault
 *     worker's data plane, zone-routed above the app worker. `App.tsx`'s
 *     router-root comment and `pwa-navigation-denylist.ts` both spell out that
 *     the prefix MAY NEVER gain a client route.
 *
 * `/v` is unclaimed on both doors: it is not in the hub's route table, not in
 * `ROOT_SERVE_RESERVED_PREFIXES` (so a serve-app hub hands `/v/...` the SPA
 * shell like any other deep link), and matches nothing in the PWA navigation
 * denylist (so the service worker serves the cached shell for it offline).
 */

import { withMount } from "@/lib/base-url";
import type { VaultRecord } from "./types";

/** The one place the `/v` prefix is spelled. */
export const VAULT_SCOPE_PREFIX = "/v";

/**
 * The in-app (router-relative, mount-stripped) path for a note pinned to a
 * vault. `suffix` carries the editor's `/edit` tail, mirroring the shape of the
 * canonical `/n/<id>` pair.
 */
export function vaultScopedNotePath(vaultName: string, noteId: string, suffix = ""): string {
  return `${VAULT_SCOPE_PREFIX}/${encodeURIComponent(vaultName)}/n/${encodeURIComponent(noteId)}${suffix}`;
}

/**
 * The absolute, shareable URL for a note — what "Copy link" writes to the
 * clipboard, and what an agent should paste into a channel message.
 *
 * Mount-aware via `withMount`: the same note is `/v/aaron/n/<id>` on the
 * root-hosted app and `/surface/parachute/v/aaron/n/<id>` under a surface
 * mount, and only the mount-prefixed form survives a paste into another tab.
 */
export function noteShareUrl(
  vaultName: string,
  noteId: string,
  origin: string = typeof window !== "undefined" && window.location ? window.location.origin : "",
): string {
  return `${origin}${withMount(vaultScopedNotePath(vaultName, noteId))}`;
}

/**
 * Resolve the `<vault>` segment of a deep link against the vaults connected on
 * this device. The segment is a vault **reference**: its NAME (`/v/aaron/...`,
 * the readable form the app emits) or its **id** (`/v/box.example_vault_aaron/...`,
 * the `vaultIdFromUrl` form — ugly, but derived from the vault URL and therefore
 * identical on every device, so it survives a local `renameVault`, app#191).
 *
 * Resolution order, most-specific first:
 *
 *   1. exact name        — the ordinary case
 *   2. exact id          — the rename-proof form
 *   3. case-folded name  — names are lowercase slugs server-side, but a link is
 *                          as likely to be hand-typed as generated ("Aaron" must
 *                          find `aaron`)
 *   4. case-folded id    — same tolerance for the id form
 *
 * A name beats an id at the same specificity: the readable form is what the app
 * emits and what a human types, so a (pathological) vault whose NAME equals
 * another vault's id resolves to the one you named. Ties WITHIN a pass are
 * broken by id order, so the answer never depends on object key insertion.
 *
 * Returns `null` for an unresolvable reference — the caller shows the "not
 * connected here" state rather than silently resolving the note in whatever
 * vault happens to be active (exactly the ambiguity this route removes).
 */
export function resolveVaultRef(
  vaults: Record<string, VaultRecord>,
  ref: string | null | undefined,
): VaultRecord | null {
  if (!ref) return null;
  const wanted = ref.trim();
  if (!wanted) return null;
  const records = Object.values(vaults).sort((a, b) => a.id.localeCompare(b.id));
  const folded = wanted.toLowerCase();
  return (
    records.find((v) => v.name === wanted) ??
    records.find((v) => v.id === wanted) ??
    records.find((v) => v.name?.toLowerCase() === folded) ??
    records.find((v) => v.id?.toLowerCase() === folded) ??
    null
  );
}

/** The editor tail a note address may carry, mirroring `/n/<id>/edit`. */
const EDIT_SUFFIX = "/edit";

/** A parsed note reference: what to resolve, and whether to open the editor. */
export interface ParsedNoteRef {
  /** The note id or path, fully decoded — hand this to `/n/<ref>`. */
  ref: string;
  /** `"/edit"` when the address named the editor, `""` otherwise. */
  suffix: string;
}

/**
 * Parse the note portion of `/v/<vault>/n/<note...>` when it arrived as a SPLAT
 * — i.e. it spans more than one URL segment, which is how a note **path** is
 * written by hand: `/v/aaron/n/Projects/2026/Roadmap`.
 *
 * Why a splat at all: a vault addresses a note by ULID id *or* by path, and a
 * path contains `/`. The app's own share links percent-encode the whole
 * reference into ONE segment (`/n/Projects%2F2026%2FRoadmap`), which the
 * `:id` route matches and is unambiguous — but a link written by a human, an
 * agent, or a shell that helpfully un-escapes `%2F` arrives split across
 * segments, and must still land on the note.
 *
 * `rest` is the raw splat (React Router has already decoded each segment and
 * turned `%2F` back into `/`, so separators and encoded slashes are level here
 * — which is fine, because the whole remainder IS the reference).
 *
 * **The `/edit` tail is claimed.** A trailing `/edit` segment opens the editor,
 * the same as `/n/<id>/edit`. That makes a note whose path literally ends in
 * `/edit` unaddressable in this multi-segment form — address it with the
 * single-segment encoded form (`/v/<vault>/n/Notes%2Fedit`), which never
 * consults this parser. The trade is deliberate: `/edit` on a shared link is
 * overwhelmingly the editor, and the escape hatch is what the app emits anyway.
 *
 * Returns `null` when there is no reference left to resolve (`/v/<vault>/n/`) —
 * the caller decides where an empty address goes.
 */
export function parseNoteRef(rest: string | null | undefined): ParsedNoteRef | null {
  if (!rest) return null;
  // A splat can arrive with leading/trailing slashes (`/v/a/n/x/`); neither is
  // part of the reference.
  const trimmed = rest.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return null;
  // `endsWith` needs a leading `/`, and the trim above removed those, so a
  // lone "edit" is a note NAMED edit — a reference, not a tail.
  if (trimmed.endsWith(EDIT_SUFFIX)) {
    return { ref: trimmed.slice(0, -EDIT_SUFFIX.length), suffix: EDIT_SUFFIX };
  }
  return { ref: trimmed, suffix: "" };
}
