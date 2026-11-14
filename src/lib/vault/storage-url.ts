/**
 * The one check for "is this URL a file in this vault's storage?" — the gate
 * in front of every request that carries the vault bearer for a URL a note
 * supplied (`VaultClient.fetchAttachmentBlob`), and in front of every image the
 * app draws from a note (`NoteImage`, the gallery card cover).
 *
 * A note's markdown and its attachment rows are writer-controlled: an import,
 * a shared vault or an agent can plant any URL. So the URL is resolved ONCE,
 * the resolved URL is checked, and the caller fetches exactly that `URL`, never
 * the raw string (`https:evil.example/x` is relative to an https base in a
 * browser and absolute to other fetchers). The rules mirror
 * parachute-surface#246 and are tighter by one step: the path must sit under
 * `<vault>/api/storage/`, not just inside the vault, since storage is the only
 * thing a note's media can name. Refused:
 *
 * - another origin, or userinfo (`https://hub@evil/…`, `https://u:p@hub/…`);
 * - another vault or app on the same hub, or a vault path outside storage;
 * - a backslash, a C0 control character or DEL anywhere in the input (browsers
 *   fold `/\host` and `/<TAB>/host` into `//host`);
 * - in the storage path that will be fetched: an encoded `/` or `\` (`%2f`,
 *   `%5c`, which both doors decode into a separator), or after the doors' one
 *   decode a `.`/`..` segment (both answer it with 403, which the blob loop would
 *   read as a revoked token), a backslash or a control character;
 * - anything not http(s): `javascript:`, `data:`, `blob:` (callers that show
 *   inline `data:`/`blob:` images do so without a request).
 *
 * `vaultUrl` may be absolute, root-relative or empty (a vault served at the
 * app's own origin); it resolves against `here` (the page) as a directory.
 */
export function vaultStorageTarget(vaultUrl: string, url: string, here?: string): URL | null {
  // Browsers fold `/\host` and `/<TAB>/host` into `//host`; neither belongs in a real URL here.
  if (url.includes("\\") || hasControlChar(url)) return null;
  // The vault as a directory, from its parsed origin + path (a stray `?`/`#` in
  // the stored vault URL can't bend the storage prefix).
  const parsed = parseHttpUrl(`${vaultUrl.replace(/\/+$/, "")}/`, here);
  if (!parsed) return null;
  const vault = new URL(`${parsed.origin}${parsed.pathname.replace(/\/*$/, "/")}`);
  const base = vault.href.slice(0, -1);
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//");
  const raw = absolute ? url : `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  const target = parseHttpUrl(raw, here ?? vault.href);
  if (!target) return null;
  const storagePath = `${vault.pathname}api/storage/`;
  if (
    target.origin !== vault.origin ||
    target.username !== "" ||
    target.password !== "" ||
    !target.pathname.startsWith(storagePath)
  ) {
    return null;
  }
  const rest = target.pathname.slice(storagePath.length);
  if (rest === "" || unsafeStorageRest(rest)) return null;
  return target;
}

/** The page's own URL, when there is one (a browser); a base for relative vault URLs. */
export function pageHref(): string | undefined {
  return (globalThis as { location?: { href?: string } }).location?.href;
}

/** What a note's image `src` is, for deciding how to draw it without leaking a request. */
export type NoteMediaKind = "storage" | "inline" | "remote" | "blocked";

/** Inline image data a browser shows with no request. `svg+xml` stays out. */
const INLINE_IMAGE = /^data:image\/(png|jpeg|gif|webp|avif)[;,]/i;

export function noteMediaKind(src: string, vaultUrl: string | null, here?: string): NoteMediaKind {
  if (vaultUrl !== null && vaultStorageTarget(vaultUrl, src, here)) return "storage";
  if (INLINE_IMAGE.test(src) || src.startsWith("blob:")) return "inline";
  // A remote link is never loaded, so an encoded slash is fine here (image
  // proxies and bucket URLs carry them); a backslash or control character isn't.
  if (/^https?:\/\//i.test(src) && !src.includes("\\") && !hasControlChar(src)) {
    if (parseHttpUrl(src)) return "remote";
  }
  return "blocked";
}

function hasControlChar(url: string): boolean {
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function parseHttpUrl(url: string, base?: string): URL | null {
  try {
    const u = new URL(url, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * True if the storage path (what follows `<vault>/api/storage/` in the URL that
 * will be fetched) is unsafe once decoded the way the doors decode it: an
 * encoded `/` or `\` (a separator after decoding), a `.`/`..` segment (both
 * doors answer 403, which the blob loop would read as a revoked token), a
 * backslash or control character, or a malformed escape.
 */
function unsafeStorageRest(rest: string): boolean {
  if (/%2f|%5c/i.test(rest)) return true;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return true;
  }
  if (decoded.includes("\\") || hasControlChar(decoded)) return true;
  return decoded.split("/").some((seg) => seg === ".." || seg === ".");
}
