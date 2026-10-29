import type { CreateNotePayload } from "@/lib/vault/client";
import { extractHashtags } from "./hashtags";
import { newNoteMetadata, withInboxTag } from "./new-note-tags";

// The ONE assembly for a typed note's create payload — shared by the /new
// editor and Home's in-place composer (W2-10) so the two surfaces can never
// drift: same `#hashtag` extraction, same provenance metadata
// (`source: "text"`, `app: "notes"`), same inbox rule (see new-note-tags.ts).
//
// `tags` is the chip row AS THE OPERATOR LEFT IT. `inboxTag` is the capture
// role tag when "Tag new notes as an inbox" is on (null when off, the
// default): it is added only when the note has no tag of its own.
export function buildTextNotePayload(args: {
  content: string;
  path: string;
  tags: string[];
  inboxTag?: string | null;
}): CreateNotePayload {
  const tags = withInboxTag(
    [...args.tags, ...extractHashtags(args.content)],
    args.inboxTag ?? null,
  );
  const payload: CreateNotePayload = {
    content: args.content,
    path: args.path.trim(),
    metadata: newNoteMetadata("text"),
  };
  if (tags.length) payload.tags = tags;
  return payload;
}
