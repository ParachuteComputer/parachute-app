import { useActiveVaultClient } from "@/lib/vault/queries";
import { type NoteMediaKind, noteMediaKind, pageHref } from "@/lib/vault/storage-url";
import { useEffect, useState } from "react";

/**
 * How a note's image is drawn. A note never makes the reader's device load
 * anything from outside the vault (a tracker pixel would learn the note was
 * opened, when and from where):
 *
 * - this vault's storage → fetched through the vault client (bearer, refresh),
 *   shown from an object URL;
 * - inline `data:image/…` or `blob:` → shown as is (no request);
 * - any other http(s) URL → a plain link (alt text or the address), new tab,
 *   no referrer, never loaded;
 * - anything else → words.
 *
 * The same rules as surface-render's `VaultImage` after parachute-surface#246,
 * applied here because the app pins surface-render 0.3.1, which still loads
 * remote images. Drop this override once the app is on a surface-render that
 * ships #246 and passes it `vaultUrl`.
 */
export function NoteImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const { kind, url, error } = useNoteMediaUrl(src);
  if (kind === "remote") {
    return (
      <a
        className="vault-media-remote"
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        title={src}
      >
        {alt || src}
      </a>
    );
  }
  if (kind === "blocked") {
    return <span className="vault-media-blocked">{alt ? `[${alt}]` : "[image]"}</span>;
  }
  if (error) {
    return (
      <span className="vault-media-error" role="img" aria-label={alt || "image failed to load"}>
        [{alt || "image"}: {error}]
      </span>
    );
  }
  if (!url) {
    return (
      <span
        className={`vault-media-loading ${className ?? ""}`.trim()}
        aria-busy="true"
        aria-label={alt || "loading image"}
      />
    );
  }
  return <img src={url} alt={alt ?? ""} className={className} />;
}

/**
 * Classify a note's media `src` and, for this vault's storage, fetch it through
 * the active vault client into an object URL (revoked on change/unmount).
 * `url` is the address safe to put in `src`: the object URL, the inline src, or
 * null (remote, blocked, still loading, or failed).
 */
export function useNoteMediaUrl(src: string | null): {
  kind: NoteMediaKind;
  url: string | null;
  error: string | null;
} {
  const client = useActiveVaultClient();
  const kind: NoteMediaKind = src
    ? noteMediaKind(src, client?.vaultBaseUrl ?? null, pageHref())
    : "blocked";
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBlobUrl(null);
    setError(null);
    if (kind !== "storage" || !client || !src) return;
    let cancelled = false;
    let created: string | null = null;
    client
      .fetchAttachmentBlob(src)
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setBlobUrl(created);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "failed to load");
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [kind, client, src]);

  if (kind === "inline") return { kind, url: src, error: null };
  if (kind === "storage") return { kind, url: blobUrl, error };
  return { kind, url: null, error: null };
}
