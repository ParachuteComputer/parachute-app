import { CopyField, useCopyToClipboard } from "@/components/CopyField";
import { DeleteNoteButton } from "@/components/DeleteNoteButton";
import { buildWikilinkResolver } from "@/components/MarkdownView";
import { IconExpand } from "@/components/NavIcons";
import { NeighborhoodGraph } from "@/components/NeighborhoodGraph";
import { NoteRenderer } from "@/components/NoteRenderer";
import { PinArchiveButtons } from "@/components/PinArchiveButtons";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { TranscriptionStatus } from "@/components/TranscriptionStatus";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { OfflineRibbon } from "@/components/ui/OfflineRibbon";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFocusMode } from "@/lib/focus-mode";
import {
  type DisplayTitle,
  firstLineTitle,
  isRawPathOrId,
  pathDisplayTitle,
  stripFirstTitleLine,
} from "@/lib/note-title";
import { pushRecent } from "@/lib/quick-switch/recents";
import { relativeTime } from "@/lib/time";
import {
  useActiveVaultClient,
  useLiveNote,
  useNote,
  useRetryTranscription,
  useVaultStore,
} from "@/lib/vault";
import { VaultAuthError, VaultNotFoundError } from "@/lib/vault/client";
import { noteShareUrl } from "@/lib/vault/deep-link";
import { useTagRoles } from "@/lib/vault/settings";
import type { Note, NoteAttachment, NoteLink } from "@/lib/vault/types";
import { isViewNote } from "@/lib/views/schema";
import { useSync } from "@/providers/SyncProvider";
import { type SVGProps, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router";

export function NoteView() {
  // `:id` arrives ALREADY decoded (the router decodes params); a second
  // decodeURIComponent threw on ids with a literal `%` — see TagPage.tsx
  // for the full framing. Decode once, at the boundary. (app#113)
  const { id: decodedId } = useParams<{ id: string }>();
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const note = useNote(decodedId);
  // Voice Wave 1: hold ONE live subscription for the open note so a transcript
  // (or its failure/limit marker) lands without a manual refresh — the socket
  // handles the live case, `useNote`'s pending poll is the drop/reconnect net.
  useLiveNote(decodedId, note.data);

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
          <NoteBody note={note.data} cacheId={decodedId} />
        </>
      ) : note.isError ? (
        <NoteErrorBlock error={note.error} retry={() => note.refetch()} />
      ) : (
        <NotFoundBlock id={decodedId ?? ""} />
      )}
    </div>
  );
}

function NoteBody({ note, cacheId }: { note: Note; cacheId?: string }) {
  const vault = useVaultStore((s) => s.getActiveVault());
  const { roles } = useTagRoles(vault?.id ?? null);
  const retryTranscription = useRetryTranscription();
  const { mirror } = useSync();
  // Served from the durable-offline mirror while offline: mark it a saved copy.
  const savedCopy = mirror.state === "offline";
  // A body dropped by the storage-ceiling eviction (mirror-only bookkeeping): the
  // metadata + preview are here but the full text must be refetched online.
  const bodyEvicted = (note as { contentEvicted?: boolean }).contentEvicted === true;
  const resolver = useMemo(() => buildWikilinkResolver(note), [note]);
  const focusOn = useFocusMode((s) => s.on);
  const setFocusOn = useFocusMode((s) => s.setOn);

  // Escape is a safe door out HERE — unlike the editor, nothing on this
  // route consumes it first (CodeMirror binds Escape to cancel-edit; the
  // read view has no such claim on the key). POLISH-WAVE PR 4: "Doors out:
  // ⌘., Escape (when the editor doesn't consume it) […]; in the editor,
  // focus-mode exit is ⌘. only" — so this listener lives here, not in the
  // shared FocusModeMount, and NoteEditor deliberately has no equivalent.
  useEffect(() => {
    if (!focusOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusOn(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusOn, setFocusOn]);
  const label = note.path ?? note.id;
  // Title coherence: the first meaningful content line IS the title — whether
  // or not it opens with a literal `#` — matching the editor's first-line-title
  // decoration and the list's `displayTitle`. It renders in the page header and
  // is STRIPPED from the body so the note isn't headed by its own first line
  // twice. `firstLineTitle` is the shared vault-`displayTitle` derivation, so
  // read / editor / list can't drift. When content has no meaningful line
  // (empty / whitespace / frontmatter-only / transcription-placeholder-only /
  // attachment-only note), or when it repeats the note's raw path/id, there's
  // no content title: an untouched quickPath() default renders as a timestamp
  // variant (metadata voice, never a headline), else the path leaf.
  const derivedTitleText = firstLineTitle(note.content);
  const titleText =
    derivedTitleText !== null && !isRawPathOrId(derivedTitleText, note) ? derivedTitleText : null;
  const title: DisplayTitle =
    titleText !== null
      ? { kind: "title", text: titleText }
      : note.path
        ? pathDisplayTitle(note.path)
        : { kind: "title", text: note.id };
  const bodyNote = useMemo(
    () =>
      titleText !== null ? { ...note, content: stripFirstTitleLine(note.content ?? "") } : note,
    [note, titleText],
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
          {savedCopy ? <SavedCopyChip /> : null}
          {note.tags && note.tags.length > 0 ? <HeaderTags tags={note.tags} /> : null}
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
            <button
              type="button"
              onClick={() => setFocusOn(true)}
              className="btn btn-ghost btn-touch"
              title="Focus (⌘.)"
            >
              <IconExpand width={16} height={16} />
              Focus
            </button>
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
          <HeaderPath value={label} isPath={!!note.path} />
        </header>

        <TranscriptionStatus
          content={note.content ?? ""}
          attachments={note.attachments}
          onRetry={() =>
            retryTranscription.mutate({ cacheId: cacheId ?? note.id, serverId: note.id })
          }
          retrying={retryTranscription.isPending}
        />

        {bodyEvicted ? (
          // The full body was dropped to keep the offline mirror under its
          // storage ceiling — the note stays listed + titled, but the text
          // needs a fetch. Show the retained preview (if any) above the prompt.
          <EvictedNoteBody preview={note.preview} />
        ) : bodyNote.content?.trim() ? (
          <NoteRenderer note={bodyNote} resolve={resolver} />
        ) : titleText === null ? (
          // Genuinely empty (no content line at all): a quiet prompt. When the
          // note's only line became the title, `titleText` is non-null and we
          // render nothing here — the "Nothing here yet" prompt would misread a
          // titled one-line note as empty.
          <EmptyNoteBody noteId={note.id} />
        ) : null}

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
        {note.path ? (
          // Path is plumbing, but on a note it stays grabbable (ratified
          // 2026-07-17) — it's how you reference a note to an AI agent.
          <Row
            label="Path"
            value={<CopyField value={note.path} label="note path" className="mt-1" />}
          />
        ) : null}
        {metaEntries.map(([key, value]) => (
          <Row
            key={key}
            label={key}
            value={<span className="break-all text-fg-muted">{String(value)}</span>}
          />
        ))}
      </dl>
      <CopyLinkButton noteId={note.id} />
      {note.path ? <CopyReferenceButton path={note.path} /> : null}
      <ProvenanceBadge note={note} variant="detail" className="mt-3" />
    </section>
  );
}

// "Copy link" — the shareable ADDRESS of this note, as opposed to the
// "Copy reference" button below it, which copies the note's vault-internal path
// for handing to an AI agent. app#186: the copied URL is the VAULT-SCOPED form
// (`/v/<vault>/n/<id>`), never the bare `/n/<id>` — a link that travels out of
// this app into a channel message or a report has to say which vault to resolve
// the note in, or it only works for a reader who happens to be sitting in the
// same vault. In-app navigation (every `<Link to="/n/…">` in this codebase)
// deliberately keeps the short current-vault form: it's already in a vault
// context, and pinning the name into every internal href would just make the
// history stack noisier without pinning anything that could drift.
//
// Rendered only with an active vault (the whole route is guarded on one), so
// the vault's name is always available to scope with.
function CopyLinkButton({ noteId }: { noteId: string }) {
  const vault = useVaultStore((s) => s.getActiveVault());
  const { copied, copy } = useCopyToClipboard();
  if (!vault?.name) return null;

  return (
    <button
      type="button"
      onClick={() => copy(noteShareUrl(vault.name, noteId))}
      className="btn btn-secondary btn-touch mt-3 w-full"
      aria-label="Copy a shareable link to this note"
    >
      {copied ? "Copied ✓" : "Copy link"}
    </button>
  );
}

// A second, more prominent door onto the same value as the Path row's copy
// button — "reference this note to an AI agent" is the explicit use case
// (ratified 2026-07-17), so it earns its own labeled affordance rather than
// relying on the operator to notice the small copy icon in the metadata
// list. Shares CopyField's clipboard-API + toast + transient-label logic via
// `useCopyToClipboard` (review fold #49) rather than re-deriving it inline.
function CopyReferenceButton({ path }: { path: string }) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <button
      type="button"
      onClick={() => copy(path)}
      className="btn btn-secondary btn-touch mt-3 w-full"
      aria-label="Copy reference to this note"
    >
      {copied ? "Copied ✓" : "Copy reference"}
    </button>
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
  // Compact, quieter chips (0.20.14): normal weight and tighter spacing so the
  // tag row reads as a light label strip under the title rather than a second
  // headline — reweight only, every chip links to the tag's own page.
  return (
    <div className="mt-2 flex flex-wrap gap-1" aria-label="Tags">
      {tags.map((t) => (
        <Link
          key={t}
          to={`/tags/${encodeURIComponent(t)}`}
          className="chip chip-tag focus-ring max-w-full break-all"
        >
          #{t}
        </Link>
      ))}
    </div>
  );
}

// A clipboard glyph in the shared 24-grid / 1.75-stroke line style (NavIcons),
// rendered small — the visual cue that the muted path line is tap-to-copy.
function CopyGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </svg>
  );
}

// The path used to be a prominent mono line high in the header; it's now a
// quiet, truncating meta line at the foot of it — we're deliberately not
// orienting people toward editing paths (ratified 2026-07-17), so it fades
// into the background and the vertical space goes to content. One tap still
// copies it, though: handing a note's path to an AI agent is the explicit use
// case, so the whole line is a copy button (toast + transient label via the
// same useCopyToClipboard the metadata card's copy affordances use). Distinct
// aria-label from the metadata card's "Copy note path" so both remain
// unambiguous to a screen reader.
function HeaderPath({ value, isPath }: { value: string; isPath: boolean }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      aria-label={isPath ? "Copy path" : "Copy note id"}
      className="focus-ring group mt-4 flex max-w-full items-center gap-1.5 rounded text-fg-dim transition-colors hover:text-fg-muted"
    >
      <CopyGlyph className="shrink-0 opacity-70 transition-opacity group-hover:opacity-100" />
      <span className="min-w-0 truncate font-mono text-xs">{value}</span>
      {copied ? <span className="shrink-0 text-xs text-fg-muted">Copied</span> : null}
    </button>
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
  const filename = attachment.filename;

  if (!filename || !attachment.url) {
    return (
      <figure className="card shadow-soft p-3">
        <AttachmentProcessing />
      </figure>
    );
  }

  const mime = (attachment.mimeType ?? "").toLowerCase();

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

function AttachmentProcessing() {
  return (
    <div className="flex items-center gap-2 text-sm text-fg-dim" aria-busy="true">
      <Skeleton className="h-4 w-32" />
      <span>Processing…</span>
    </div>
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
    return <AttachmentProcessing />;
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

// A subtle marker under the title when the note is served from the durable-
// offline mirror while offline — "you're reading the saved copy," not a live
// read. COPY IS A DRAFT pending Aaron's sign-off.
function SavedCopyChip() {
  return (
    <p className="mt-2">
      <span className="chip bg-bg-soft text-fg-muted" title="Served from your offline copy">
        Saved copy
      </span>
    </p>
  );
}

// Shown in place of the body when the note's full text was evicted from the
// offline mirror to stay under its storage ceiling. The preview (kept on the
// row) gives context; the line invites a reconnect to load the rest. COPY IS A
// DRAFT pending Aaron's sign-off.
function EvictedNoteBody({ preview }: { preview?: string }) {
  return (
    <div className="my-8">
      {preview ? <p className="mb-4 text-fg-muted">{preview}</p> : null}
      <p className="font-serif text-lg italic text-fg-muted">Connect to load this note.</p>
    </div>
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
