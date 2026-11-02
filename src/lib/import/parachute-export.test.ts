import type { VaultClient } from "@/lib/vault/client";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { applyImport } from "./apply";
import { isRelativeAttachmentTarget, parseParachuteArchive } from "./parachute-export";
import { readTar } from "./tar";

/**
 * A ustar writer shaped like the cloud's export encoder
 * (parachute-cloud workers/vault/src/export.ts): a path over 100 bytes is
 * split into `prefix` + `name` at a "/", which every attachment path of a
 * real export needs (`.parachute/attachments/<26-char id>/<13-digit>-<uuid>.png`).
 */
function tar(files: Record<string, string | Uint8Array>): File {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const octal = (n: number, width: number) => `${n.toString(8).padStart(width - 1, "0")}\0`;
  for (const [path, body] of Object.entries(files)) {
    const data = typeof body === "string" ? enc.encode(body) : body;
    const h = new Uint8Array(512);
    let name = path;
    let prefix = "";
    if (enc.encode(path).length > 100) {
      const i = path.lastIndexOf("/", path.length - 1);
      prefix = path.slice(0, i);
      name = path.slice(i + 1);
    }
    h.set(enc.encode(name), 0);
    h.set(enc.encode(octal(0o644, 8)), 100);
    h.set(enc.encode(octal(0, 8)), 108);
    h.set(enc.encode(octal(0, 8)), 116);
    h.set(enc.encode(octal(data.length, 12)), 124);
    h.set(enc.encode(octal(0, 12)), 136);
    h.set(enc.encode("        "), 148);
    h[156] = "0".charCodeAt(0);
    h.set(enc.encode("ustar\0"), 257);
    h.set(enc.encode("00"), 263);
    h.set(enc.encode(prefix), 345);
    let sum = 0;
    for (const b of h) sum += b;
    h.set(enc.encode(`${sum.toString(8).padStart(6, "0")}\0 `), 148);
    chunks.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  chunks.push(new Uint8Array(1024));
  return new File(chunks, "garden-notes-export-2026-11-02.tar", { type: "application/x-tar" });
}

const ATT = "01M6DAQF0B1AXQTTY0ZDQMF5WZ";
const FILE = "1793596308284-aaa6a149-9575-4ca6-9a5c-35cc06096efe.png";
const ATT2 = "01M6DAP84KXSD4KQE4D6DXQ6HV";
const FILE2 = "1793596268269-267eb93b-36bf-41e1-8fa2-33b55a981cae.png";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

/** The Export page's output for one note with two attached pictures, one shown in the body. */
function gardenExport(): Record<string, string | Uint8Array> {
  return {
    ".parachute/vault.yaml": "export_format_version: 1\nname: garden-notes\n",
    ".parachute/schemas/garden.yaml": "description: Things in the garden\n",
    [`.parachute/attachments/${ATT2}/${FILE2}`]: PNG,
    [`.parachute/attachments/${ATT}/${FILE}`]: PNG,
    "Garden/Tulip bed.md": [
      "---",
      "id: 01M6DAP47GV7YR53PF2X5HAY22",
      "path: Garden/Tulip bed",
      "tags:",
      "  - garden",
      "metadata:",
      "  app: notes",
      "  source: text",
      "links:",
      "  - target: 01M6SEEDTRAYS0000000000000",
      "    relationship: next-to",
      "attachments:",
      `  - id: ${ATT2}`,
      "    mime_type: image/png",
      `    path: 2026-11-02/${FILE2}`,
      `  - body_link: ../.parachute/attachments/${ATT}/${FILE}`,
      `    id: ${ATT}`,
      "    mime_type: image/png",
      `    path: 2026-11-02/${FILE}`,
      "created_at: 2026-11-02T05:11:04.688Z",
      "updated_at: 2026-11-02T05:11:48.790Z",
      "---",
      "Planted the red and yellow tulips along the south fence. #garden",
      "",
      `![tulips.png](../.parachute/attachments/${ATT}/${FILE})`,
      "",
    ].join("\n"),
  };
}

function fakeVault() {
  let n = 0;
  const created: Array<Record<string, unknown>> = [];
  const linked: Array<{ noteId: string; path: string; mimeType: string }> = [];
  const updated: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const client = {
    uploadStorageFile: vi.fn(async (file: File) => ({
      path: `2026-11-03/new-${n++}.png`,
      size: file.size,
      mimeType: file.type,
    })),
    createNote: vi.fn(async (payload: Record<string, unknown>) => {
      created.push(payload);
      return { id: payload.id as string };
    }),
    linkAttachment: vi.fn(async (noteId: string, body: { path: string; mimeType: string }) => {
      linked.push({ noteId, ...body });
      return { id: `att-${linked.length}` };
    }),
    updateNote: vi.fn(async (id: string, payload: Record<string, unknown>) => {
      updated.push({ id, payload });
      return { id };
    }),
  } as unknown as VaultClient;
  return { client, created, linked, updated };
}

describe("readTar", () => {
  it("reads ustar paths split into prefix + name", async () => {
    const entries = await readTar(tar(gardenExport()));
    expect([...entries.keys()]).toContain(`.parachute/attachments/${ATT}/${FILE}`);
    expect([...entries.keys()]).toContain("Garden/Tulip bed.md");
  });

  it("refuses something that isn't a tar", async () => {
    await expect(
      readTar(new File(["not a tar archive at all".repeat(40)], "x.tar")),
    ).rejects.toThrow(/Not a tar archive/);
  });
});

describe("Parachute export import", () => {
  it("brings a note back with its pictures attached and its body link pointing at the new file", async () => {
    const parsed = await parseParachuteArchive(tar(gardenExport()));
    expect(parsed?.format).toBe("parachute-export");
    expect(parsed?.attachments.map((a) => a.kind)).toEqual(["image", "image"]);
    expect(parsed?.parachuteExport).toEqual({ tagSchemas: 1 });

    const vault = fakeVault();
    const report = await applyImport({ client: vault.client, parsed: parsed! });

    expect(report.created).toBe(1);
    expect(report.attachmentsUploaded).toBe(2);
    const [note] = vault.created;
    expect(note).toMatchObject({
      id: "01M6DAP47GV7YR53PF2X5HAY22",
      path: "Garden/Tulip bed",
      tags: ["garden"],
      metadata: { app: "notes", source: "text" },
      created_at: "2026-11-02T05:11:04.688Z",
    });
    // The export's relative link is now the uploaded file's storage link.
    const uploadedPaths = vault.linked.map((l) => l.path);
    const shown = uploadedPaths.find((p) =>
      (note?.content as string).includes(`![tulips.png](/api/storage/${p})`),
    );
    expect(shown).toBeDefined();
    expect(note?.content).not.toContain(".parachute/attachments");
    // Both files are attached to the note, the one the body shows and the one it doesn't.
    expect(vault.linked).toHaveLength(2);
    expect(vault.linked.every((l) => l.noteId === "01M6DAP47GV7YR53PF2X5HAY22")).toBe(true);
    expect(vault.linked.every((l) => l.mimeType === "image/png")).toBe(true);
    // Typed links are added after the notes exist.
    expect(vault.updated).toEqual([
      {
        id: "01M6DAP47GV7YR53PF2X5HAY22",
        payload: {
          links: { add: [{ target: "01M6SEEDTRAYS0000000000000", relationship: "next-to" }] },
          force: true,
        },
      },
    ]);
  });

  it("reads the same export zipped from its folder", async () => {
    const zip = new JSZip();
    for (const [p, body] of Object.entries(gardenExport())) zip.file(`garden-notes/${p}`, body);
    const file = new File([await zip.generateAsync({ type: "blob" })], "garden-notes.zip");
    const parsed = await parseParachuteArchive(file);
    expect(parsed?.notes.map((n) => n.path)).toEqual(["Garden/Tulip bed"]);
    expect(parsed?.attachments).toHaveLength(2);
  });

  it("returns null for an ordinary Obsidian zip, so it is read as one", async () => {
    const zip = new JSZip();
    zip.file("Vault/A.md", "a");
    const file = new File([await zip.generateAsync({ type: "blob" })], "vault.zip");
    expect(await parseParachuteArchive(file)).toBeNull();
  });

  it("only takes a body link shaped like one the export writes", () => {
    expect(
      isRelativeAttachmentTarget(`../../.parachute/attachments/${ATT}/${FILE}`, ATT, FILE),
    ).toBe(true);
    expect(isRelativeAttachmentTarget(`x/.parachute/attachments/${ATT}/${FILE}`, ATT, FILE)).toBe(
      false,
    );
    expect(
      isRelativeAttachmentTarget(
        "../.parachute/attachments/A/my%20%281%29.png",
        "A",
        "d/my (1).png",
      ),
    ).toBe(true);
  });
});
