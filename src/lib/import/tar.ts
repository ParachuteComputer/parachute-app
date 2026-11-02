/**
 * Read a `.tar` in the browser: the archive the Export page downloads
 * (`GET /api/export`, a POSIX ustar the vault writes itself). No dependency:
 * ustar is 512-byte headers, each followed by its data padded to 512.
 *
 * Reads what a Parachute export uses (regular files, a `prefix` for paths
 * over 100 bytes) plus the two long-name forms other tar tools write when
 * someone repacks an unpacked export: pax `x` headers (`path=`) and GNU `L`
 * entries. Directories, links and other entry types are skipped.
 */

import { readBlobAsArrayBuffer } from "./read-file";

const BLOCK = 512;

/** Every regular file in the archive, path → bytes. Throws on a broken header. */
export async function readTar(file: Blob): Promise<Map<string, Blob>> {
  const bytes = new Uint8Array(await readBlobAsArrayBuffer(file));
  const out = new Map<string, Blob>();
  const decoder = new TextDecoder();
  let offset = 0;
  let longName: string | null = null;
  while (offset + BLOCK <= bytes.length) {
    const header = bytes.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break; // end-of-archive marker
    if (!checksumOk(header)) throw new Error(`Not a tar archive (bad header at byte ${offset}).`);
    const size = readOctal(header.subarray(124, 136));
    const type = String.fromCharCode(header[156] ?? 0);
    const dataStart = offset + BLOCK;
    const data = bytes.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x") {
      longName = paxPath(decoder.decode(data)) ?? longName;
      continue;
    }
    if (type === "L") {
      longName = readString(decoder, data);
      continue;
    }
    const name = readString(decoder, header.subarray(0, 100));
    const isUstar = readString(decoder, header.subarray(257, 263)).startsWith("ustar");
    const prefix = isUstar ? readString(decoder, header.subarray(345, 500)) : "";
    const path = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    // "0" and NUL are regular files; everything else (dirs, links, global pax) is skipped.
    if (type !== "0" && type !== "\0") continue;
    out.set(path.replace(/^\.\//, ""), new Blob([data.slice()]));
  }
  return out;
}

function readString(decoder: TextDecoder, field: Uint8Array): string {
  const end = field.indexOf(0);
  return decoder.decode(end >= 0 ? field.subarray(0, end) : field);
}

function readOctal(field: Uint8Array): number {
  let n = 0;
  for (const b of field) {
    if (b === 0 || b === 32) {
      if (n > 0) break;
      continue;
    }
    if (b < 48 || b > 55) break;
    n = n * 8 + (b - 48);
  }
  return n;
}

/** The header checksum: the byte sum with the checksum field read as spaces. */
function checksumOk(header: Uint8Array): boolean {
  const want = readOctal(header.subarray(148, 156));
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : (header[i] ?? 0);
  return sum === want;
}

/** `path=` from a pax extended header ("<len> path=<value>\n" records). */
function paxPath(text: string): string | null {
  for (const line of text.split("\n")) {
    const m = line.match(/^\d+ path=(.*)$/);
    if (m) return m[1] ?? null;
  }
  return null;
}
