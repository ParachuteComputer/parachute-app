/**
 * URL helpers — re-exports from `@openparachute/surface-client` plus Notes'
 * legacy-vault-URL guard.
 *
 * Phase 2 of the notes-migration-to-app arc (parachute-app#6, design doc
 * section 16) moved `vaultIdFromUrl` + `normalizeVaultUrl` into
 * app-client so other hosted apps share the URL-drift fix from
 * notes#149. `isLegacyVaultUrl` stays Notes-side — it's a one-off
 * migration helper for VaultRecords that pre-date vault PR 7's
 * `/vaults/` → `/vault/` rename.
 */

export { normalizeVaultUrl, vaultIdFromUrl } from "@openparachute/surface-client";
export { isLegacyVaultUrl } from "./types";

/**
 * Sanitize a caller-supplied post-connect redirect target (the `redirect`
 * search param the hub `/account` deep-link rides through `/add`, notes#63).
 *
 * Only an in-app, same-origin path is allowed — react-router `navigate()`
 * treats its argument as an internal location, so a value like
 * `https://evil.example` or an authority-relative form must never round-trip
 * into it. We reject ASCII control characters (tab, CR, LF included) FIRST —
 * a WHATWG `URL` parser strips them, so `/\t/evil.com` reads as a safe
 * in-app path here but resolves to `https://evil.com/` once something
 * downstream parses it as a URL. We require a single leading slash and
 * reject the two authority-relative prefixes the WHATWG URL parser treats as
 * the start of a host: `//` (protocol-relative) AND `/\` — browsers
 * normalize a backslash to a forward slash, so `new URL('/\\evil.com',
 * base)` resolves to `http://evil.com/`. We also reject anything that
 * otherwise parses as an absolute URL (has a scheme). Returns `undefined`
 * for anything that doesn't pass, so callers fall back to the default
 * landing (`/`).
 */
export function safeInternalRedirect(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the whole point is to catch them.
  if (/[\x00-\x1f\x7f]/.test(raw)) return undefined;
  // Must be an app-internal absolute path: one leading slash, not an
  // authority-relative form. `//host` (protocol-relative) and `/\host` (the
  // backslash is normalized to `/`, so it's also read as an authority start)
  // both navigate off-origin.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return undefined;
  // Reject anything the URL parser accepts as absolute (has a scheme).
  try {
    // A relative path throws here; an absolute URL (with scheme) parses.
    new URL(raw);
    return undefined;
  } catch {
    return raw;
  }
}

/**
 * Carry the address a reader was actually trying to reach into a connect-flow
 * entry point, so signing in returns them THERE instead of the default landing.
 *
 * The return channel already exists end to end: `?redirect=` is read at `/add`
 * (`AddVault`), rides the OAuth pending state through sessionStorage
 * (`beginOAuth`'s `redirect` option), and is spent by `OAuthCallback`, which
 * re-sanitizes before it navigates. What was missing is the FIRST hop — a
 * logged-out `/n/<id>` bounced to `/` and dropped the id on the floor. This is
 * the one place that param is written, so every guard that turns a deep link
 * away spells it the same way.
 *
 * `path` is sanitized here with the same {@link safeInternalRedirect} the
 * consumers use, so an unusable target is DROPPED and `base` comes back
 * unchanged — a bad address degrades to the old behaviour (land on `base`)
 * rather than becoming an open redirect. `base` may already carry a query.
 */
export function withReturnTo(base: string, path: string | null | undefined): string {
  const target = safeInternalRedirect(path);
  if (!target) return base;
  return `${base}${base.includes("?") ? "&" : "?"}redirect=${encodeURIComponent(target)}`;
}
