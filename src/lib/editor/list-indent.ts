import { indentLess, indentMore } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, StateCommand } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

// POLISH-WAVE PR 5a — "one grammar, three doors": Tab/Shift-Tab, a swipe
// gesture, and (Wave 2's keyboard accessory row, not built in this PR) all
// funnel through @codemirror/commands' own indentMore/indentLess, so there's
// exactly one indentation behavior — the same bytes Tab always produced —
// regardless of which door it came through.

const HORIZONTAL_THRESHOLD = 48; // px, POLISH-WAVE PR 5a

// Reuses the ancestor-walk idiom from paragraph-break.ts's lineContextAt and
// live-preview.ts's tree walks: is `pos` inside a ListItem node? Side `1`
// (forward), not `-1`: unlike lineContextAt's cursor-based "what did I just
// leave" use, this is also called with a LINE-START boundary position
// (swipe-indent's posAtDOM(line) resolves to exactly that boundary) — side
// -1 there would resolve into the PRECEDING line's trailing node instead of
// the swiped line itself. Side 1 is correct for both callers: a cursor
// mid-line (Tab) isn't at a node boundary, so side doesn't change its
// result.
export function isListItemLine(state: EditorState, pos: number): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
  for (; node; node = node.parent) {
    if (node.name === "ListItem") return true;
  }
  return false;
}

// Tab/Shift-Tab — live mode only (CodeMirrorEditor.tsx gates these on
// `livePreviewOn`; raw mode is the power surface, unaffected). Returns
// `false` off a list line so the keymap falls through to native Tab
// behavior untouched — no `preventDefault` stolen outside this command's
// actual scope (see the KeyBinding.preventDefault contract: it applies even
// when `run` returns false, so it's deliberately omitted at the call site).
export const listAwareIndent: StateCommand = ({ state, dispatch }) => {
  if (!isListItemLine(state, state.selection.main.head)) return false;
  return indentMore({ state, dispatch });
};

export const listAwareOutdent: StateCommand = ({ state, dispatch }) => {
  if (!isListItemLine(state, state.selection.main.head)) return false;
  return indentLess({ state, dispatch });
};

type SwipeDecision = "pending" | "swipe" | "scroll";

// 5b — pointer/touch handlers, live-preview mode only (raw mode already has
// Tab; a swipe over visible raw markdown has no obvious visual target).
// Mouse pointers are ignored — desktop has Tab/Shift-Tab and the toolbar.
export function swipeIndent(): Extension {
  let tracking = false;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startPos: number | null = null;
  let decision: SwipeDecision = "pending";

  function reset() {
    tracking = false;
    pointerId = null;
    startPos = null;
    decision = "pending";
  }

  return EditorView.domEventHandlers({
    pointerdown(event, view) {
      if (event.pointerType === "mouse") return false;
      let pos: number;
      try {
        pos = view.posAtDOM(event.target as Node);
      } catch {
        return false;
      }
      if (!isListItemLine(view.state, pos)) return false;
      // Mirrors the checkbox widget's pointerdown containment
      // (live-preview.ts:81): claim the gesture now so CM's own
      // click-to-place-cursor never fires for what MIGHT be a swipe — a
      // plain tap that never crosses the threshold gets replayed manually
      // in pointerup below, so tapping a list line still works normally.
      tracking = true;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startPos = pos;
      decision = "pending";
      return true;
    },
    pointermove(event) {
      if (!tracking || event.pointerId !== pointerId) return false;
      if (decision !== "pending") return decision === "swipe";
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) < HORIZONTAL_THRESHOLD && Math.abs(dy) < HORIZONTAL_THRESHOLD) {
        return false; // not enough movement yet to judge — never claim during the ambiguous window
      }
      // Vertical scroll must win ties: only a clearly horizontal-dominant
      // drag past the threshold counts as a swipe; anything else hands
      // control back to the browser's native scroll, never having blocked
      // a single pointermove up to this point.
      decision =
        Math.abs(dx) >= HORIZONTAL_THRESHOLD && Math.abs(dx) > 2 * Math.abs(dy)
          ? "swipe"
          : "scroll";
      return decision === "swipe";
    },
    pointerup(event, view) {
      if (!tracking || event.pointerId !== pointerId) {
        reset();
        return false;
      }
      const dx = event.clientX - startX;
      let handled = false;
      if (decision === "swipe" && startPos != null) {
        handled = true;
        // IME safety (never dispatch mid-composition): if a composition
        // somehow started during this drag, drop the commit silently
        // rather than writing indent markers into a live IME edit.
        if (!view.composing) {
          view.dispatch({ selection: { anchor: startPos } });
          (dx > 0 ? indentMore : indentLess)(view);
        }
      } else if (decision === "pending" && startPos != null) {
        // Never crossed the swipe threshold — a plain tap. We claimed the
        // gesture at pointerdown, so we owe this tap CM's own normal
        // behavior: place the cursor there (which is what reveals the
        // line under live-preview's invariant 2).
        handled = true;
        if (!view.composing) view.dispatch({ selection: { anchor: startPos } });
      }
      // decision === "scroll": nothing to do — every pointermove from the
      // moment we decided returned false, so native scroll already owns
      // the rest of this gesture untouched.
      reset();
      return handled;
    },
    pointercancel() {
      reset();
      return false;
    },
  });
}
