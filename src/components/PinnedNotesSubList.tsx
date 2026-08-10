import { displayTitle } from "@/lib/note-title";
import { DEFAULT_NOTE_QUERY, useNotes, useTagRoles, useVaultStore } from "@/lib/vault";
import { useMemo } from "react";
import { Link } from "react-router";

// The pinned-note sub-list that hangs under the Pinned nav row (app#131),
// shared by the projections that have room for it: the desktop Rail and the
// tablet NavDrawer, plus the phone NavSheet — #131 landed the rail's copy and
// deliberately deferred the other projections to this, the tablet-sidebar
// work.
//
// Deliberately NOT part of `useNavBands()`. The nav model is the ROOM list —
// one derivation, one fetch, every projection reads it (app#110 Finding A) —
// and pinned notes are CONTENT under a room, not rooms. Folding them in would
// give the single-fetch derivation a second, unrelated payload on every
// surface that renders nav, including the ones (BottomTabBar, LensStrip) that
// have nowhere to put it. Keeping it a component means only the projections
// that render it pay for it, and react-query dedupes the ones that do: the
// three projections share ONE cache key, so the two that are `display: none`
// in the current band cost a subscriber, not a fetch.
//
// What the two variants are for: the rail is a MOUSE surface (`text-xs`,
// tight rows), the drawer and the sheet are THUMB surfaces (`min-h-11` = the
// 44px floor every other row in those two honours). Same data, same order,
// same hrefs — only the row scale differs, which is the same split the
// projections already make for the nav rows themselves.

export type PinnedNotesVariant = "rail" | "touch";

export interface PinnedNotesSubListProps {
  variant: PinnedNotesVariant;
  /** Docked projections close on navigate — the drawer hands its `close` in. */
  onNavigate?: () => void;
}

/**
 * True when this item is the row the sub-list hangs under. The trigger lives
 * here rather than in each projection so all three agree on WHERE the list
 * goes, not just what is in it.
 */
export function isPinnedRow(bandId: string, itemId: string): boolean {
  return bandId === "notes" && itemId === "pinned";
}

/** The five newest pinned notes — the window every projection renders. */
export function usePinnedNoteWindow() {
  const vault = useVaultStore((s) => s.getActiveVault());
  const { roles } = useTagRoles(vault?.id ?? null);
  const queryState = useMemo(
    () => ({
      ...DEFAULT_NOTE_QUERY,
      tags: [roles.pinned],
      sort: "desc" as const,
      limit: 5,
    }),
    [roles.pinned],
  );
  // `live: false` on purpose (#131): a five-row glance is not worth a
  // WebSocket, and a third projection would otherwise be a third socket.
  const notes = useNotes(queryState, { live: false });
  return { vault, notes: notes.data };
}

export function PinnedNotesSubList({ variant, onNavigate }: PinnedNotesSubListProps) {
  const { vault, notes } = usePinnedNoteWindow();

  if (!vault || !notes || notes.length === 0) return null;

  const rowClass =
    variant === "rail"
      ? "focus-ring block min-w-0 truncate rounded-lg px-3 pl-11 py-1 font-round text-xs text-fg-dim transition-colors duration-(--dur-quick) ease-out hover:bg-bg hover:text-fg-muted"
      : // Thumb scale: `min-h-11` is the 44px floor, `flex items-center` keeps
        // the label centred in it, and the label still truncates in one line.
        "focus-ring flex min-h-11 min-w-0 items-center rounded-lg px-3 pl-11 py-1 font-round text-sm text-fg-dim transition-colors duration-(--dur-quick) ease-out hover:bg-bg hover:text-fg-muted";

  return (
    <ul aria-label="Pinned notes" className="min-w-0 space-y-0.5 pb-1">
      {notes.map((note) => {
        const title = displayTitle(note);
        return (
          <li key={note.id} className="min-w-0">
            <Link
              to={`/n/${encodeURIComponent(note.id)}`}
              data-pinned-note={note.id}
              onClick={onNavigate}
              className={rowClass}
            >
              {/* The rail row truncates on the anchor itself (a block box);
                  the touch row is a flex box, so the label needs its own
                  min-w-0 box to truncate inside. */}
              {variant === "rail" ? (
                title.text
              ) : (
                <span className="min-w-0 truncate">{title.text}</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
