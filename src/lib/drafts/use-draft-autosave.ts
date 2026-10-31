/**
 * Debounced local-draft autosave for an editor.
 *
 * Mirrors the editor `body` to localStorage (per vault + scope) a short beat
 * after typing stops, so an accidental navigation, tab close, or crash before
 * an explicit save doesn't lose the text. It is deliberately debounced-only
 * (no server write): the caller ends the draft through the returned `saved`
 * (after a successful save) or `discard` (an explicit discard).
 *
 *   - `enabled` false → the draft is cleared (nothing worth keeping).
 *   - page hide / tab background → flush immediately, because a backgrounded
 *     PWA or a killed tab never runs React unmount — the exact crash case this
 *     guards against.
 *   - `saved` / `discard` also cancel the pending debounced write and stop
 *     this editor from persisting that body again. Navigation runs in a
 *     transition and the destination routes are lazy, so the editor can stay
 *     mounted past the debounce after it navigates; without this the armed
 *     timer wrote the just-saved text back as a draft (T-318 snags2).
 *     Editing the body again re-arms autosave.
 */

import { useEffect, useMemo, useRef } from "react";
import { type DraftBody, clearDraft, clearSavedDraft, saveDraft } from "./store";

export interface DraftAutosave {
  /** Persist the current body now (if enabled) — for same-tick route hops. */
  flush(): void;
  /** The body was saved; the save was sent at `startedAt` (ISO). Safe to call
   * after unmount, from a save that resolves late. */
  saved(body: DraftBody, startedAt: string): void;
  /** The user threw the current body away. */
  discard(): void;
}

export function useDraftAutosave(
  vaultId: string | null,
  scope: string | null,
  body: DraftBody,
  enabled: boolean,
  delayMs = 600,
): DraftAutosave {
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const keyRef = useRef({ vaultId, scope });
  keyRef.current = { vaultId, scope };
  const timerRef = useRef<number | null>(null);
  // Signature of a body that was saved or discarded: never persisted again.
  const settledRef = useRef<string | null>(null);

  // Depend on the VALUE signature, not the (per-render-fresh) body identity, so
  // the debounce timer only re-arms when the content actually changes.
  const sig = useMemo(() => JSON.stringify(body), [body]);

  const controls = useMemo<DraftAutosave>(() => {
    const persist = () => {
      const { vaultId: v, scope: s } = keyRef.current;
      if (!v || !s || !enabledRef.current) return;
      if (JSON.stringify(bodyRef.current) === settledRef.current) return;
      saveDraft(v, s, bodyRef.current);
    };
    const settle = (settledBody: DraftBody) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      settledRef.current = JSON.stringify(settledBody);
    };
    return {
      flush: persist,
      saved(savedBody, startedAt) {
        settle(savedBody);
        const { vaultId: v, scope: s } = keyRef.current;
        if (v && s) clearSavedDraft(v, s, savedBody, startedAt);
      },
      discard() {
        settle(bodyRef.current);
        const { vaultId: v, scope: s } = keyRef.current;
        if (v && s) clearDraft(v, s);
      },
    };
  }, []);

  useEffect(() => {
    if (!vaultId || !scope) return;
    if (!enabled) {
      clearDraft(vaultId, scope);
      return;
    }
    if (sig === settledRef.current) return;
    const timer = window.setTimeout(controls.flush, delayMs);
    timerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (timerRef.current === timer) timerRef.current = null;
    };
  }, [sig, enabled, vaultId, scope, delayMs, controls]);

  useEffect(() => {
    if (!vaultId || !scope) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") controls.flush();
    };
    window.addEventListener("pagehide", controls.flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", controls.flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [vaultId, scope, controls]);

  return controls;
}
