import type { CreateNotePayload } from "@/lib/vault/client";
import { extractHashtags } from "./hashtags";

// The ONE assembly for a typed capture's create payload — shared by the /new
// editor and Home's in-place composer (W2-10) so the two surfaces can never
// drift: same capture role tag, same `#hashtag` extraction, same
// `metadata.source: "text"` (the how-it-arrived axis lives in metadata, not
// tag identity — the 2026-07 one-tag simplification).
export function buildTextNotePayload(args: {
  content: string;
  path: string;
  tags: string[];
  captureTextRole: string;
}): CreateNotePayload {
  const tags = Array.from(
    new Set(
      [args.captureTextRole, ...args.tags, ...extractHashtags(args.content)].filter(
        (t) => t.length > 0,
      ),
    ),
  );
  const payload: CreateNotePayload = {
    content: args.content,
    path: args.path.trim(),
    metadata: { source: "text" },
  };
  if (tags.length) payload.tags = tags;
  return payload;
}
