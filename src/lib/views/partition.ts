import type { Note } from "@/lib/vault/types";

// The pinned partition (VIEWS-RENDER-SPEC §2) — pinned-tagged results become
// their own group, applied WITHIN the view's already-fetched result set
// (pinning never injects a note the view's query didn't match). Replaces
// today's client-side sort-to-top (VaultSurface.tsx) with a real group.

export interface PartitionedNotes {
  pinned: Note[];
  rest: Note[];
}

/**
 * Split `notes` into pinned / rest by `pinnedTag`, preserving each group's
 * relative order. Vacuous (all notes land in `rest`) when the view's own
 * query IS the pinned tag — partitioning a pinned-tag view against itself
 * would just reproduce the same list as its own "pinned" group.
 */
export function partitionPinned(
  notes: Note[],
  pinnedTag: string,
  queryTags: string[] = [],
): PartitionedNotes {
  if (queryTags.includes(pinnedTag)) return { pinned: [], rest: notes };
  const pinned: Note[] = [];
  const rest: Note[] = [];
  for (const note of notes) {
    if ((note.tags ?? []).includes(pinnedTag)) pinned.push(note);
    else rest.push(note);
  }
  return { pinned, rest };
}
