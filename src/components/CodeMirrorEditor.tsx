import { insertHardOrPlainBreak, insertParagraphBreak } from "@/lib/editor/paragraph-break";
import { createSlashCompletionSource } from "@/lib/editor/slash-completion";
import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
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

const lensTheme = EditorView.theme({
  "&": {
    fontFamily: "var(--font-mono)",
    // Reads from the text-size knob (lib/text-size.ts → styles/index.css)
    // so editor scales together with the markdown preview. Falls back to
    // 14px on legacy stylesheets that pre-date the variable.
    fontSize: "var(--font-size-editor, 14px)",
    backgroundColor: "var(--color-card)",
    color: "var(--color-fg)",
    height: "100%",
  },
  ".cm-content": {
    padding: "1rem 0",
    caretColor: "var(--color-accent)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.6",
  },
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
}

interface ExtensionRefs {
  onChangeRef: MutableRefObject<Props["onChange"]>;
  onSaveRef: MutableRefObject<Props["onSave"]>;
  onCancelRef: MutableRefObject<Props["onCancel"]>;
  onPasteFileRef: MutableRefObject<Props["onPasteFile"]>;
  onRequestAttachmentRef: MutableRefObject<Props["onRequestAttachment"]>;
}

// Pulled out of the mount effect so it's independently testable against a
// real (non-React) EditorView — trigger behavior and keymap precedence
// (the Esc-closes-menu-first layering) are exercised against this exact
// wiring, not a re-description of it, in CodeMirrorEditor.slash-menu.test.ts.
export function buildExtensions({
  onChangeRef,
  onSaveRef,
  onCancelRef,
  onPasteFileRef,
  onRequestAttachmentRef,
}: ExtensionRefs) {
  return [
    history(),
    lineNumbers(),
    markdown(),
    syntaxHighlighting(lensHighlight),
    lensTheme,
    slashMenuTheme,
    autocompletion({
      // The ONLY completion source in this editor — see
      // createSlashCompletionSource's own comment for why that's safe to
      // rely on (it's a no-op outside its own trigger).
      override: [createSlashCompletionSource(() => onRequestAttachmentRef.current?.())],
    }),
    EditorView.lineWrapping,
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
  { value, onChange, onSave, onCancel, onPasteFile, onRequestAttachment },
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
      extensions: buildExtensions({
        onChangeRef,
        onSaveRef,
        onCancelRef,
        onPasteFileRef,
        onRequestAttachmentRef,
      }),
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
