import type { NoteAttachment } from "@/lib/vault/types";

/**
 * The name a person knows a file by. Both doors store a file under a server-made path
 * (`2026-11-25/1795…-<uuid>.csv`, never the caller's name) and keep the name it was sent with in
 * `metadata.original_name` (core attachment-tickets.ts, Cloud's add-attachment and upload). So: the row's
 * `filename` if a door sends one, else that original name, else the path's last segment, else the id.
 */
export function attachmentName(a: NoteAttachment): string {
  if (typeof a.filename === "string" && a.filename.trim()) return a.filename;
  const original = a.metadata?.original_name;
  if (typeof original === "string" && original.trim())
    return original.trim().split(/[\\/]/).pop() || original.trim();
  const last = a.path?.replace(/^\/+/, "").split("/").pop();
  return last || a.path || a.id;
}
