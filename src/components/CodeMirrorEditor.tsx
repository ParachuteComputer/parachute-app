import { firstLineTitle } from "@/lib/editor/first-line-title";
import {
  toggleBold,
  toggleCode,
  toggleItalic,
  toggleStrikethrough,
  toggleTodo,
} from "@/lib/editor/format-commands";
import { listAwareIndent, listAwareOutdent, swipeIndent } from "@/lib/editor/list-indent";
import { livePreview } from "@/lib/editor/live-preview";
import { insertHardOrPlainBreak, insertParagraphBreak } from "@/lib/editor/paragraph-break";
import { selectionToolbar } from "@/lib/editor/selection-toolbar";
import { createSlashCompletionSource } from "@/lib/editor/slash-completion";
import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  placeholder as cmPlaceholder,
  keymap,
  lineNumbers,
  scrollPastEnd,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { MutableRefObject } from "react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const lensHighlight = HighlightStyle.define([
  { tag: t.heading, color: "var(--color-fg)", fontWeight: "600" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, color: "var(--color-accent)" },
  { tag: t.url, color: "var(--color-accent)" },
  { tag: t.monospace, color: "var(--color-fg-muted)" },
  { tag: t.meta, color: "var(--color-fg-dim)" },
  { tag: t.quote, color: "var(--color-fg-muted)", fontStyle: "italic" },
]);

// Mode-agnostic chrome only — NO font-family/font-size/inline-padding/
// line-height here. Those are a raw-vs-live TIE, not a shared value (M1
// review finding, extended by the editor-wave-1 delta review to cover
// line-height too): CM6's theme system scopes every rule under a per-theme
// generated class on `.cm-editor`, so two themes setting the SAME selector
// at EQUAL specificity resolve by observed stylesheet order — not by array
// position in buildExtensions, which is what the original single lensTheme
// + a live-only override assumed ("ordered after lensTheme so it wins";
// verified false in a real browser via the review's font-probe.mjs, and
// again for `.cm-scroller` line-height via the delta review's puppeteer
// measurement). The fix is to make the tie impossible: `rawModeTypographyTheme`
// below and `livePreviewChromeTheme` (live-preview.ts) are MUTUALLY
// EXCLUSIVE per buildExtensions' opts fork — one font/padding/line-height
// authority per mode, never two themes competing for the same property.
const lensTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--color-card)",
    color: "var(--color-fg)",
    height: "100%",
  },
  ".cm-content": {
    // Vertical padding is shared — nothing in live mode's own theme sets
    // `paddingBlock`, so this is uncontested regardless of mode. Only the
    // INLINE half is mode-specific (0 in raw, 1rem in live) and lives in
    // each mode's own theme below.
    paddingBlock: "1rem",
    caretColor: "var(--color-accent)",
  },
  // NO `.cm-scroller` lineHeight here — it's mode-specific (1.6 raw / --lh-live
  // live), same M1 tie as font-family/size/padding below. A prior version of
  // this rule DID live here and lost the tie in a real browser (delta review,
  // editor-wave-1 #46): `livePreviewChromeTheme`'s own `--lh-live` override
  // never actually applied, because this shared selector's hardcoded 1.6 won
  // the stylesheet-order race regardless of which theme was declared later.
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--color-fg-dim)",
  },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-fg-muted)" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, ::selection": {
    // `opacity` is invalid on ::selection (and drawSelection isn't loaded, so
    // ::selection is what actually paints) — bake the 30% into the color via an
    // alpha background-color, which IS honored on ::selection. Selected text
    // then sits on a light-coral wash (9.6:1 in both themes) instead of a solid
    // accent-light fill.
    backgroundColor: "color-mix(in srgb, var(--color-accent-light) 30%, transparent) !important",
  },
  // CM6's own empty-doc placeholder widget (opt-in via the `placeholder`
  // prop — see NoteNew's "Start writing…"). A narrow, isolated exception to
  // the "no font-family/font-size here" rule above: it targets ONLY
  // `.cm-placeholder`, a selector neither mode-specific theme below touches,
  // so there's no tie to resolve. Same warm quiet-aside voice as NoteView's
  // empty-body placeholder (serif italic, fg-muted, prose reading size) —
  // a quiet moment should still feel warm, not read as default gray CM chrome.
  ".cm-placeholder": {
    fontFamily: "var(--font-serif)",
    fontStyle: "italic",
    fontSize: "var(--text-lg)",
    color: "var(--color-fg-muted)",
  },
});

// Raw mode's ONLY font/padding authority (mirrors live-preview.ts's
// `livePreviewChromeTheme`, which is live mode's) — included only when
// `!opts.livePreview` in buildExtensions below, so it never shares a
// selector with a live-mode theme at the same specificity. Preserves
// today's editor byte-for-byte: mono, the text-size knob's editor step,
// zero inline padding.
const rawModeTypographyTheme = EditorView.theme({
  "&": {
    fontFamily: "var(--font-mono)",
    // Reads from the text-size knob (lib/text-size.ts → styles/index.css)
    // so editor scales together with the markdown preview. Falls back to
    // 14px on legacy stylesheets that pre-date the variable.
    fontSize: "var(--font-size-editor, 14px)",
  },
  ".cm-content": {
    paddingInline: "0",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    // Raw mode's own line-height authority (mirrors live mode's `--lh-live`
    // in `livePreviewChromeTheme`) — the mono power surface's rhythm,
    // unchanged from before editor-wave-1 (A4-SPEC §5).
    lineHeight: "1.6",
  },
});

// The "/"-command popup. `.cm-tooltip-autocomplete` is CM6's own tooltip —
// its positioning already flips/clamps to stay on-screen (the same job
// TextSizeControl's hand-rolled measure-and-flip does), so there's nothing
// bespoke to reproduce here for the tablet-clipping risk. Styled as a
// `.glass-panel`-family popover (STYLE.md's "command palette" surface) with
// touch-sized rows rather than CM's dense default list styling.
const slashMenuTheme = EditorView.theme({
  ".cm-tooltip.cm-tooltip-autocomplete": {
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    backgroundColor: "color-mix(in srgb, var(--color-bg-soft) 82%, transparent)",
    backdropFilter: "blur(10px)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-lift)",
    padding: "0.25rem",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "inherit",
    maxHeight: "16rem",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    minHeight: "2.5rem",
    justifyContent: "center",
    padding: "0.375rem 0.625rem",
    borderRadius: "var(--radius-md)",
    color: "var(--color-fg)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--color-accent)",
    color: "var(--color-on-accent)",
  },
  ".cm-completionLabel": { fontWeight: "500" },
  ".cm-completionDetail": {
    fontStyle: "normal",
    fontSize: "var(--text-xs)",
    color: "var(--color-fg-dim)",
    marginLeft: "0",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": {
    color: "var(--color-on-accent)",
    opacity: "0.85",
  },
});

export interface CodeMirrorEditorHandle {
  insertAtCursor(text: string): void;
  focus(): void;
}

interface Props {
  value: string;
  onChange(next: string): void;
  onSave?(): void;
  onCancel?(): void;
  onPasteFile?(files: File[]): boolean;
  // Backs the "/"-menu's Image/attachment command. Opens the SAME upload
  // flow as the page's own attachment picker (see NoteEditor/NoteNew) — the
  // caller is expected to trigger that picker's file dialog, not implement
  // a second upload path here.
  onRequestAttachment?(): void;
  // A4-SPEC §7: the Settings-controlled mode. Read ONCE at mount — the
  // editor builds its extension set once per mount; a mode change arrives
  // as a remount (the caller keys the element), not a live prop flip.
  livePreview?: boolean;
  // Optional placeholder text shown when the doc is empty (CM6's own
  // `placeholder()` extension — disappears on first keystroke). Opt-in and
  // read once at mount, same contract as `livePreview`; omitted call sites
  // (NoteEditor, on an existing note) are byte-unchanged.
  placeholder?: string;
}

interface ExtensionRefs {
  onChangeRef: MutableRefObject<Props["onChange"]>;
  onSaveRef: MutableRefObject<Props["onSave"]>;
  onCancelRef: MutableRefObject<Props["onCancel"]>;
  onPasteFileRef: MutableRefObject<Props["onPasteFile"]>;
  onRequestAttachmentRef: MutableRefObject<Props["onRequestAttachment"]>;
}

interface BuildExtensionsOpts {
  // Default false so CodeMirrorEditor.slash-menu.test.ts and every other
  // existing call site are untouched — raw mode stays byte-for-byte
  // today's editor. Live-preview mode is opt-in per A4-SPEC §1.
  livePreview?: boolean;
  // Undefined by default — no placeholder extension added, existing editors
  // unchanged.
  placeholder?: string;
}

// Pulled out of the mount effect so it's independently testable against a
// real (non-React) EditorView — trigger behavior and keymap precedence
// (the Esc-closes-menu-first layering) are exercised against this exact
// wiring, not a re-description of it, in CodeMirrorEditor.slash-menu.test.ts.
export function buildExtensions(
  { onChangeRef, onSaveRef, onCancelRef, onPasteFileRef, onRequestAttachmentRef }: ExtensionRefs,
  opts: BuildExtensionsOpts = {},
) {
  const livePreviewOn = opts.livePreview ?? false;
  return [
    history(),
    ...(opts.placeholder ? [cmPlaceholder(opts.placeholder)] : []),
    // Live preview drops the gutter entirely (A4-SPEC §5) — raw mode keeps
    // it, unchanged.
    ...(livePreviewOn ? [] : [lineNumbers()]),
    // `markdownLanguage` (GFM: Task/TaskMarker, Strikethrough, Table) instead
    // of the bare `markdown()` default (commonmarkLanguage, no GFM nodes) —
    // required by live-preview's decoration inventory, applied in BOTH modes
    // since it only affects parsing/highlight fidelity, not editing behavior.
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(lensHighlight),
    lensTheme,
    // Exactly one font/padding theme per mode (M1 fix) — `livePreview()`
    // bundles `livePreviewChromeTheme` for live mode, `rawModeTypographyTheme`
    // is raw mode's mirror. Never both: a theme-vs-theme tie on the same
    // selector resolves by observed stylesheet order, not array position
    // here, so the only reliable fix is to make the tie impossible.
    ...(livePreviewOn ? livePreview() : [rawModeTypographyTheme]),
    // FIX 3 (0.20.14) — the first non-empty content line renders at title
    // scale (the note's `display_title`), pure decoration, no `# ` written.
    // Mode-agnostic: both raw and live, and it defers to an explicit heading.
    firstLineTitle(),
    slashMenuTheme,
    autocompletion({
      // The ONLY completion source in this editor — see
      // createSlashCompletionSource's own comment for why that's safe to
      // rely on (it's a no-op outside its own trigger).
      override: [createSlashCompletionSource(() => onRequestAttachmentRef.current?.())],
    }),
    // The coarse-pointer-only selection formatting bar (0.20.14: docked to the
    // bottom of the visual viewport above the keyboard, not floated at the
    // selection). Both modes (mode-agnostic UI: raw mode's markdown is just as
    // toggle-able as live mode's), gated internally on
    // `matchMedia("(pointer: coarse)")` so it never shows on desktop, which
    // gets the keybindings below instead.
    selectionToolbar(),
    // PR 5a — swipe-to-indent on list items, live-preview mode only (raw
    // mode already has Tab; a swipe over visible raw markdown has no
    // obvious visual target).
    ...(livePreviewOn ? [swipeIndent()] : []),
    EditorView.lineWrapping,
    // Wave 1 §3.1: scroll-past-end (not typewriter mode — full centering
    // fights virtual-keyboard scroll-into-view on mobile, A4-SPEC's own
    // typing-canvas study). `scrollPastEnd()` is CM6's stock extension so
    // any line can reach the viewport top; `scrollMargins` keeps ~30% of
    // the viewport below the active line whenever CM auto-scrolls to keep
    // the cursor in view, so typing at the bottom of a long note never
    // pins the caret to the floor. Mode-agnostic — both raw and live mode
    // benefit, this is a scroll behavior, not a typography concern.
    scrollPastEnd(),
    EditorView.scrollMargins.of((view) => ({ bottom: view.dom.clientHeight * 0.3 })),
    EditorView.domEventHandlers({
      paste(event) {
        const items = event.clipboardData?.items;
        if (!items) return false;
        const files: File[] = [];
        for (const item of items) {
          if (item.kind === "file") {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
        if (files.length === 0) return false;
        const handled = onPasteFileRef.current?.(files);
        if (handled) {
          event.preventDefault();
          return true;
        }
        return false;
      },
    }),
    keymap.of([
      // Ahead of defaultKeymap so these win the same-precedence race for
      // Enter/Shift-Enter (defaultKeymap binds both to insertNewlineAndIndent —
      // see CodeMirrorEditor.newline.test.ts for the precedence proof). The
      // slash-menu's own Enter-commits-completion binding lives at
      // Prec.highest (inside autocompletion(), below) and is tried before
      // this keymap entirely, so it's never in the race.
      { key: "Enter", run: insertParagraphBreak },
      { key: "Shift-Enter", run: insertHardOrPlainBreak },
      // The shared format-commands module (POLISH-WAVE PR 5 / EDITOR-STUDY
      // §5-6) — both editor modes, same as the selection toolbar's buttons
      // (which call these exact same commands). Today ⌘B does nothing; these
      // are the shortcuts the study calls out as missing, not rebound.
      { key: "Mod-b", preventDefault: true, run: toggleBold },
      { key: "Mod-i", preventDefault: true, run: toggleItalic },
      { key: "Mod-Shift-x", preventDefault: true, run: toggleStrikethrough },
      { key: "Mod-e", preventDefault: true, run: toggleCode },
      { key: "Mod-Enter", preventDefault: true, run: toggleTodo },
      // Tab/Shift-Tab, list-aware, live mode only — `preventDefault` is
      // deliberately omitted: it applies even when `run` returns false (see
      // KeyBinding.preventDefault), and off a list line these must fall
      // through to native Tab behavior untouched, not swallow every Tab
      // press in the editor.
      ...(livePreviewOn
        ? [
            { key: "Tab", run: listAwareIndent },
            { key: "Shift-Tab", run: listAwareOutdent },
          ]
        : []),
      ...defaultKeymap,
      ...historyKeymap,
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
      {
        key: "Escape",
        run: () => {
          onCancelRef.current?.();
          return true;
        },
      },
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChangeRef.current(u.state.doc.toString());
    }),
  ];
}

export const CodeMirrorEditor = forwardRef<CodeMirrorEditorHandle, Props>(function CodeMirrorEditor(
  {
    value,
    onChange,
    onSave,
    onCancel,
    onPasteFile,
    onRequestAttachment,
    livePreview: livePreviewOn,
    placeholder: placeholderText,
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCancelRef = useRef(onCancel);
  const onPasteFileRef = useRef(onPasteFile);
  const onRequestAttachmentRef = useRef(onRequestAttachment);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onCancelRef.current = onCancel;
  onPasteFileRef.current = onPasteFile;
  onRequestAttachmentRef.current = onRequestAttachment;

  useImperativeHandle(
    ref,
    () => ({
      insertAtCursor(text: string) {
        const v = view.current;
        if (!v) return;
        const pos = v.state.selection.main.head;
        v.dispatch({
          changes: { from: pos, insert: text },
          selection: { anchor: pos + text.length },
        });
        v.focus();
      },
      focus() {
        view.current?.focus();
      },
    }),
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: editor builds once; handlers are re-read via refs
  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: buildExtensions(
        {
          onChangeRef,
          onSaveRef,
          onCancelRef,
          onPasteFileRef,
          onRequestAttachmentRef,
        },
        { livePreview: livePreviewOn, placeholder: placeholderText },
      ),
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className="h-full overflow-auto" />;
});
