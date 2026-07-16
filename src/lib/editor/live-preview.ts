import { syntaxTree } from "@codemirror/language";
import type { Extension, Range, Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { WIKILINK_CLASS } from "@openparachute/surface-render";

// A4-SPEC.md — the live-preview decoration layer. Obsidian-style: every line
// renders formatted (markup faded/hidden), the line(s) the cursor touches
// reveal raw markdown. One file by design (widgets + plugin + theme
// co-located; split only if it grows past ~600 lines).
//
// THE TWO INVARIANTS THE WHOLE REVIEW HANGS ON:
//   1. Read-only decoration layer. The ONLY `view.dispatch` call anywhere in
//      this module is the checkbox widget's tap handler (below). Everything
//      else here only ever READS `view.state` / `syntaxTree(state)` and
//      produces a `DecorationSet` — never mutates the document.
//   2. Reveal never changes vertical layout. Styling that affects line
//      height (heading font-size, code-block background, HR/chip/checkbox
//      widget height) applies via `style()`/`lineDeco()` UNCONDITIONALLY —
//      reveal only gates the `hide()`/`hideWithWidget()` calls, which touch
//      marker visibility, never line height. This is what keeps the caret
//      from jumping when a line reveals.
//
// Node names below are lezer/markdown's actual runtime strings (not typed —
// confirmed against @lezer/markdown's compiled source, since the package's
// .d.ts documents shapes in prose, not as string literal types).

// ---------------------------------------------------------------------------
// Wikilinks / embeds — NOT in the lezer tree, decorated via a regex scan of
// visible-range text (skipping code/frontmatter ranges collected during the
// tree walk below). Mirrored byte-for-byte from the canonical regex in
// parachute-surface/packages/surface-render/src/markdown/remark-wikilinks.ts
// (`WIKILINK_RE`, kept module-private there) — a follow-up issue is filed
// against parachute-surface to export it so this mirror can be deleted (see
// the PR description). Embed variant is the same body with a leading `!`.
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const EMBED_RE = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// ---------------------------------------------------------------------------
// Widgets

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly markerFrom: number,
  ) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof TaskCheckboxWidget &&
      other.checked === this.checked &&
      other.markerFrom === this.markerFrom
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-lp-checkbox-wrap";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-lp-checkbox";
    box.checked = this.checked;
    box.setAttribute("aria-checked", String(this.checked));
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    // The tap must never be eaten by reveal: pointerdown/mousedown never
    // reach CM (so the caret never moves onto this line, so this line never
    // becomes "revealed" from the tap that toggled it). The actual state
    // change commits on click — works for touch, mouse, AND keyboard.
    box.addEventListener("pointerdown", stop);
    box.addEventListener("mousedown", stop);
    box.addEventListener("click", (e) => {
      stop(e);
      // THE ONLY view.dispatch call in this module (invariant 1). Flips the
      // bracket interior at the TaskMarker (`markerFrom` is the "[", the
      // interior char sits one past it) — doc is otherwise byte-identical,
      // undoable via the normal history extension, and flows out onChange
      // like any other edit.
      view.dispatch({
        changes: {
          from: this.markerFrom + 1,
          to: this.markerFrom + 2,
          insert: this.checked ? " " : "x",
        },
      });
    });
    wrap.appendChild(box);
    return wrap;
  }
}

class BulletWidget extends WidgetType {
  override eq(other: WidgetType): boolean {
    return other instanceof BulletWidget;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-lp-bullet";
    el.setAttribute("aria-hidden", "true");
    el.textContent = "•";
    return el;
  }
  override ignoreEvent(): boolean {
    // Let the tap fall through to CM's normal click-to-place-cursor — that's
    // what reveals the line's raw "-"/"*"/"+".
    return false;
  }
}

class HrWidget extends WidgetType {
  override eq(other: WidgetType): boolean {
    return other instanceof HrWidget;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-lp-hr";
    el.setAttribute("aria-hidden", "true");
    return el;
  }
  override ignoreEvent(): boolean {
    return false; // tapping the rule reveals the raw "---"/"***"/"___"
  }
}

function iconForLabel(label: string): string {
  return /\.(png|jpe?g|gif|webp|svg|heic)$/i.test(label) ? "🖼" : "📎";
}

// Placeholder chip for images/embeds (v1 — no inline rendering, see A4-SPEC
// §2). Used both for `Image` lezer nodes and the `![[…]]` embed regex.
class EmbedChipWidget extends WidgetType {
  constructor(private readonly label: string) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return other instanceof EmbedChipWidget && other.label === this.label;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-lp-embed-chip";
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = iconForLabel(this.label);
    const text = document.createElement("span");
    text.textContent = this.label || "attachment";
    el.append(icon, text);
    return el;
  }
  override ignoreEvent(): boolean {
    return false; // tapping the chip reveals the raw syntax
  }
}

function filenameFromUrl(url: string): string {
  const clean = url.split(/[?#]/)[0] ?? url;
  const parts = clean.split("/");
  return parts[parts.length - 1] || url;
}

// ---------------------------------------------------------------------------
// Frontmatter guard — doc starting with a `---` line excludes everything
// through the CLOSING `---` line from all decoration, raw always. A cheap
// manual scan (no frontmatter parser extension): without it, CommonMark
// itself would parse the opening `---` as a HorizontalRule and (since the
// closing `---` directly follows `key: value` lines) the closing one as a
// Setext-heading underline for the last frontmatter line — exactly the
// "fences render as HR widgets, title: lines get decorated" trap the spec
// calls out.
function frontmatterEnd(doc: Text): number {
  if (doc.lines < 2) return 0;
  if (doc.line(1).text.trim() !== "---") return 0;
  for (let n = 2; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.text.trim() === "---") return line.to;
  }
  return 0; // unterminated — don't guess, decorate normally
}

// ---------------------------------------------------------------------------
// The reveal rule (A4-SPEC §3) — line-level, one grammar. Every line touched
// by any selection range is revealed; a cursor is a zero-length range (its
// one line), a spanning selection reveals every line it touches.
function computeRevealedLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const startLine = view.state.doc.lineAt(range.from).number;
    const endLine = view.state.doc.lineAt(range.to).number;
    for (let l = startLine; l <= endLine; l++) lines.add(l);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The decoration builder. Runs over `view.visibleRanges` ONLY — never the
// whole doc (the perf-bound test in live-preview.test.ts builds the whole
// doc deliberately as a worst case; the production path here is cheaper).
// Exported for the invariant/perf tests, which time and inspect this
// directly rather than through a full CM `dispatch()` round trip — a
// dispatch's cost is dominated by CM's own measurement/DOM-patch machinery,
// not this function, so timing the dispatch would test the wrong thing.
export function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const tree = syntaxTree(state);
  const revealedLines = computeRevealedLines(view);
  const fmEnd = frontmatterEnd(doc);
  const ranges: Range<Decoration>[] = [];

  const isRevealed = (from: number, to: number): boolean => {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(Math.max(from, to - 1)).number;
    for (let l = startLine; l <= endLine; l++) if (revealedLines.has(l)) return true;
    return false;
  };
  // Hides a range UNLESS the line(s) it sits on are revealed — the ONE place
  // reveal gates anything. Used for markers (marks, brackets, list bullets).
  const hide = (from: number, to: number, widget?: WidgetType) => {
    if (from >= to || isRevealed(from, to)) return;
    ranges.push(Decoration.replace(widget ? { widget } : {}).range(from, to));
  };
  // Pure styling — NEVER gated by reveal (invariant 2): heading size, quote
  // border, code background, link/wikilink color, chip styling all apply
  // regardless of cursor position.
  const style = (
    from: number,
    to: number,
    className: string,
    attributes?: Record<string, string>,
  ) => {
    if (from >= to) return;
    ranges.push(Decoration.mark({ class: className, attributes }).range(from, to));
  };
  const lineClass = (pos: number, className: string) => {
    ranges.push(Decoration.line({ class: className }).range(doc.lineAt(pos).from));
  };

  for (const { from: vf, to: vt } of view.visibleRanges) {
    const from = Math.max(vf, fmEnd);
    const to = vt;
    if (from >= to) continue;

    const codeRanges: Array<{ from: number; to: number }> = [];
    // Wikilinks/embeds aren't in the tree, so lezer is free to ALSO parse
    // the inner brackets of `[[target]]` as a (shortcut-reference) `Link`
    // node — the outer "[[" / inner "[" don't compete for the same
    // characters, but the resulting Link node's range sits entirely inside
    // the wikilink match. Computed up front (text-only, no decorations yet)
    // so the tree walk below can recognize and skip those nodes instead of
    // double-decorating the same span from both passes.
    const { embedMatches, wikiMatches } = findWikilinkAndEmbedMatches(doc, from, to);
    const insideWikilinkOrEmbed = (nodeFrom: number, nodeTo: number) =>
      embedMatches.some((m) => nodeFrom >= m.start && nodeTo <= m.end) ||
      wikiMatches.some((m) => nodeFrom >= m.start && nodeTo <= m.end);

    tree.iterate({
      from,
      to,
      enter(nodeRef) {
        switch (nodeRef.name) {
          case "Table": {
            // Explicitly out of A4 v1 — render raw (EDITOR-RESEARCH §4:
            // dedicated table editing UI later). Opaque to every decoration
            // pass below, same as fenced/indented code.
            codeRanges.push({ from: nodeRef.from, to: nodeRef.to });
            return false;
          }
          case "FencedCode":
          case "CodeBlock": {
            codeRanges.push({ from: nodeRef.from, to: nodeRef.to });
            const startLine = doc.lineAt(nodeRef.from).number;
            const endLine = doc.lineAt(Math.max(nodeRef.from, nodeRef.to - 1)).number;
            for (let l = startLine; l <= endLine; l++) lineClass(doc.line(l).from, "cm-lp-code-bg");
            const node = nodeRef.node;
            for (const mark of node.getChildren("CodeMark")) {
              style(mark.from, mark.to, "cm-lp-fence-mark"); // dimmed, not hidden
            }
            const info = node.getChild("CodeInfo");
            if (info) style(info.from, info.to, "cm-lp-code-info");
            return false; // never decorate CodeText — fence interiors stay raw
          }
          case "InlineCode": {
            codeRanges.push({ from: nodeRef.from, to: nodeRef.to });
            const marks = nodeRef.node.getChildren("CodeMark");
            if (marks.length === 2) {
              hide(marks[0].from, marks[0].to);
              hide(marks[1].from, marks[1].to);
              style(marks[0].to, marks[1].from, "cm-lp-inline-code");
            }
            return false;
          }
          case "ATXHeading1":
          case "ATXHeading2":
          case "ATXHeading3":
          case "ATXHeading4":
          case "ATXHeading5":
          case "ATXHeading6": {
            const level = Number(nodeRef.name.slice(-1));
            lineClass(nodeRef.from, `cm-lp-heading cm-lp-h${level}`);
            const mark = nodeRef.node.getChild("HeaderMark");
            if (mark) {
              let hideTo = mark.to;
              if (doc.sliceString(hideTo, hideTo + 1) === " ") hideTo += 1;
              hide(mark.from, hideTo);
            }
            break; // descend — nested emphasis/links inside the heading text
          }
          case "Blockquote": {
            for (const mark of nodeRef.node.getChildren("QuoteMark")) {
              lineClass(mark.from, "cm-lp-quote");
              let hideTo = mark.to;
              if (doc.sliceString(hideTo, hideTo + 1) === " ") hideTo += 1;
              hide(mark.from, hideTo);
            }
            break;
          }
          case "HorizontalRule": {
            hide(nodeRef.from, nodeRef.to, new HrWidget());
            break;
          }
          case "StrongEmphasis":
          case "Emphasis": {
            for (const mark of nodeRef.node.getChildren("EmphasisMark")) hide(mark.from, mark.to);
            break;
          }
          case "Strikethrough": {
            for (const mark of nodeRef.node.getChildren("StrikethroughMark"))
              hide(mark.from, mark.to);
            break;
          }
          case "Task": {
            // GFM task item: `ListMark` ("-") is a sibling on the parent
            // ListItem; `TaskMarker` ("[ ]"/"[x]") is Task's own first
            // child. The widget replaces ListMark + the space between it
            // and TaskMarker + TaskMarker + its own trailing space — the
            // whole "- [ ] " prefix — per A4-SPEC §4.
            const listMark = nodeRef.node.parent?.getChild("ListMark");
            const taskMarker = nodeRef.node.getChild("TaskMarker");
            if (listMark && taskMarker) {
              const checked = /x/i.test(doc.sliceString(taskMarker.from + 1, taskMarker.from + 2));
              let hideTo = taskMarker.to;
              if (doc.sliceString(hideTo, hideTo + 1) === " ") hideTo += 1;
              hide(listMark.from, hideTo, new TaskCheckboxWidget(checked, taskMarker.from));
              if (checked) style(hideTo, nodeRef.to, "cm-lp-task-done");
            }
            break; // descend — nested emphasis/links inside the task text
          }
          case "ListMark": {
            const listItem = nodeRef.node.parent;
            if (listItem?.getChild("Task")) break; // handled by the Task case above
            const list = listItem?.parent;
            if (list?.name === "BulletList") {
              let hideTo = nodeRef.to;
              if (doc.sliceString(hideTo, hideTo + 1) === " ") hideTo += 1;
              hide(nodeRef.from, hideTo, new BulletWidget());
            } else if (list?.name === "OrderedList") {
              style(nodeRef.from, nodeRef.to, "cm-lp-ordered-mark"); // style only, nothing hidden
            }
            break;
          }
          case "Image": {
            if (insideWikilinkOrEmbed(nodeRef.from, nodeRef.to)) return false; // it's really an embed
            const marks = nodeRef.node.getChildren("LinkMark");
            const url = nodeRef.node.getChild("URL");
            if (marks.length >= 2) {
              const altFrom = marks[0].to;
              const altTo = marks[1].from;
              const alt = doc.sliceString(altFrom, altTo).trim();
              const urlText = url ? doc.sliceString(url.from, url.to) : "";
              const label = alt || (urlText ? filenameFromUrl(urlText) : "");
              hide(nodeRef.from, nodeRef.to, new EmbedChipWidget(label));
            }
            return false; // the chip fully replaces alt text + url, no need to descend
          }
          case "Link": {
            if (insideWikilinkOrEmbed(nodeRef.from, nodeRef.to)) break; // it's really a wikilink
            const marks = nodeRef.node.getChildren("LinkMark");
            const url = nodeRef.node.getChild("URL");
            if (marks.length >= 2) {
              const openMark = marks[0];
              const closeMark = marks[marks.length - 1];
              hide(openMark.from, openMark.to); // "["
              hide(marks[1].from, closeMark.to); // "](url)"
              const urlText = url ? doc.sliceString(url.from, url.to) : "";
              style(
                openMark.to,
                marks[1].from,
                "cm-lp-link",
                urlText ? { title: urlText } : undefined,
              );
            }
            break; // descend — nested emphasis inside link text
          }
          default:
            break;
        }
        return undefined;
      },
    });

    const isExcluded = (pos: number) => codeRanges.some((r) => pos >= r.from && pos < r.to);
    for (const m of embedMatches) {
      if (isExcluded(m.start) || isRevealed(m.start, m.end)) continue;
      ranges.push(
        Decoration.replace({ widget: new EmbedChipWidget(m.alias || m.target) }).range(
          m.start,
          m.end,
        ),
      );
    }
    for (const m of wikiMatches) {
      if (isExcluded(m.start) || isRevealed(m.start, m.end)) continue;
      const openTo = m.start + 2; // past "[["
      const closeFrom = m.end - 2; // start of "]]"
      // One replace range covers "[[" alone (no alias) or "[[target|"
      // (aliased) — either way, everything up to where DISPLAY text begins.
      const displayFrom = m.alias ? openTo + m.targetLen + 1 : openTo;
      ranges.push(Decoration.replace({}).range(m.start, displayFrom));
      ranges.push(Decoration.mark({ class: WIKILINK_CLASS }).range(displayFrom, closeFrom));
      ranges.push(Decoration.replace({}).range(closeFrom, m.end)); // "]]"
    }
  }

  // `Decoration.set(..., true)` sorts for us rather than requiring every
  // push above to already be in ascending order — the many independent
  // `hide()`/`style()`/`lineClass()` call sites above would make hand-sorted
  // insertion an easy invariant to silently break; correctness over the
  // marginal cost of one sort pass over a viewport's worth of decorations.
  return Decoration.set(ranges, true);
}

interface EmbedMatch {
  start: number;
  end: number;
  target: string;
  alias?: string;
}
interface WikiMatch {
  start: number;
  end: number;
  targetLen: number;
  alias?: string;
}

// Text-only span computation — no decorations pushed here. Called BEFORE
// the tree walk so the walk can recognize (and skip) `Link`/`Image` nodes
// that lezer opportunistically parses out of a wikilink/embed's INNER
// brackets (e.g. `[[Wikilink]]`'s `[Wikilink]` looks like a valid
// shortcut-reference link to lezer, and `![[file]]`'s `[file]` the same) —
// without this split, both passes would independently decorate the same
// span.
function findWikilinkAndEmbedMatches(
  doc: Text,
  from: number,
  to: number,
): { embedMatches: EmbedMatch[]; wikiMatches: WikiMatch[] } {
  const text = doc.sliceString(from, to);

  const embedMatches: EmbedMatch[] = [];
  for (const m of text.matchAll(EMBED_RE)) {
    const start = from + (m.index ?? 0);
    const end = start + m[0].length;
    embedMatches.push({
      start,
      end,
      target: (m[1] ?? "").trim(),
      alias: m[2]?.trim(),
    });
  }

  const wikiMatches: WikiMatch[] = [];
  for (const m of text.matchAll(WIKILINK_RE)) {
    const start = from + (m.index ?? 0);
    const end = start + m[0].length;
    // Skip matches consumed by an embed's leading "!" — WIKILINK_RE has no
    // `!`-awareness, so `![[x]]` matches both regexes at an offset of 1.
    if (embedMatches.some((s) => start >= s.start && start < s.end)) continue;
    wikiMatches.push({ start, end, targetLen: m[1]?.length ?? 0, alias: m[2] });
  }

  return { embedMatches, wikiMatches };
}

// ---------------------------------------------------------------------------
// The ViewPlugin

class LivePreviewPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.view.composing) {
      // IME safety: rebuilding mid-composition risks a replace decoration
      // landing under text the IME still owns. The composed line is always
      // cursor-revealed anyway (§3), so there's nothing to hide there —
      // just remap existing ranges through the edit so positions stay
      // correct once composition ends and real rebuilds resume.
      if (update.docChanged) this.decorations = this.decorations.map(update.changes);
      return;
    }
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = buildDecorations(update.view);
    }
  }
}

const livePreviewPlugin = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (v) => v.decorations,
});

// ---------------------------------------------------------------------------
// Theme — the decoration classes above, plus the "stop dressing like a code
// editor" chrome from A4-SPEC §5 (prose type, capped measure; no gutter is
// handled by CodeMirrorEditor.tsx simply omitting `lineNumbers()`).

const livePreviewDecorationTheme = EditorView.theme({
  ".cm-lp-h1": { fontSize: "1.5em", fontWeight: "650" },
  ".cm-lp-h2": { fontSize: "1.3em", fontWeight: "650" },
  ".cm-lp-h3": { fontSize: "1.15em", fontWeight: "600" },
  ".cm-lp-h4, .cm-lp-h5, .cm-lp-h6": { fontSize: "1em", fontWeight: "600" },
  ".cm-lp-quote": {
    borderLeft: "3px solid var(--color-accent-light)",
    paddingLeft: "0.75rem",
  },
  ".cm-lp-code-bg": { backgroundColor: "var(--color-bg-soft)" },
  ".cm-lp-fence-mark": { color: "var(--color-fg-dim)" },
  ".cm-lp-code-info": {
    color: "var(--color-fg-dim)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.75em",
    backgroundColor: "var(--color-bg-soft)",
    borderRadius: "var(--radius-sm)",
    padding: "0 0.4em",
  },
  ".cm-lp-inline-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "1em",
    backgroundColor: "var(--color-bg-soft)",
    borderRadius: "var(--radius-sm)",
    padding: "0 0.25em",
  },
  ".cm-lp-link": { color: "var(--color-accent)", textDecoration: "underline" },
  // Neutral wikilink styling — the editor deliberately has no
  // resolved/unresolved split (A4-SPEC §2/§8); `.wikilink` mirrors
  // WIKILINK_CLASS's value from @openparachute/surface-render so a future
  // shared stylesheet could target the same class both places.
  ".wikilink": { color: "var(--color-accent)", textDecoration: "underline" },
  ".cm-lp-ordered-mark": { color: "var(--color-fg-dim)" },
  ".cm-lp-task-done": { color: "var(--color-fg-dim)" },
  ".cm-lp-bullet": {
    color: "var(--color-fg-dim)",
    display: "inline-block",
    width: "1em",
  },
  ".cm-lp-hr": {
    display: "flex",
    alignItems: "center",
    height: "1.6em", // line-height-locked — no reflow when the line reveals
  },
  ".cm-lp-hr::after": {
    content: '""',
    display: "block",
    width: "100%",
    borderTop: "1px solid var(--color-border)",
  },
  ".cm-lp-embed-chip": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3em",
    backgroundColor: "var(--color-bg-soft)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    padding: "0 0.5em",
    fontSize: "0.9em",
    lineHeight: "1.6",
    color: "var(--color-fg-muted)",
    verticalAlign: "middle",
  },
  // Visual box stays ~1.25rem; the hit area extends to the mandated 2.5rem
  // square via padding, with a matching negative margin so the extra hit
  // area doesn't shift surrounding text (A4-SPEC §4/§6).
  ".cm-lp-checkbox-wrap": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1.25rem",
    height: "1.25rem",
    padding: "0.625rem",
    margin: "-0.625rem 0.4em -0.625rem -0.625rem",
    verticalAlign: "middle",
    cursor: "pointer",
  },
  ".cm-lp-checkbox": {
    width: "1.25rem",
    height: "1.25rem",
    margin: 0,
    cursor: "pointer",
    accentColor: "var(--color-accent)",
  },
});

const livePreviewChromeTheme = EditorView.theme({
  "&": {
    // Mirrors `.prose-note` (styles/index.css): body font stack (inherited
    // there, spelled out here since the editor's base theme otherwise sets
    // mono), same font-size knob so the text-size control keeps working.
    fontFamily: "var(--font-sans)",
    fontSize: "var(--font-size-prose, var(--font-size-editor, 14px))",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-sans)",
    // Line-height stays 1.6 (lensTheme, unchanged) — NOT `.prose-note`'s
    // 1.78; A4-SPEC §5 keeps the editor's own rhythm.
  },
  ".cm-content": {
    maxWidth: "var(--w-prose, 42rem)",
    marginInline: "auto",
    paddingInline: "1rem",
  },
});

/**
 * The live-preview extension bundle — decorations + their theme + the prose
 * chrome. Consumed by `buildExtensions({ livePreview: true })` in
 * CodeMirrorEditor.tsx; a no-op bundle to add, no-op to omit (raw mode keeps
 * today's editor byte-for-byte without it).
 */
export function livePreview(): Extension[] {
  return [livePreviewPlugin, livePreviewDecorationTheme, livePreviewChromeTheme];
}
