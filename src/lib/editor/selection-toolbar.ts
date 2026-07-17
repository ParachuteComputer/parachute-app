import type { EditorState, Extension } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import { EditorView, type Tooltip, showTooltip } from "@codemirror/view";
import { FORMAT_COMMANDS } from "./format-commands";

// POLISH-WAVE PR 5b — the floating selection toolbar. Coarse-pointer only
// (no keyboard muscle memory on touch, and the toolbar sits ABOVE the
// selection so it's never eclipsed by the OS's own callout or the virtual
// keyboard — Craft's own iOS bug list is the checklist here). Desktop stays
// clean and gets the Mod-b/Mod-i/etc. keybindings instead
// (CodeMirrorEditor.tsx).
//
// Read dynamically rather than cached at mount (a hybrid device can gain or
// lose a pointer mid-session) — cheap enough to call on every relevant
// state update.
function isCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

// Every button is a straight call into the shared format-commands module —
// the toolbar never re-implements a wrap/unwrap of its own (review focus
// per POLISH-WAVE PR 5: "every document write goes through the shared
// commands").
function buildToolbarDOM(view: EditorView): HTMLElement {
  const dom = document.createElement("div");
  // `.glass-panel` + `--radius-lg` + `--shadow-lift` — the slash-menu
  // family (STYLE.md's floating-surface pair); `.enter-rise` is the PR-1
  // motion vocabulary's entrance for arriving surfaces, reduced-motion
  // gated at the token layer already (no per-callsite guard needed).
  dom.className =
    "cm-format-toolbar enter-rise glass-panel flex items-center gap-1 rounded-lg border border-border p-1 shadow-lift";
  for (const cmd of FORMAT_COMMANDS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "focus-ring flex items-center justify-center rounded-md text-sm font-medium text-fg transition-colors duration-(--dur-quick) ease-out hover:bg-bg-soft";
    btn.textContent = cmd.glyph;
    btn.setAttribute("aria-label", cmd.label);
    // Mirrors the checkbox widget's pointerdown containment
    // (live-preview.ts:81): a tap on a toolbar button must never be read as
    // a click INSIDE the editor content, which would collapse/move the
    // very selection this command is about to act on.
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    btn.addEventListener("pointerdown", stop);
    btn.addEventListener("mousedown", stop);
    btn.addEventListener("click", (e) => {
      stop(e);
      cmd.run(view);
      view.focus();
    });
    dom.appendChild(btn);
  }
  return dom;
}

function toolbarTooltip(state: EditorState): Tooltip | null {
  if (!isCoarsePointer()) return null;
  const sel = state.selection.main;
  if (sel.empty) return null;
  return {
    pos: sel.from,
    end: sel.to,
    above: true, // CM auto-flips/clamps on screen edges when there's no room
    create: (view) => ({ dom: buildToolbarDOM(view) }),
  };
}

const selectionToolbarField = StateField.define<Tooltip | null>({
  create: toolbarTooltip,
  update(tooltip, tr) {
    if (!tr.docChanged && !tr.selection) return tooltip;
    return toolbarTooltip(tr.state);
  },
  provide: (f) => showTooltip.from(f),
});

// Resets CM6's baseTheme border/background on `.cm-tooltip` (light: #bbb
// border + #f5f5f5 fill; dark: #333338 fill) so only `.glass-panel` paints
// this tooltip — same pattern as `slashMenuTheme`'s
// `.cm-tooltip.cm-tooltip-autocomplete` override in CodeMirrorEditor.tsx.
// Button touch-target sizing lives here too (not as a Tailwind utility
// class) so it's the same CM-injected-stylesheet mechanism the checkbox's
// ≥2.5rem hit area is asserted against (live-preview.test.ts's "touch
// target" describe block) — Tailwind classes on toolbar buttons wouldn't be
// independently verifiable the same way.
const formatToolbarTheme = EditorView.theme({
  ".cm-tooltip.cm-format-toolbar": {
    border: "none",
    backgroundColor: "transparent",
  },
  ".cm-format-toolbar button": {
    minWidth: "2.5rem", // ≥40px touch targets, POLISH-WAVE PR 5b
    minHeight: "2.5rem",
  },
});

export function selectionToolbar(): Extension {
  return [selectionToolbarField, formatToolbarTheme];
}
