import { NoteCard } from "@/components/views/NoteCard";
import { NoteFieldChips } from "@/components/views/NoteFieldChips";
import type { TagRoles } from "@/lib/vault/tag-roles";
import type { Note } from "@/lib/vault/types";
import type { ResolvedField } from "@/lib/views/fields";
import type { QueryKey } from "@tanstack/react-query";

// The gallery kind (Views Wave 2b) — the "bookshelf": result notes as a
// responsive grid of cover cards (a cover image when the note carries one,
// else a text tile). Auto-fill columns wrap at a sensible minimum width, so
// the same grid reads well from phone (one column) to wide desktop. Pinned
// notes surface first (the caller concatenates pinned + rest) and keep their
// star; clicking a card opens the note. Each card carries the shared
// field-chips band (view-experience wave, Part C) — the view's resolved fields
// (Part B), shown + editable in place via the shared mutation primitive.
export function GalleryView({
  notes,
  roles,
  viewResultsKey,
  fields = [],
}: {
  notes: Note[];
  roles: TagRoles;
  /** The `useViewResults` cache key — the optimistic write target for the chips. */
  viewResultsKey: QueryKey;
  /** The view's resolved fields (Part B) — rendered as an editable chip band. */
  fields?: ResolvedField[];
}) {
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
          footer={
            fields.length > 0 ? (
              <NoteFieldChips note={note} fields={fields} viewResultsKey={viewResultsKey} />
            ) : null
          }
        />
      ))}
    </div>
  );
}
