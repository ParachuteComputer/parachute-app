import { NoteCard } from "@/components/views/NoteCard";
import type { TagRoles } from "@/lib/vault/tag-roles";
import type { Note } from "@/lib/vault/types";

// The gallery kind (Views Wave 2b) — the "bookshelf": result notes as a
// responsive grid of cover cards (a cover image when the note carries one,
// else a text tile). Auto-fill columns wrap at a sensible minimum width, so
// the same grid reads well from phone (one column) to wide desktop. Pinned
// notes surface first (the caller concatenates pinned + rest) and keep their
// star; clicking a card opens the note.
export function GalleryView({ notes, roles }: { notes: Note[]; roles: TagRoles }) {
  return (
    <div
      aria-label="Gallery"
      className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-4"
    >
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          variant="gallery"
          pinnedTag={roles.pinned}
          archivedTag={roles.archived}
        />
      ))}
    </div>
  );
}
