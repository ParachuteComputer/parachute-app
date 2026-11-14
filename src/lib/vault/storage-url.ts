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
 * - a backslash, a C0 control character or DEL anywhere (browsers fold `/\host`
 *   and `/<TAB>/host` into `//host`), or an encoded `/` or `\` (`%2f`, `%5c`),
 *   which both doors decode into a separator;
 * - a `.` or `..` segment after the doors' one decode (both answer it with 403,
 *   which the blob loop would read as a revoked token);
 * - anything not http(s): `javascript:`, `data:`, `blob:` (callers that show
 *   inline `data:`/`blob:` images do so without a request).
 *
 * `vaultUrl` may be absolute, root-relative or empty (a vault served at the
 * app's own origin); it resolves against `here` (the page) as a directory.
 */
export function vaultStorageTarget(vaultUrl: string, url: string, here?: string): URL | null {
  if (unsafeChars(url)) return null;
  const base = vaultUrl.replace(/\/+$/, "");
  const vault = parseHttpUrl(`${base}/`, here);
  if (!vault) return null;
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
  if (rest === "" || hasDotSegment(rest)) return null;
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
  if (/^https?:\/\//i.test(src) && !unsafeChars(src)) return "remote";
  return "blocked";
}

function unsafeChars(url: string): boolean {
  if (url.includes("\\") || /%2f|%5c/i.test(url)) return true;
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

/** True if `path`, decoded once the way the doors decode it, has a `.`/`..` segment (or can't be decoded). */
function hasDotSegment(path: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return true;
  }
  return decoded.split("/").some((seg) => seg === ".." || seg === ".");
}
