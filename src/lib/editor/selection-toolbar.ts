import type { Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { FORMAT_COMMANDS } from "./format-commands";

// POLISH 0.20.14 — the mobile formatting bar now DOCKS to the bottom of the
// visual viewport instead of floating at the selection. The 0.20.13 floating
// tooltip collided with the OS's own text-selection callout (Android renders
// Copy / Select all directly over it, iOS the loupe/handles), leaving ours
// untappable. Docking a fixed bar above the keyboard is the Google Docs /
// Notion / Bear pattern for exactly this. Coarse-pointer (touch) only —
// desktop stays clean and drives formatting from the Mod-b/Mod-i/… keymap
// (CodeMirrorEditor.tsx), unchanged; on desktop this plugin builds nothing.
//
// Pointer type is read dynamically (a hybrid device can gain or lose a
// pointer mid-session) rather than cached at mount — cheap on the relevant
// state updates.
function isCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

// Every button is a straight call into the shared format-commands module —
// the bar never re-implements a wrap/unwrap of its own (the wave charter's
// "every document write goes through the shared commands"). One source of
// truth for id/label/glyph/command is FORMAT_COMMANDS.
function buildBar(view: EditorView): HTMLElement {
  const bar = document.createElement("div");
  // `.glass-panel` for the translucent-cream-over-blur surface (the same
  // token the rail / palette / sticky headers use); `.cm-format-toolbar-docked`
  // (styles/index.css) carries layout, border, safe-area inset and the
  // entrance. Structural position/bottom/z are set inline below so the bar
  // is correctly placed regardless of stylesheet load order, and so
  // `reposition()` can track the visual viewport as the keyboard moves.
  bar.className = "cm-format-toolbar glass-panel cm-format-toolbar-docked";
  bar.style.position = "fixed";
  bar.style.left = "0";
  bar.style.right = "0";
  bar.style.bottom = "0";
  bar.style.zIndex = "40"; // above page content + bottom tabs; below modal dialogs (z-50)
  for (const cmd of FORMAT_COMMANDS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "focus-ring flex items-center justify-center rounded-md text-sm font-medium text-fg transition-colors duration-(--dur-quick) ease-out hover:bg-bg-soft";
    // ≥40px touch targets set inline (not only via a class) so the invariant
    // holds in production AND stays independently assertable in jsdom, where
    // styles/index.css isn't loaded and — now that the bar lives in
    // document.body — an EditorView.theme stylesheet wouldn't reach it either.
    btn.style.minWidth = "2.5rem";
    btn.style.minHeight = "2.5rem";
    btn.textContent = cmd.glyph;
    btn.setAttribute("aria-label", cmd.label);
    // The bar sits OUTSIDE the editor's DOM (in document.body), so a tap must
    // not be allowed to blur the editor or collapse the very selection it's
    // about to format — preventing the default focus/selection change on
    // pointerdown/mousedown matters even more here than it did for the old
    // in-editor tooltip. Mirrors the checkbox widget's containment
    // (live-preview.ts:81).
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
    bar.appendChild(btn);
  }
  return bar;
}

// A ViewPlugin (not a tooltip StateField) so we own a plain fixed-position
// DOM node in document.body — the only reliable containing block for
// `position: fixed` (an ancestor with a lingering `.enter-rise`/`.fade-up`
// transform would otherwise capture it). Shows when a non-empty selection
// exists on a coarse pointer; hides the moment it collapses.
class DockedSelectionToolbar {
  private bar: HTMLElement | null = null;
  private readonly vv: VisualViewport | null =
    typeof window !== "undefined" ? window.visualViewport : null;
  private readonly onViewportChange = () => this.reposition();

  constructor(private readonly view: EditorView) {
    this.sync();
  }

  update(u: ViewUpdate) {
    if (u.selectionSet || u.docChanged || u.focusChanged) {
      this.sync();
    } else if (u.geometryChanged && this.bar && this.bar.style.display !== "none") {
      this.reposition();
    }
  }

  private sync() {
    const show = isCoarsePointer() && !this.view.state.selection.main.empty;
    if (!show) {
      if (this.bar) this.bar.style.display = "none";
      return;
    }
    const bar = this.bar ?? this.mount();
    bar.style.display = "";
    this.reposition();
  }

  // Lazily built on first show: desktop (fine pointer) never mounts a node,
  // and a hybrid device only pays for it once it actually surfaces a bar.
  private mount(): HTMLElement {
    const bar = buildBar(this.view);
    this.bar = bar;
    document.body.appendChild(bar);
    if (this.vv) {
      this.vv.addEventListener("resize", this.onViewportChange);
      this.vv.addEventListener("scroll", this.onViewportChange);
    }
    return bar;
  }

  private reposition() {
    if (!this.bar) return;
    if (this.vv && typeof window !== "undefined") {
      // Pin to the bottom of the VISUAL viewport so the bar rides directly
      // above the virtual keyboard when it's open (and rests at the screen
      // bottom when it's closed). The gap between the layout-viewport bottom
      // and the visual-viewport bottom is exactly the keyboard's height (plus
      // any pinch-zoom offset) — set `bottom` to that gap.
      const gap = Math.max(0, window.innerHeight - this.vv.height - this.vv.offsetTop);
      this.bar.style.bottom = `${gap}px`;
    } else {
      this.bar.style.bottom = "0px";
    }
  }

  destroy() {
    if (this.vv) {
      this.vv.removeEventListener("resize", this.onViewportChange);
      this.vv.removeEventListener("scroll", this.onViewportChange);
    }
    this.bar?.remove();
    this.bar = null;
  }
}

const dockedSelectionToolbar = ViewPlugin.fromClass(DockedSelectionToolbar);

export function selectionToolbar(): Extension {
  return [dockedSelectionToolbar];
}
