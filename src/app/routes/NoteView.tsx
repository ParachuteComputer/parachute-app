import { DeleteNoteButton } from "@/components/DeleteNoteButton";
import { buildWikilinkResolver } from "@/components/MarkdownView";
import { NeighborhoodGraph } from "@/components/NeighborhoodGraph";
import { NoteRenderer } from "@/components/NoteRenderer";
import { PinArchiveButtons } from "@/components/PinArchiveButtons";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { TranscriptionStatus } from "@/components/TranscriptionStatus";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { OfflineRibbon } from "@/components/ui/OfflineRibbon";
import { Skeleton } from "@/components/ui/Skeleton";
import { leadingH1, pathDisplayTitle, stripLeadingH1 } from "@/lib/note-title";
import { pushRecent } from "@/lib/quick-switch/recents";
import { relativeTime } from "@/lib/time";
import { useActiveVaultClient, useNote, useVaultStore } from "@/lib/vault";
import { VaultAuthError, VaultNotFoundError } from "@/lib/vault/client";
import { useTagRoles } from "@/lib/vault/settings";
import type { Note, NoteAttachment, NoteLink } from "@/lib/vault/types";
import { isViewNote } from "@/lib/views/schema";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router";

export function NoteView() {
  const { id } = useParams<{ id: string }>();
  const decodedId = id ? decodeURIComponent(id) : undefined;
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const note = useNote(decodedId);

  useEffect(() => {
    if (activeVault && decodedId) pushRecent(activeVault.id, decodedId);
  }, [activeVault, decodedId]);

  // NAVIGATION.md: route guard, no active vault — replace.
  if (!activeVault) return <Navigate to="/" replace />;

  return (
    <div className="page">
      <nav className="mb-6 text-sm text-fg-dim">
        <Link to="/notes" className="focus-ring hover:text-accent">
          ← All notes
        </Link>
      </nav>

      {note.isPending ? (
        <NoteSkeleton />
      ) : note.data ? (
        // Data present wins over an error: a failed background refetch (e.g.
        // going offline mid-read) must not blank the note you're reading — we
        // keep the saved copy on screen under a small offline ribbon.
        <>
          {note.isError ? <OfflineRibbon /> : null}
          <NoteBody note={note.data} />
        </>
      ) : note.isError ? (
        <NoteErrorBlock error={note.error} retry={() => note.refetch()} />
      ) : (
        <NotFoundBlock id={decodedId ?? ""} />
      )}
    </div>
  );
}

function NoteBody({ note }: { note: Note }) {
  const vault = useVaultStore((s) => s.getActiveVault());
  const { roles } = useTagRoles(vault?.id ?? null);
  const resolver = useMemo(() => buildWikilinkResolver(note), [note]);
  const label = note.path ?? note.id;
  // Human title: the content's leading H1 when it has one, else the path
  // leaf — an untouched quickPath() default becomes a timestamp variant
  // (metadata voice, never a headline) rather than the raw "22-10-48" leaf.
  // When the H1 becomes the page title we strip it from the rendered body so
  // the note isn't headed by its own title twice. Deliberately not
  // `noteTitle()`'s first-line fallback: an untitled first line would stay
  // unstripped in the body below it, so titling by it here would duplicate
  // that line on screen.
  const h1 = leadingH1(note.content);
  const title = h1
    ? { kind: "title" as const, text: h1 }
    : note.path
      ? pathDisplayTitle(note.path)
      : { kind: "title" as const, text: note.id };
  const bodyNote = useMemo(
    () => (h1 ? { ...note, content: stripLeadingH1(note.content ?? "") } : note),
    [note, h1],
  );
  const summary = typeof note.metadata?.summary === "string" ? note.metadata.summary : null;
  const inbound = useMemo(
    () =>
      (note.links ?? []).filter(
        (l) => l.targetId === note.id && l.sourceId !== note.id && l.sourceNote,
      ),
    [note],
  );
  const outbound = useMemo(() => {
    const seen = new Set<string>();
    const out: NoteLink[] = [];
    for (const l of note.links ?? []) {
      if (l.sourceId !== note.id || l.targetId === note.id) continue;
      if (!l.targetNote) continue;
      if (seen.has(l.targetId)) continue;
      seen.add(l.targetId);
      out.push(l);
    }
    return out;
  }, [note]);

  return (
    <article className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <header className="mb-8 border-b border-border pb-5">
          <h1 className={title.kind === "timestamp" ? "page-title title-timestamp" : "page-title"}>
            {title.text}
          </h1>
          {note.tags && note.tags.length > 0 ? <HeaderTags tags={note.tags} /> : null}
          <p className="note-id mt-2">{label}</p>
          {summary ? <p className="mt-3 text-fg-muted">{summary}</p> : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              to={`/n/${encodeURIComponent(note.id)}/edit`}
              className="btn btn-secondary btn-touch"
            >
              Edit
            </Link>
            <PinArchiveButtons note={note} keyboard />
            <DeleteNoteButton note={note} />
            {isViewNote(note, roles.view) ? (
              // The note-editor's half of the §2 bridge — a `#view`-tagged
              // note opens as a view; ViewSurface's "Edit view note" is the
              // trip back. Two faces, one note.
              <Link
                to={`/views/${encodeURIComponent(note.id)}`}
                className="btn btn-secondary btn-touch"
              >
                Open as view
              </Link>
            ) : null}
          </div>
        </header>

        <TranscriptionStatus content={note.content ?? ""} />

        {bodyNote.content?.trim() ? (
          <NoteRenderer note={bodyNote} resolve={resolver} />
        ) : (
          <EmptyNoteBody noteId={note.id} />
        )}

        {note.attachments && note.attachments.length > 0 ? (
          <section className="mt-10 border-t border-border pt-6">
            <h2 className="mb-3 font-serif text-xl">Attachments</h2>
            <div className="space-y-6">
              {note.attachments.map((a) => (
                <AttachmentView key={a.id} attachment={a} />
              ))}
            </div>
          </section>
        ) : null}

        <NeighborhoodGraph anchor={note} />
      </div>

      <aside className="space-y-6 text-sm lg:sticky lg:top-24 lg:self-start">
        <MetadataPanel note={note} />
        {outbound.length > 0 ? (
          <LinksPanel title="Outbound" links={outbound} peer="target" />
        ) : null}
        {inbound.length > 0 ? <LinksPanel title="Inbound" links={inbound} peer="source" /> : null}
      </aside>
    </article>
  );
}

function MetadataPanel({ note }: { note: Note }) {
  const created = note.createdAt;
  const updated = note.updatedAt;
  const metaEntries = Object.entries(note.metadata ?? {}).filter(([key]) => key !== "summary");

  return (
    <section className="card shadow-soft p-4">
      <h2 className="eyebrow mb-2">Metadata</h2>
      <dl className="space-y-1.5 text-sm">
        {note.path ? (
          <Row
            label="Title"
            value={<span className="font-mono text-xs break-all">{note.path}</span>}
          />
        ) : null}
        <Row label="ID" value={<span className="font-mono text-xs break-all">{note.id}</span>} />
        <Row label="Created" value={<time title={created}>{relativeTime(created)}</time>} />
        {updated ? (
          <Row label="Updated" value={<time title={updated}>{relativeTime(updated)}</time>} />
        ) : null}
        {metaEntries.map(([key, value]) => (
          <Row
            key={key}
            label={key}
            value={<span className="break-all text-fg-muted">{String(value)}</span>}
          />
        ))}
      </dl>
      <ProvenanceBadge note={note} variant="detail" className="mt-3" />
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="eyebrow">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function HeaderTags({ tags }: { tags: string[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Tags">
      {tags.map((t) => (
        <Link
          key={t}
          to={`/notes?tag=${encodeURIComponent(t)}`}
          className="chip chip-tag focus-ring max-w-full break-all font-medium"
        >
          #{t}
        </Link>
      ))}
    </div>
  );
}

function LinksPanel({
  title,
  links,
  peer,
}: {
  title: string;
  links: NoteLink[];
  peer: "source" | "target";
}) {
  return (
    <section className="card shadow-soft p-4">
      <h2 className="eyebrow mb-2 tabular-nums">
        {title} ({links.length})
      </h2>
      <ul className="space-y-1.5">
        {links.map((l) => {
          const peerNote = peer === "source" ? l.sourceNote : l.targetNote;
          if (!peerNote) return null;
          const label = peerNote.path ?? peerNote.id;
          const summary =
            typeof peerNote.metadata?.summary === "string" ? peerNote.metadata.summary : null;
          return (
            <li key={`${l.sourceId}->${l.targetId}:${l.relationship}`}>
              <Link
                to={`/n/${encodeURIComponent(peerNote.id)}`}
                className="block rounded px-1 py-0.5 hover:bg-bg/50"
              >
                <div className="truncate font-mono text-xs text-fg-muted hover:text-accent">
                  {label}
                </div>
                {summary ? (
                  <div className="mt-0.5 line-clamp-2 text-xs text-fg-dim">{summary}</div>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AttachmentView({ attachment }: { attachment: NoteAttachment }) {
  const mime = (attachment.mimeType ?? "").toLowerCase();
  const filename = attachment.filename ?? attachment.id;

  return (
    <figure className="card shadow-soft p-3">
      <figcaption className="mb-2 flex items-baseline justify-between gap-3">
        <span className="truncate font-mono text-xs text-fg-muted">{filename}</span>
        {typeof attachment.size === "number" ? (
          <span className="shrink-0 text-xs text-fg-dim">{formatBytes(attachment.size)}</span>
        ) : null}
      </figcaption>
      <AttachmentBody attachment={attachment} mime={mime} filename={filename} />
    </figure>
  );
}

function AttachmentBody({
  attachment,
  mime,
  filename,
}: {
  attachment: NoteAttachment;
  mime: string;
  filename: string;
}) {
  const client = useActiveVaultClient();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const kind = attachmentKind(mime, filename);
  const needsBlob = kind !== "other";
  const src = attachment.url;

  useEffect(() => {
    if (!needsBlob || !src || !client) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setError(null);
    client
      .fetchAttachmentBlob(src)
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load attachment");
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [needsBlob, src, client]);

  if (!src) {
    return <p className="text-sm text-fg-dim">(no URL)</p>;
  }
  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (needsBlob && !blobUrl) {
    return <Skeleton className="h-32 w-full" />;
  }

  const displayUrl = blobUrl ?? src;
  if (kind === "image") {
    return <img src={displayUrl} alt={filename} className="max-h-[32rem] rounded" />;
  }
  if (kind === "audio") {
    // biome-ignore lint/a11y/useMediaCaption: vault attachments don't carry caption tracks
    return <audio controls src={displayUrl} className="w-full" />;
  }
  if (kind === "video") {
    // biome-ignore lint/a11y/useMediaCaption: vault attachments don't carry caption tracks
    return <video controls src={displayUrl} className="w-full rounded" />;
  }
  if (kind === "pdf") {
    return (
      <>
        <iframe
          src={displayUrl}
          title={filename}
          className="h-[40rem] w-full rounded border border-border"
        />
        <a
          href={displayUrl}
          download={filename}
          className="mt-2 inline-block text-sm text-accent hover:underline"
        >
          Download {filename}
        </a>
      </>
    );
  }
  return (
    <a href={displayUrl} download={filename} className="text-sm text-accent hover:underline">
      Download {filename}
    </a>
  );
}

function attachmentKind(
  mime: string,
  filename: string,
): "image" | "audio" | "video" | "pdf" | "other" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "audio";
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  if (ext === "pdf") return "pdf";
  return "other";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function NoteSkeleton() {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]" aria-busy="true">
      <div className="min-w-0 space-y-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <div className="mt-6 space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-3" width={`${70 + ((i * 13) % 25)}%`} />
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}

// Blank whitespace where the body should be reads identically to a failed
// load — nothing distinguishes "this note is genuinely empty" from "the
// content silently didn't arrive." A quiet placeholder + an Edit invitation
// closes that gap.
function EmptyNoteBody({ noteId }: { noteId: string }) {
  // Serif + italic + fg-muted — the same quiet-aside voice `.prose-note
  // blockquote` already carries, at the prose reading size. A quiet moment
  // should still feel warm, not read as small gray system chrome.
  return (
    <p className="my-8 font-serif text-lg italic text-fg-muted">
      Nothing here yet.{" "}
      <Link
        to={`/n/${encodeURIComponent(noteId)}/edit`}
        className="not-italic text-accent hover:underline"
      >
        Start writing →
      </Link>
    </p>
  );
}

function NotFoundBlock({ id }: { id: string }) {
  return (
    <EmptyState
      title={<span className="font-serif text-xl text-fg">Note not found</span>}
      description={
        <>
          No note with id <span className="font-mono">{id}</span> in this vault.
        </>
      }
      action={
        <Link to="/notes" className="text-sm text-accent hover:underline">
          Back to all notes
        </Link>
      }
    />
  );
}

// The vault client's thrown errors carry the raw request line as their
// `.message` (e.g. "GET /api/notes?id=…&include_content=true → 404") —
// useful for debugging, not for a reader. Human copy up front; the wire
// detail moves into a collapsed <details> (word-broken so a long query
// string can never clip un-scrollable on a narrow phone, UI audit HIGH).
function NoteErrorBlock({ error, retry }: { error: Error; retry: () => void }) {
  const isAuth = error instanceof VaultAuthError;
  const isNotFound = error instanceof VaultNotFoundError;
  const title = isAuth ? "Session expired" : isNotFound ? "Note not found" : "Could not load note";
  const message = isAuth
    ? error.message
    : isNotFound
      ? "Couldn't find this note. It may have been deleted, or the link may be wrong."
      : "Something went wrong loading this note. You can try again, or head back to your notes.";

  return (
    <ErrorState
      title={title}
      message={
        <>
          {message}
          {!isAuth ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-fg-dim hover:text-fg-muted">
                Technical detail
              </summary>
              <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-fg-dim">
                {error.message}
              </p>
            </details>
          ) : null}
        </>
      }
      retry={isAuth ? undefined : retry}
      action={
        isAuth ? (
          <Link to="/add" className="btn btn-primary">
            Reconnect vault
          </Link>
        ) : (
          <Link to="/notes" className="btn btn-secondary btn-touch">
            Back to notes
          </Link>
        )
      }
    />
  );
}
