/**
 * The frontmatter reader for a Parachute export (portable-md), ported from
 * parachute-core `packages/vault/core/src/portable-md.ts` (`parseFrontmatter`
 * and its helpers, at core 638c04a) so the app reads an export the way the
 * vault's own importer does. The app's general reader (`./frontmatter`) is a
 * flat Obsidian subset: it can't read the nested `metadata:` object or the
 * `attachments:` / `links:` lists of objects the exporter writes.
 *
 * Kept close to core's text on purpose (diff it against core when the
 * format changes). One cut: core's `"old-export"` reading, which undoes a
 * quoting quirk of exports written before 2026-10-29, is not ported; such an
 * export reads here as plain `"export"`.
 */

/** How a scalar is read: plain YAML, or as the exporter writes it. */
export type ScalarReading = "yaml" | "export";

/**
 * Split an export note into its frontmatter object and body. Same fence
 * rules as core: BOM stripped, the first line exactly `---`, the first later
 * line exactly `---` closes, and an unclosed block is all body.
 */
export function parsePortableFrontmatter(
  raw: string,
  reading: ScalarReading = "export",
): { frontmatter: Record<string, unknown>; content: string } {
  const src = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = src.split(/\r?\n/);
  if (lines[0] !== "---") return { frontmatter: {}, content: src };
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return { frontmatter: {}, content: src };
  const yamlBlock = lines.slice(1, closeIdx).join("\n");
  const content = lines.slice(closeIdx + 1).join("\n");
  return { frontmatter: parseBlock(yamlBlock, 0, reading).value, content };
}

interface ParseResult {
  value: Record<string, unknown>;
  consumed: number; // number of lines consumed (for nested blocks)
}

/**
 * Parse a YAML block at a given indent depth. Returns the parsed object
 * plus the line count consumed (so callers can advance past nested blocks).
 *
 * The parser handles the shapes the emitter produces. Unknown shapes
 * (anchors, references, multi-document streams, multi-line strings) are
 * not supported — out of scope for the export format.
 */
function parseBlock(text: string, baseIndent: number, reading: ScalarReading): ParseResult {
  const lines = text.split("\n");
  const result: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    // Skip `#`-comment lines (contract C3 / §1.2). A comment at the
    // block's base level is not a key line; the parser must step over it.
    if (line.trimStart().startsWith("#")) {
      i++;
      continue;
    }
    const indent = countLeadingSpaces(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      i++;
      continue;
    } // shouldn't happen at this level

    // Key regex (contract C2 / §1.2): dots allowed in keys, optional
    // whitespace before the colon (`created.at:` / `key :` both parse).
    const kv = line.slice(baseIndent).match(/^([\w][\w.-]*)\s*:\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }
    const key = kv[1]!;
    const valueText = kv[2]!.trim();

    if (valueText === "") {
      // Block-form value follows. Could be either an object or an array.
      // Determine by peeking at the next non-blank line's first
      // non-whitespace character — `-` ⇒ array, otherwise object.
      const peekIdx = peekNextContent(lines, i + 1);
      if (peekIdx === -1) {
        result[key] = "";
        i++;
        continue;
      }
      const peekLine = lines[peekIdx]!;
      const peekIndent = countLeadingSpaces(peekLine);
      if (peekIndent <= baseIndent) {
        // No nested content — empty value.
        result[key] = "";
        i++;
        continue;
      }
      if (peekLine.slice(peekIndent).startsWith("- ")) {
        const { value, consumed } = parseArrayBlock(lines, i + 1, peekIndent, reading);
        result[key] = value;
        i = i + 1 + consumed;
      } else {
        const block = lines.slice(i + 1).join("\n");
        const { value, consumed } = parseBlock(block, peekIndent, reading);
        result[key] = value;
        i = i + 1 + consumed;
      }
    } else {
      result[key] = parseScalarOrInline(valueText, reading);
      i++;
    }
  }
  return { value: result, consumed: i };
}

function peekNextContent(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (lines[i]!.trim() !== "") return i;
  }
  return -1;
}

function countLeadingSpaces(s: string): number {
  let n = 0;
  while (n < s.length && s[n] === " ") n++;
  return n;
}

/**
 * Parse an array block: lines starting with `- ` at `arrayIndent`.
 * Returns the array + lines consumed.
 *
 * Each `- ` introduces an item:
 *   - `- value` → scalar item.
 *   - `- key: value` (with possible following indented keys) → object item.
 */
function parseArrayBlock(
  lines: string[],
  start: number,
  arrayIndent: number,
  reading: ScalarReading,
): { value: unknown[]; consumed: number } {
  const result: unknown[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const indent = countLeadingSpaces(line);
    if (indent < arrayIndent) break;
    if (indent > arrayIndent) {
      i++;
      continue;
    }
    if (!line.slice(indent).startsWith("- ")) break;

    // First content after `- `.
    const after = line.slice(indent + 2).trim();
    // Is this a scalar item (`- foo`) or an object item (`- key: value`)?
    // Key regex matches parseBlock's (contract C2): dots + optional space.
    const objMatch = after.match(/^([\w][\w.-]*)\s*:\s*(.*)$/);
    if (!objMatch) {
      result.push(parseScalarOrInline(after, reading));
      i++;
      continue;
    }

    // Object item. Build a fake block: the first line becomes a key at
    // indent+2, and subsequent lines at indent+2 are siblings. We
    // synthesize a normalized block string and recurse.
    const itemIndent = indent + 2;
    const itemKey = objMatch[1]!;
    const itemValue = objMatch[2]!.trim();
    const itemObj: Record<string, unknown> = {};
    if (itemValue === "") {
      // First key's value is a nested block — look at next line.
      const peekIdx = peekNextContent(lines, i + 1);
      if (peekIdx !== -1) {
        const peekLine = lines[peekIdx]!;
        const peekIndent = countLeadingSpaces(peekLine);
        if (peekIndent > itemIndent) {
          // Nested block under this first key.
          if (peekLine.slice(peekIndent).startsWith("- ")) {
            const { value, consumed } = parseArrayBlock(lines, i + 1, peekIndent, reading);
            itemObj[itemKey] = value;
            i = i + 1 + consumed;
          } else {
            const block = lines.slice(i + 1).join("\n");
            const { value, consumed } = parseBlock(block, peekIndent, reading);
            itemObj[itemKey] = value;
            i = i + 1 + consumed;
          }
        } else {
          itemObj[itemKey] = "";
          i++;
        }
      } else {
        itemObj[itemKey] = "";
        i++;
      }
    } else {
      itemObj[itemKey] = parseScalarOrInline(itemValue, reading);
      i++;
    }

    // Continue consuming sibling keys at itemIndent that aren't `- `-prefixed.
    while (i < lines.length) {
      const sib = lines[i]!;
      if (sib.trim() === "") {
        i++;
        continue;
      }
      const sibIndent = countLeadingSpaces(sib);
      if (sibIndent !== itemIndent) break;
      if (sib.slice(sibIndent).startsWith("- ")) break;
      const sibKv = sib.slice(sibIndent).match(/^([\w][\w.-]*)\s*:\s*(.*)$/);
      if (!sibKv) break;
      const sibKey = sibKv[1]!;
      const sibValue = sibKv[2]!.trim();
      if (sibValue === "") {
        const peekIdx = peekNextContent(lines, i + 1);
        if (peekIdx !== -1) {
          const peekLine = lines[peekIdx]!;
          const peekIndent = countLeadingSpaces(peekLine);
          if (peekIndent > itemIndent) {
            if (peekLine.slice(peekIndent).startsWith("- ")) {
              const { value, consumed } = parseArrayBlock(lines, i + 1, peekIndent, reading);
              itemObj[sibKey] = value;
              i = i + 1 + consumed;
            } else {
              const block = lines.slice(i + 1).join("\n");
              const { value, consumed } = parseBlock(block, peekIndent, reading);
              itemObj[sibKey] = value;
              i = i + 1 + consumed;
            }
            continue;
          }
        }
        itemObj[sibKey] = "";
        i++;
      } else {
        itemObj[sibKey] = parseScalarOrInline(sibValue, reading);
        i++;
      }
    }

    result.push(itemObj);
  }
  return { value: result, consumed: i - start };
}

/**
 * Quote-aware split of an inline-array body on top-level commas
 * (contract C4 / §1.2). A comma inside a single- or double-quoted string
 * does not separate items, so `"a, b", c` → `['"a, b"', 'c']`. Quote
 * chars are preserved in the parts; `parseScalarOrInline` strips them via
 * `unquote`. Mirrors the web parser's `splitInlineArray`.
 */
function splitInlineArray(inner: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === ",") {
      parts.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  parts.push(buf);
  return parts;
}

/**
 * Parse a scalar or inline form (`[a, b]`, `{ k: v }`). Used for the
 * value portion of `key: value` lines.
 */
function parseScalarOrInline(s: string, reading: ScalarReading): unknown {
  if (reading !== "yaml" && isNonEmptyFlow(s)) return s;
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (inner === "") return [];
    // Quote-aware split (contract C4 / §1.2): a comma inside a quoted
    // string is NOT an item separator, so `["a, b", c]` → 2 items, not 3.
    // Matches the web parser's `splitInlineArray`.
    return splitInlineArray(inner).map((part) => parseScalarOrInline(part.trim(), reading));
  }
  if (s.startsWith("{") && s.endsWith("}")) {
    const inner = s.slice(1, -1).trim();
    if (inner === "") return {};
    const out: Record<string, unknown> = {};
    // Simple split on `, ` — sufficient for our emitter's shape (no
    // nested commas at this level since nested objects use block form).
    for (const part of inner.split(",")) {
      const m = part.trim().match(/^([\w][\w-]*):\s*(.*)$/);
      if (m) out[m[1]!] = parseScalarOrInline(m[2]!.trim(), reading);
    }
    return out;
  }
  return unquote(s, reading);
}

function isNonEmptyFlow(s: string): boolean {
  const open = s[0];
  if (open !== "[" && open !== "{") return false;
  return s.endsWith(open === "[" ? "]" : "}") && s.slice(1, -1).trim() !== "";
}

function unquote(s: string, _reading: ScalarReading): unknown {
  return unquoteYaml(s);
}

function unquoteYaml(s: string): unknown {
  if (s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith('"') && s.endsWith('"')) {
    // Double-quoted form with escape sequences — the shape the emitter
    // produces for strings containing newlines / control characters
    // (vault#317 F1). Decode the escapes the emitter emits:
    // `\\` `\"` `\n` `\r` `\t` `\v` `\f` `\xNN`. TODO: YAML 1.2 defines
    // additional escapes (`\0` `\a` `\e` `\N` `\_` `\L` `\P` `\u<4hex>`
    // `\U<8hex>`) — the emitter never produces them, but legacy
    // vault.yaml / schema files might. Add when a real case lands.
    const body = s.slice(1, -1);
    let out = "";
    let i = 0;
    while (i < body.length) {
      const ch = body[i]!;
      if (ch === "\\" && i + 1 < body.length) {
        const next = body[i + 1]!;
        switch (next) {
          case "\\":
            out += "\\";
            i += 2;
            continue;
          case '"':
            out += '"';
            i += 2;
            continue;
          case "n":
            out += "\n";
            i += 2;
            continue;
          case "r":
            out += "\r";
            i += 2;
            continue;
          case "t":
            out += "\t";
            i += 2;
            continue;
          case "v":
            out += "\v";
            i += 2;
            continue;
          case "f":
            out += "\f";
            i += 2;
            continue;
          case "x": {
            const hex = body.slice(i + 2, i + 4);
            if (/^[0-9a-fA-F]{2}$/.test(hex)) {
              out += String.fromCharCode(Number.parseInt(hex, 16));
              i += 4;
              continue;
            }
            // Malformed escape — fall through, treat as literal.
            out += ch;
            i += 1;
            continue;
          }
          default:
            // Unknown escape — preserve literally; future-proof against
            // additional YAML escapes we don't yet decode.
            out += ch + next;
            i += 2;
            continue;
        }
      }
      out += ch;
      i += 1;
    }
    return out;
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return Number.parseFloat(s);
  return s;
}
