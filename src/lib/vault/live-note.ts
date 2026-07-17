/**
 * Single-note live subscription — the open note view's real-time bridge.
 *
 * The list hooks (`useNotes`, `useNotesForDateViews`) get live updates off
 * vault's live-query WebSocket via `live-query.ts` (the SDK's `createLiveList`
 * mirrored into a list-shaped cache). The single-note cache `["note", …]` had
 * no such bridge: a voice note's transcript (or its failure marker) is written
 * server-side by REWRITING THE NOTE BODY through the standard note-update
 * layer, which broadcasts an `upsert{note}` to any subscriber whose query
 * matches — but nothing on the note-view side subscribed. So the transcript
 * only appeared on a manual refresh.
 *
 * This hook opens ONE subscription per open note, scoped to that note by its
 * server `path` (an exact-match query — subscribable; vault re-evaluates the
 * query against every changed note and re-broadcasts to matching subscribers).
 * On any `upsert`/`remove` for the note it INVALIDATES the single-note cache
 * rather than writing the event's note through: the view fetches
 * `includeAttachments` + `includeLinks` (`useNote`), and the live event's note
 * is list-shaped (no attachments), so an invalidate + refetch is both simpler
 * and strictly more correct than a surgical cache-write — the refetch pulls
 * the fresh body AND the fresh attachment `transcribe_status` the chip reads.
 *
 * ## Why invalidate on the DELTAS only (not the snapshot)
 *
 * The initial snapshot mirrors what `useNote` already fetched — invalidating on
 * it would double-fetch every note open for no new data. A reconnect re-delivers
 * a snapshot rather than the deltas missed while disconnected; that gap is
 * covered by the pending-state poll fallback in `useNote` (the safety net —
 * sockets drop, the poll guarantees eventual convergence). So the socket path
 * handles the common live case (upsert while open) and the poll handles the
 * drop/reconnect case — belt and suspenders, no double-fetch on mount.
 *
 * Reconnection + backoff + token-refresh are the SDK's job
 * (`VaultClient.subscribe`); this hook only opens/tears-down and invalidates.
 */

import { isLocalId } from "@/lib/sync/id-map";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { VaultClient } from "./client";
import { useActiveVaultClient } from "./queries";
import { useVaultStore } from "./store";
import type { Note } from "./types";

export interface UseLiveNoteResult {
  /** True only while the stream is OPEN. Observability parity with the list hook. */
  isLive: boolean;
}

/**
 * Subscribe to live updates for a single open note and invalidate its
 * `["note", vaultId, cacheId]` cache on any change.
 *
 * @param cacheId The route id `useNote` is keyed on (the exact cache-key id —
 *   a local id before it resolves, the server id / path after). Invalidation
 *   targets this so the companion `useNote` refetches.
 * @param note The currently-loaded note (from `useNote(...).data`). The
 *   subscription is scoped to `note.path`; the hook is inert until a resolved
 *   server note with a path is available (a local/optimistic note has nothing
 *   to subscribe to — the local-id bridge poll covers that window).
 */
export function useLiveNote(
  cacheId: string | undefined,
  note: Note | null | undefined,
): UseLiveNoteResult {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const queryClient = useQueryClient();
  const [isLive, setIsLive] = useState(false);

  // Subscribe by the note's server path (exact match). Only once we have a
  // resolved server note with a path — a still-local optimistic note isn't on
  // the server to subscribe to yet.
  const path = note && !isLocalPlaceholder(note) ? note.path : undefined;

  useEffect(() => {
    setIsLive(false);
    if (!client || !activeId || !cacheId || !path) return;

    let active = true;
    const invalidate = () => {
      if (!active) return;
      queryClient.invalidateQueries({ queryKey: ["note", activeId, cacheId] });
    };

    const unsubscribe = subscribeToNotePath(client, path, {
      onUpsert: invalidate,
      onRemove: invalidate,
      onStatus: (status) => {
        if (active) setIsLive(status === "open");
      },
    });

    return () => {
      active = false;
      setIsLive(false);
      unsubscribe();
    };
  }, [client, activeId, cacheId, path, queryClient]);

  return { isLive };
}

// A note whose own id is still a local (unsynced) id has no server row to
// subscribe to — the same predicate the sync layer uses.
function isLocalPlaceholder(note: Note): boolean {
  return isLocalId(note.id);
}

interface NotePathHandlers {
  onUpsert: () => void;
  onRemove: () => void;
  onStatus: (status: "connecting" | "open" | "reconnecting" | "closed") => void;
}

/**
 * Thin wrapper over `client.subscribe` for a single note matched by exact
 * path. Factored out so the hook body stays about lifecycle + invalidation and
 * so tests can drive the handlers directly (mirrors `live-query.test.tsx`).
 */
function subscribeToNotePath(
  client: VaultClient,
  path: string,
  handlers: NotePathHandlers,
): () => void {
  return client.subscribe(
    { path },
    {
      // The snapshot mirrors what useNote already has — see the module header
      // for why we don't invalidate on it.
      onSnapshot: () => {},
      onUpsert: () => handlers.onUpsert(),
      onRemove: () => handlers.onRemove(),
      onStatus: handlers.onStatus,
    },
  );
}
