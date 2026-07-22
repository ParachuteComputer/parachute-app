import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { displayTitle } from "@/lib/note-title";
import { relativeTime } from "@/lib/time";
import type { Note } from "@/lib/vault/types";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";

// The card face of a note (Views Wave 2b) — the board/gallery counterpart to
// NoteRow's list line. Same anatomy (pinned star · title · preview · time ·
// provenance), laid out as a bounded tile instead of a full-width row, so a
// note reads the same whichever kind renders it. Clicking opens the note.
//
// `variant`:
//   - "compact" (board lane cards) — tight, no image, 2-line preview.
//   - "gallery" (the bookshelf grid) — taller, shows a cover image when the
//     note carries one, else a text tile.

/**
 * The note's first image attachment as a directly-usable absolute URL, or
 * `null`. Deliberately conservative: only an already-absolute `http(s)` URL
 * is used (a relative vault path would need an authed blob fetch and would
 * otherwise render broken), and the list result shape usually omits
 * attachments entirely — so the gallery is text-first by construction and
 * lights up a cover only when the data unambiguously supports one.
 */
function firstImageUrl(note: Note): string | null {
  for (const att of note.attachments ?? []) {
    const url = typeof att.url === "string" ? att.url : null;
    const isImage = typeof att.mimeType === "string" && att.mimeType.startsWith("image/");
    if (isImage && url && /^https?:\/\//i.test(url)) return url;
  }
  return null;
}

export function NoteCard({
  note,
  pinnedTag,
  archivedTag,
  variant = "compact",
  overlay,
}: {
  note: Note;
  pinnedTag: string;
  archivedTag: string;
  variant?: "compact" | "gallery";
  /**
   * An optional corner control laid OVER the card, OUTSIDE its navigating
   * anchor (a button nested in an `<a>` is invalid + would double-fire the
   * navigation). Boards pass the "Move to…" menu here; list/gallery pass
   * nothing and the card renders exactly as before.
   */
  overlay?: ReactNode;
}) {
  const title = displayTitle(note);
  const stamp = note.updatedAt ?? note.createdAt;
  const isPinned = (note.tags ?? []).includes(pinnedTag);
  const isArchived = (note.tags ?? []).includes(archivedTag);
  const cover = variant === "gallery" ? firstImageUrl(note) : null;
  const [coverBroken, setCoverBroken] = useState(false);
  const showCover = cover && !coverBroken;

  const card = (
    <Link
      to={`/n/${encodeURIComponent(note.id)}`}
      className={`focus-ring card group flex flex-col overflow-hidden transition-colors hover:border-accent ${
        isArchived ? "opacity-60 italic" : ""
      }`}
    >
      {variant === "gallery" ? (
        <div className="aspect-[3/2] w-full overflow-hidden bg-bg-soft">
          {showCover ? (
            <img
              src={cover}
              alt=""
              loading="lazy"
              onError={() => setCoverBroken(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-full w-full items-end p-3 text-fg-dim"
              // A quiet text tile stands in for a cover — the note's first
              // words, so the grid still reads as distinct spines.
            >
              <span className="line-clamp-3 text-sm text-fg-muted">{note.preview ?? ""}</span>
            </div>
          )}
        </div>
      ) : null}

      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-baseline gap-1.5">
            {isPinned ? (
              <span className="shrink-0 text-accent" aria-label="pinned" title="pinned">
                ★
              </span>
            ) : null}
            <span
              className={
                title.kind === "timestamp"
                  ? "min-w-0 truncate text-sm title-timestamp"
                  : "min-w-0 truncate text-sm font-medium text-fg"
              }
            >
              {title.text}
            </span>
          </span>
          <ProvenanceBadge note={note} />
        </div>
        {note.preview && !(variant === "gallery" && !showCover) ? (
          <p className="line-clamp-2 text-xs text-fg-muted">{note.preview}</p>
        ) : null}
        <span className="mt-auto pt-1 text-[0.6875rem] tabular-nums text-fg-dim">
          {relativeTime(stamp)}
        </span>
      </div>
    </Link>
  );

  // No overlay → identical markup to before (list/gallery/every non-board card).
  if (!overlay) return card;

  return (
    <div className="relative">
      {card}
      {/* No z-index here: an equal stacking context per card would let a later
          card's overlay paint over an earlier card's open Move menu. Absolute
          positioning still paints above the static card content (.card creates
          no stacking context), and the menu/backdrop z-values resolve in the
          shared root context. */}
      <div className="absolute right-2 top-2">{overlay}</div>
    </div>
  );
}
