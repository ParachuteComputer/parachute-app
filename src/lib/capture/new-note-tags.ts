// How a new note from the Notes app is tagged and labelled (T-318,
// DESIGN-0.9 §8c). One rule for every create path (the /new editor's text and
// voice saves, Home's in-place composer):
//
//   - The note carries the tags the person gave it (chips + `#hashtags`), and
//     nothing else by default. The app no longer stamps `#capture`.
//   - How it arrived is recorded instead, in metadata: `source` (`text` or
//     `voice`) and `app: "notes"`. The vault's own `created_via` is set
//     server-side from the credential (cloud: `api`), and the REST create does
//     not accept it from the client, so the app's name rides metadata.
//   - Opt-in inbox ("Tag new notes as an inbox" in Settings): when on, a note
//     that ends up with NO tag of its own gets the inbox tag (the capture role,
//     default `capture`). A note the person already tagged is left alone, so
//     the inbox tag means "not yet sorted".

export type NoteSource = "text" | "voice";

export function newNoteMetadata(source: NoteSource): { source: NoteSource; app: "notes" } {
  return { source, app: "notes" };
}

// `inboxTag` is the role tag to add when the opt-in is on, or null when off.
// Returns a de-duplicated tag list; empty entries are dropped.
export function withInboxTag(tags: readonly string[], inboxTag: string | null): string[] {
  const own = Array.from(new Set(tags.filter((t) => t.length > 0)));
  if (own.length === 0 && inboxTag) return [inboxTag];
  return own;
}
