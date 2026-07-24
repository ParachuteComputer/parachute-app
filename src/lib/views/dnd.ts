import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useRef, useState } from "react";

// Desktop drag (views train E) — the shared drag-source / drop-target pair the
// board + calendar lenses use. Native HTML5 DnD, no library: the touch path is
// tap-to-move (the shipped Move menu), the keyboard/SR path is that menu's
// `role="menu"`, so drag only serves desktop pointers — a dependency would buy
// nothing (D6). Drag is an ADDITIONAL affordance over the same write: a drop
// funnels into the exact `useViewFieldWrite` call tap-to-move makes.
//
// Anatomy:
//   - `useNoteDragSource(noteId)` — spread `sourceProps` on the drag wrapper
//     (NOT the navigating anchor; see the click-suppression note below). On a
//     non-fine-pointer device it returns EMPTY props, so touch markup and
//     behavior stay byte-identical.
//   - `useNoteDropTarget(onDropNote)` — spread `targetProps` on a lane/day
//     cell; `isOver` drives the hover affordance. Foreign drags (a file, a
//     text selection — anything without our MIME type) are ignored entirely:
//     no hover state, no drop.
//   - `useDropHandlerRegistry` — routes a drop (which lands on a LANE/DAY)
//     back to the dragged NOTE's own write hook. `useViewFieldWrite` is bound
//     per note (baseline `updatedAt`, title for toasts), so each rendered
//     card/chip registers its receive-drop handler under its note id and the
//     target dispatches into it.

/**
 * The custom MIME type a note drag carries. Drop targets accept ONLY this
 * type, so foreign drags (files, text, another app's payload) never trigger
 * hover affordances or writes; conversely, dropping a note into a foreign
 * target (a text editor) inserts nothing.
 */
export const NOTE_DRAG_MIME = "application/x-parachute-note";

/**
 * True when the device's primary pointer is fine (mouse/trackpad) — the only
 * devices drag serves. Defaults to `false` when `matchMedia` is unavailable
 * (jsdom, SSR): no drag affordance rather than a wrong one.
 */
export function isFinePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: fine)").matches;
}

/** Stamp a drag's payload: the note id under our MIME type, move semantics. */
export function setNoteDragData(dt: DataTransfer, noteId: string): void {
  dt.setData(NOTE_DRAG_MIME, noteId);
  dt.effectAllowed = "move";
}

/**
 * Whether a drag carries a note. Reads `types`, not the data — during
 * dragenter/dragover the drag data store is in protected mode (`getData`
 * returns `""`), but the type list is always readable.
 */
export function hasNoteDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  return Array.from(dt.types ?? []).includes(NOTE_DRAG_MIME);
}

/** The dragged note's id, readable at drop time; `null` when absent/foreign. */
export function readNoteDragId(dt: DataTransfer | null): string | null {
  if (!dt) return null;
  const id = dt.getData(NOTE_DRAG_MIME);
  return id === "" ? null : id;
}

export interface NoteDragSourceProps {
  draggable?: boolean;
  onDragStart?: (e: ReactDragEvent) => void;
  onDragEnd?: (e: ReactDragEvent) => void;
  onClickCapture?: (e: ReactMouseEvent) => void;
}

export interface NoteDragSource {
  /** True when this device gets the drag affordance (fine primary pointer). */
  canDrag: boolean;
  /**
   * Spread on the drag WRAPPER — never on a navigating anchor. Anchors
   * natively drag (their href), so the anchor inside gets `draggable={false}`
   * and the wrapper owns the drag; `onClickCapture` here swallows the click
   * some browsers fire after dragend, so a drop never doubles as a
   * navigation. Empty when `canDrag` is false — spreading changes nothing.
   */
  sourceProps: NoteDragSourceProps;
}

/**
 * Make the wrapping element a drag source carrying `noteId`. Pointer-gated at
 * mount: on touch devices this renders NO draggable attribute and NO handlers,
 * keeping the shipped tap path untouched.
 */
export function useNoteDragSource(noteId: string): NoteDragSource {
  // Sampled once at mount — pointer class doesn't change mid-session in any
  // scenario worth re-rendering every card for.
  const [canDrag] = useState(isFinePointer);
  // True from dragstart until just after dragend — the window in which a
  // click arriving at the wrapper is the drag's residue, not an intent.
  const justDragged = useRef(false);

  const onDragStart = useCallback(
    (e: ReactDragEvent) => {
      if (!e.dataTransfer) return;
      setNoteDragData(e.dataTransfer, noteId);
      justDragged.current = true;
    },
    [noteId],
  );

  const onDragEnd = useCallback(() => {
    // Clear on a macrotask: the residue click (when a browser fires one) is
    // dispatched before timers run, so it's caught; the NEXT real click isn't.
    window.setTimeout(() => {
      justDragged.current = false;
    }, 0);
  }, []);

  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (!justDragged.current) return;
    e.preventDefault();
    e.stopPropagation();
    justDragged.current = false;
  }, []);

  if (!canDrag) return { canDrag: false, sourceProps: {} };
  return {
    canDrag: true,
    sourceProps: { draggable: true, onDragStart, onDragEnd, onClickCapture },
  };
}

export interface NoteDropTargetProps {
  onDragEnter: (e: ReactDragEvent) => void;
  onDragOver: (e: ReactDragEvent) => void;
  onDragLeave: (e: ReactDragEvent) => void;
  onDrop: (e: ReactDragEvent) => void;
}

export interface NoteDropTarget {
  /** A note drag is hovering this target — drive the hover outline with it. */
  isOver: boolean;
  /** Spread on the drop-zone element. Inert unless a NOTE drag is over it. */
  targetProps: NoteDropTargetProps;
}

/**
 * Make an element a drop zone for note drags. `onDropNote` receives the
 * dragged note's id. Hover state counts enter/leave depth (dragleave fires on
 * every child boundary), so `isOver` holds while moving across the target's
 * children and clears when the drag truly exits.
 */
export function useNoteDropTarget(onDropNote: (noteId: string) => void): NoteDropTarget {
  const [isOver, setIsOver] = useState(false);
  const depth = useRef(0);

  const onDragEnter = useCallback((e: ReactDragEvent) => {
    if (!hasNoteDrag(e.dataTransfer)) return;
    e.preventDefault();
    depth.current += 1;
    setIsOver(true);
  }, []);

  const onDragOver = useCallback((e: ReactDragEvent) => {
    if (!hasNoteDrag(e.dataTransfer)) return;
    // preventDefault is what marks the element as a valid drop target.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  }, []);

  const onDragLeave = useCallback((e: ReactDragEvent) => {
    if (!hasNoteDrag(e.dataTransfer)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setIsOver(false);
  }, []);

  const onDrop = useCallback(
    (e: ReactDragEvent) => {
      if (!hasNoteDrag(e.dataTransfer)) return;
      e.preventDefault();
      depth.current = 0;
      setIsOver(false);
      const id = readNoteDragId(e.dataTransfer);
      if (id) onDropNote(id);
    },
    [onDropNote],
  );

  return { isOver, targetProps: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

export interface DropHandlerRegistry<T> {
  /**
   * Register the receive-drop handler for `noteId`; call from an effect and
   * return the cleanup. Identity-guarded: unregistering only removes the
   * handler it registered.
   */
  register: (noteId: string, handler: (payload: T) => void) => () => void;
  /** Route a drop to the dragged note's registered handler (no-op if none). */
  dispatch: (noteId: string, payload: T) => void;
}

/**
 * A per-view routing table from note id → receive-drop handler. Drops land on
 * the TARGET (a lane, a day cell), but the write lives with the SOURCE (the
 * card/chip owns its note-bound `useViewFieldWrite`); the registry connects
 * the two without lifting per-note hooks out of their components. Ref-backed:
 * registration never re-renders the view.
 */
export function useDropHandlerRegistry<T>(): DropHandlerRegistry<T> {
  const handlers = useRef(new Map<string, (payload: T) => void>());

  const register = useCallback((noteId: string, handler: (payload: T) => void) => {
    handlers.current.set(noteId, handler);
    return () => {
      if (handlers.current.get(noteId) === handler) handlers.current.delete(noteId);
    };
  }, []);

  const dispatch = useCallback((noteId: string, payload: T) => {
    handlers.current.get(noteId)?.(payload);
  }, []);

  return { register, dispatch };
}
