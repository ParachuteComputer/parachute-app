import JSZip from "jszip";
import { classifyFilename } from "./attachments";
import { buildParsedNote } from "./build-note";
import { parsePortableFrontmatter } from "./portable-frontmatter";
import { readBlobAsText } from "./read-file";
import { readTar } from "./tar";
import type {
  CollectedAttachment,
  ExportAttachmentRef,
  ParseError,
  ParsedImport,
  ParsedNote,
  PortableLinkRef,
} from "./types";

/**
 * Read a Parachute export (portable-md) back in: the `.tar` the Export page
 * downloads, the same export zipped, or (C3) its unpacked folder.
 *
 *   <root>/
 *     .parachute/vault.yaml                     the manifest (marks an export)
 *     .parachute/attachments/<id>/<file>        each attached file
 *     .parachute/schemas/<tag>.yaml             tag definitions (not read here)
 *     <note path>.md                            one note: frontmatter + body
 *
 * Follows the vault's own importer (core `importVault`): a note's `id`,
 * `path`, `tags`, `metadata`, `links`, `attachments` and `created_at` come
 * from its frontmatter, and each attachment's `body_link` (the relative link
 * the export wrote into the body in place of `/api/storage/<path>`) is kept
 * so the apply step can point it at the re-uploaded file. A markdown file
 * without an `id` (added to the folder by hand) is read like any markdown
 * note rather than dropped.
 *
 * Returns `null` when the archive has no `.parachute/vault.yaml`, so the
 * caller can read a zip as an ordinary Obsidian vault instead.
 */
export async function parseParachuteArchive(file: File): Promise<ParsedImport | null> {
  const entries = file.name.toLowerCase().endsWith(".tar")
    ? await readTar(file)
    : await readZipEntries(file);
  return parseParachuteEntries(entries);
}

/** The same, for files picked as a folder (`webkitRelativePath` keeps the layout). */
export async function parseParachuteFolder(files: File[]): Promise<ParsedImport | null> {
  const entries = new Map<string, Blob>();
  for (const f of files) entries.set(f.webkitRelativePath || f.name, f);
  return parseParachuteEntries(entries);
}

async function readZipEntries(file: File): Promise<Map<string, Blob>> {
  const zip = await JSZip.loadAsync(file);
  const entries = new Map<string, Blob>();
  const reads: Promise<void>[] = [];
  zip.forEach((path, obj) => {
    if (obj.dir) return;
    reads.push(obj.async("blob").then((b) => void entries.set(path, b)));
  });
  await Promise.all(reads);
  return entries;
}

const SIDECAR = ".parachute";

export async function parseParachuteEntries(all: Map<string, Blob>): Promise<ParsedImport | null> {
  // The export root: where `.parachute/vault.yaml` sits. Allow one wrapping
  // folder (an export folder that was zipped, or picked as a folder).
  let root: string | null = null;
  for (const path of all.keys()) {
    const m = path.match(/^(?:([^/]+)\/)?\.parachute\/vault\.yaml$/);
    if (m) {
      root = m[1] ? `${m[1]}/` : "";
      break;
    }
  }
  if (root === null) return null;
  const entries = new Map<string, Blob>();
  for (const [path, blob] of all) {
    if (path.startsWith(root)) entries.set(path.slice(root.length), blob);
  }

  const notes: ParsedNote[] = [];
  const errors: ParseError[] = [];
  const attachments = new Map<string, CollectedAttachment>();
  let tagSchemas = 0;

  const paths = [...entries.keys()].sort((a, b) => a.localeCompare(b));
  for (const path of paths) {
    if (path.startsWith(`${SIDECAR}/`)) {
      if (path.startsWith(`${SIDECAR}/schemas/`)) tagSchemas++;
      continue; // attachments are pulled in per note below
    }
    if (!/\.(md|markdown)$/i.test(path)) {
      errors.push({
        sourcePath: path,
        reason: "Not brought in here: only markdown notes are read from an export on this page.",
      });
      continue;
    }
    const blob = entries.get(path) as Blob;
    let raw: string;
    try {
      raw = await readBlobAsText(blob);
    } catch (err) {
      errors.push({ sourcePath: path, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const { frontmatter, content } = parsePortableFrontmatter(raw);
    const id = typeof frontmatter.id === "string" && frontmatter.id.trim() ? frontmatter.id : null;
    if (!id) {
      notes.push(buildParsedNote({ sourcePath: path, raw }));
      continue;
    }
    const note: ParsedNote = {
      sourcePath: path,
      path: typeof frontmatter.path === "string" ? frontmatter.path : "",
      content,
      id,
      tags: Array.isArray(frontmatter.tags)
        ? frontmatter.tags.filter((t): t is string => typeof t === "string")
        : [],
      metadata: isPlainObject(frontmatter.metadata) ? frontmatter.metadata : {},
    };
    if (typeof frontmatter.created_at === "string") note.createdAt = frontmatter.created_at;
    if (typeof frontmatter.updated_at === "string") note.updatedAt = frontmatter.updated_at;

    const links = readLinks(frontmatter.links);
    if (links.length > 0) note.links = links;

    const refs: ExportAttachmentRef[] = [];
    for (const att of Array.isArray(frontmatter.attachments) ? frontmatter.attachments : []) {
      if (!isPlainObject(att)) continue;
      const { id: attId, path: attPath, mime_type: mime, body_link: bodyLink } = att;
      if (typeof attId !== "string" || typeof attPath !== "string" || !attId || !attPath) continue;
      const sourcePath = `${SIDECAR}/attachments/${attId}/${baseName(attPath)}`;
      const bytes = entries.get(sourcePath);
      if (!bytes) {
        errors.push({
          sourcePath,
          reason: `Attached file for "${note.path || path}" is missing from the export.`,
        });
        continue;
      }
      const mimeType = typeof mime === "string" ? mime : "";
      const ref: ExportAttachmentRef = { sourcePath, mimeType };
      // Only a target shaped like one the export writes counts (core's
      // isRelativeAttachmentTarget); anything else stays as written.
      if (typeof bodyLink === "string" && isRelativeAttachmentTarget(bodyLink, attId, attPath)) {
        ref.bodyLink = bodyLink;
      }
      refs.push(ref);
      if (!attachments.has(sourcePath)) {
        const filename = baseName(attPath);
        attachments.set(sourcePath, {
          sourcePath,
          filename,
          ext: extOf(filename),
          kind: classifyFilename(filename),
          blob: mimeType ? new Blob([bytes], { type: mimeType }) : bytes,
        });
      }
    }
    if (refs.length > 0) note.exportAttachments = refs;
    notes.push(note);
  }

  const tags = new Set<string>();
  for (const n of notes) for (const t of n.tags) tags.add(t);
  return {
    format: "parachute-export",
    notes,
    errors,
    tags: [...tags].sort(),
    attachments: [...attachments.values()],
    parachuteExport: { tagSchemas },
  };
}

function readLinks(value: unknown): PortableLinkRef[] {
  if (!Array.isArray(value)) return [];
  const out: PortableLinkRef[] = [];
  for (const l of value) {
    if (!isPlainObject(l)) continue;
    if (typeof l.target !== "string" || typeof l.relationship !== "string") continue;
    out.push({
      target: l.target,
      relationship: l.relationship,
      ...(isPlainObject(l.metadata) ? { metadata: l.metadata } : {}),
    });
  }
  return out;
}

/**
 * The link target the export writes from a note to an attached file: zero or
 * more `../`, then `.parachute/attachments/<id>/<basename>` with each segment
 * percent-encoded (and `(` `)` too). Mirrors core's
 * `relativeAttachmentTarget` / `isRelativeAttachmentTarget`.
 */
export function isRelativeAttachmentTarget(target: string, id: string, path: string): boolean {
  const sidecar = [SIDECAR, "attachments", id, baseName(path)]
    .map((s) =>
      encodeURIComponent(s).replace(
        /[()]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
  return (
    target.endsWith(sidecar) && /^(\.\.\/)*$/.test(target.slice(0, target.length - sidecar.length))
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function baseName(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}
