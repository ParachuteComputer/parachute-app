/**
 * Vault-scoped deep links (app#186) — `/v/<vault>/n/<id>`.
 *
 * The canonical note address is `/n/<id>`: it names a note but NOT the vault to
 * resolve it in, so a link pasted into a channel message or an agent report only
 * lands on the right note if the reader's app happens to be sitting in the right
 * vault. `/v/<vault>/n/<id>` pins the vault into the address — the app resolves
 * `<vault>` against the vaults connected on THIS device, switches to it, and then
 * hands off to the ordinary `/n/<id>` resolution.
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
 * Resolve a vault NAME (as it appears in a deep link) against the vaults
 * connected on this device.
 *
 * Exact match wins. Failing that we fall back to a case-insensitive match:
 * Parachute vault names are lowercase slugs server-side, but a `VaultRecord`'s
 * `name` is locally editable (`renameVault`) and a link is just as likely to be
 * hand-typed as generated, so "Aaron" must still find `aaron`. Ties under the
 * case-insensitive pass are broken by id order so the result is deterministic
 * rather than dependent on object key insertion.
 *
 * Returns `null` for an unknown name — the caller shows the "not connected
 * here" state rather than silently resolving the note in whatever vault
 * happens to be active (which is exactly the ambiguity this route exists to
 * remove).
 */
export function findVaultByName(
  vaults: Record<string, VaultRecord>,
  name: string | null | undefined,
): VaultRecord | null {
  if (!name) return null;
  const wanted = name.trim();
  if (!wanted) return null;
  const records = Object.values(vaults).sort((a, b) => a.id.localeCompare(b.id));
  const exact = records.find((v) => v.name === wanted);
  if (exact) return exact;
  const folded = wanted.toLowerCase();
  return records.find((v) => v.name?.toLowerCase() === folded) ?? null;
}

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
