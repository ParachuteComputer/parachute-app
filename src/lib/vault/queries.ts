import { isMirrorEnabled } from "@/lib/mirror/flag";
import { readNote, readNotesList } from "@/lib/mirror/read";
import { getMirrorTags, mirrorRecordRemove, mirrorRecordUpsert } from "@/lib/mirror/store";
import type { LensDB } from "@/lib/sync/db";
import { isLocalId, newLocalId, resolveNoteId } from "@/lib/sync/id-map";
import { enqueue } from "@/lib/sync/queue";
import { useToastStore } from "@/lib/toast/store";
import { isTranscriptionPending, retryOptimisticNote } from "@/lib/transcription-status";
import { useSync } from "@/providers/SyncProvider";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useAuthHaltStore } from "./auth-halt-store";
import {
  type CreateNotePayload,
  type StorageUploadResult,
  type UpdateNotePayload,
  type UploadProgress,
  VaultClient,
  VaultUnreachableError,
} from "./client";
import { useLiveNotesQuery } from "./live-query";
import { type NoteQueryState, buildNoteQueryParams } from "./note-query";
import { useVaultReachabilityStore } from "./reachability-store";
import { forceRefresh } from "./refresh";
import { loadToken } from "./storage";
import { useVaultStore } from "./store";
import type {
  Note,
  NoteAttachment,
  TagRecord,
  TagSummary,
  TagUpsertPayload,
  TranscriptionCapability,
} from "./types";

export function useActiveVaultClient(): VaultClient | null {
  const vault = useVaultStore((s) => s.getActiveVault());
  const activeId = useVaultStore((s) => s.activeVaultId);
  return useMemo(() => {
    if (!vault || !activeId) return null;
    const token = loadToken(activeId);
    if (!token) return null;
    return new VaultClient({
      vaultUrl: vault.url,
      accessToken: token.accessToken,
      onAuthError: () => forceRefresh(activeId),
      onAuthRevoked: (status) =>
        useAuthHaltStore
          .getState()
          .markHalted(activeId, `Vault rejected the current session (${status}).`),
      onReachability: (signal, reason) =>
        useVaultReachabilityStore.getState().reportSignal(activeId, signal, reason),
    });
  }, [vault, activeId]);
}

// ---------- Mirror read-path (Wave 3, flag-gated) ----------
//
// Local-first reads: when the mirror flag is on, the touched read hooks try the
// network first and fall back to the durable-offline mirror when the vault is
// offline or unreachable, and seed their first render from the mirror so a cold
// launch paints instantly. Every hook reaches these helpers ONLY on the
// `isMirrorEnabled()` branch, so with the flag off the hooks are byte-identical
// to the network-only path that shipped before Wave 3 (`isOffline` /
// `VaultUnreachableError` are hoisted / imported — safe to reference here even
// though `isOffline` is defined lower in the file).

// Network-first, mirror-fallback for a LIST query. Offline: skip the network
// and serve the mirror when it can faithfully answer (else fall through so the
// caller's real error surfaces). Online-but-unreachable: try the network, and
// on `VaultUnreachableError` serve the mirror. `readNotesList` returns null for
// a query it can't reproduce faithfully (e.g. `search`), in which case the
// network result/throw stands rather than a divergent list.
async function withMirrorList(
  db: LensDB | null,
  vaultId: string | null,
  params: URLSearchParams,
  online: () => Promise<Note[]>,
): Promise<Note[]> {
  const fromMirror = () =>
    db && vaultId ? readNotesList(db, vaultId, params) : Promise.resolve(null);
  if (db && vaultId && isOffline()) {
    const rows = await fromMirror();
    if (rows) return rows;
  }
  try {
    return await online();
  } catch (err) {
    if (err instanceof VaultUnreachableError) {
      const rows = await fromMirror();
      if (rows) return rows;
    }
    throw err;
  }
}

// Network-first, mirror-fallback for a single NOTE (the view). Always the FULL
// mirror row (`readNote`), never a lean list stub. The `online` closure keeps
// the existing local-id / optimistic-note behavior; the mirror is interposed
// only on the offline / unreachable edges.
async function withMirrorNote(
  db: LensDB | null,
  vaultId: string | null,
  id: string | undefined,
  online: () => Promise<Note | null>,
): Promise<Note | null> {
  const fromMirror = () =>
    db && vaultId && id ? readNote(db, vaultId, id) : Promise.resolve(undefined);
  if (db && vaultId && id && isOffline()) {
    const row = await fromMirror();
    if (row) return row;
  }
  try {
    return await online();
  } catch (err) {
    if (err instanceof VaultUnreachableError) {
      const row = await fromMirror();
      if (row) return row;
    }
    throw err;
  }
}

// Network-first, mirror-fallback for the vault TAG list. The mirror stores the
// `TagSummary[]` (name + count) refreshed on each reconcile sweep — exactly
// `useTags`' shape — so the filter bar keeps working offline. The schema-bearing
// reads (`useTagsWithSchema` / `useTag`) stay network-only: the mirror doesn't
// hold tag schemas.
//
// No completeness gate here (unlike the note LIST reads, which the mirror gates
// on a finished cold hydration): the tag list is written ATOMICALLY — the
// reconcile sweep calls `listTags()` once and persists the WHOLE array in a
// single `setMirrorTags`, and the sweep runs only AFTER a clean drain
// (`maybeSweep`). So `getMirrorTags` returns either `undefined` (nothing written
// yet → this helper falls through to the network) or the COMPLETE tag set, never
// a mid-hydration partial. There's no shifting-subset hazard to gate against.
async function withMirrorTags(
  db: LensDB | null,
  vaultId: string | null,
  online: () => Promise<TagSummary[]>,
): Promise<TagSummary[]> {
  const fromMirror = () =>
    db && vaultId ? getMirrorTags(db, vaultId) : Promise.resolve(undefined);
  if (db && vaultId && isOffline()) {
    const tags = await fromMirror();
    if (tags) return tags;
  }
  try {
    return await online();
  } catch (err) {
    if (err instanceof VaultUnreachableError) {
      const tags = await fromMirror();
      if (tags) return tags;
    }
    throw err;
  }
}

// Seed hooks — read the mirror asynchronously on mount and expose the result as
// synchronous state the query renders via `placeholderData`. `placeholderData`
// (unlike `initialData`) is re-read every render until real data lands, so a
// source that resolves a tick after mount still paints. Each returns `undefined`
// until the mirror answers, and stays `undefined` entirely when `enabled` is
// false — so a flag-off hook seeds nothing.
function useMirrorListSeed(
  db: LensDB | null,
  vaultId: string | null,
  params: URLSearchParams,
  enabled: boolean,
): Note[] | undefined {
  const [seed, setSeed] = useState<Note[] | undefined>(undefined);
  const paramsKey = params.toString();
  useEffect(() => {
    if (!enabled || !db || !vaultId) {
      setSeed(undefined);
      return;
    }
    let live = true;
    readNotesList(db, vaultId, new URLSearchParams(paramsKey))
      .then((rows) => {
        if (live && rows) setSeed(rows);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, db, vaultId, paramsKey]);
  return seed;
}

function useMirrorNoteSeed(
  db: LensDB | null,
  vaultId: string | null,
  id: string | undefined,
  enabled: boolean,
): Note | undefined {
  const [seed, setSeed] = useState<Note | undefined>(undefined);
  useEffect(() => {
    // Clear any prior note first so navigating A→B never flashes A as the
    // placeholder for B's query while B's mirror read is in flight.
    setSeed(undefined);
    if (!enabled || !db || !vaultId || !id) return;
    let live = true;
    readNote(db, vaultId, id)
      .then((n) => {
        if (live && n) setSeed(n);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, db, vaultId, id]);
  return seed;
}

function useMirrorTagsSeed(
  db: LensDB | null,
  vaultId: string | null,
  enabled: boolean,
): TagSummary[] | undefined {
  const [seed, setSeed] = useState<TagSummary[] | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !db || !vaultId) {
      setSeed(undefined);
      return;
    }
    let live = true;
    getMirrorTags(db, vaultId)
      .then((tags) => {
        if (live && tags) setSeed(tags);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, db, vaultId]);
  return seed;
}

export function useVaultInfo() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);

  return useQuery({
    queryKey: ["vaultInfo", activeId],
    enabled: !!client,
    queryFn: () => client!.vaultInfo(true),
    staleTime: 30_000,
  });
}

/**
 * The vault's declared voice-transcription capability — what the mic
 * affordance gates on (launch-audit P0-3: free-tier cloud vaults showed
 * "Record voice memo" then landed "_Transcription unavailable._").
 *
 * The two doors declare it in different places (verified 2026-07-03):
 *   - self-host: `GET /api/vault` carries `transcription: { enabled,
 *     provider? }` (vault#529) — already fetched + cached by
 *     `useVaultInfo`, so this leg costs nothing extra.
 *   - cloud: the BARE landing `GET <vaultUrl>` carries `transcription:
 *     { enabled, minutes_remaining }` (cloud#56); cloud's `/api/vault`
 *     does NOT. The fallback probe below fires only when `/api/vault`
 *     resolved WITHOUT the field, and is cached like the rest of vault
 *     config — never a per-render network call.
 *
 * Returns `undefined` while loading or when neither door declares the
 * capability (older self-host vaults) — callers must treat that as
 * "undeclared" and keep the mic (absent ≠ disabled; back-compat).
 */
export function useTranscriptionCapability() {
  return useTranscriptionGate().capability;
}

/**
 * `useTranscriptionCapability` plus a `settled` flag: has the two-leg
 * capability question actually been ANSWERED (both legs resolved — success
 * or error), as opposed to still in flight? Callers that must not act on a
 * pending answer (W2-9's `?voice=1` auto-start: auto-firing the mic before
 * an `enabled: false` resolves would record toward "_Transcription
 * unavailable._") wait on `settled`; a failed fetch settles as `undefined`
 * = undeclared, which stays fail-open exactly like the render gate.
 */
export function useTranscriptionGate(): {
  capability: TranscriptionCapability | undefined;
  settled: boolean;
} {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const info = useVaultInfo();

  // Only probe the bare landing once /api/vault has answered without the
  // field. Older vaults 404/answer without it — `retry: false` keeps the
  // probe to a single attempt per cache window.
  const needsLandingProbe = !!client && info.isSuccess && info.data?.transcription === undefined;
  const landing = useQuery({
    queryKey: ["vaultLanding", activeId],
    enabled: needsLandingProbe,
    queryFn: () => client!.vaultLanding(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const infoSettled = info.isSuccess || info.isError;
  const landingSettled = !needsLandingProbe || landing.isSuccess || landing.isError;

  return {
    capability: info.data?.transcription ?? landing.data?.transcription,
    settled: infoSettled && landingSettled,
  };
}

/**
 * Options for {@link useNotes}.
 */
export interface UseNotesOptions {
  /**
   * Open the live subscription (default true). A live subscription's snapshot
   * is ALWAYS the complete matching set — vault streams every match and the
   * SDK rejects `cursor` outright ("paging is meaningless for a live
   * subscription"). So a `limit` in the query bounds only the REST poll, never
   * the live stream: a paginated surface that leaves live on has its page
   * clobbered by the full set the moment the socket delivers its snapshot
   * (measured on All-notes at 2,606 notes: 2,606 rows in a 330,339px page,
   * both pager buttons dead — app#109). A caller that pages by `offset`
   * (VaultSurface) MUST pass `live: false` so the server-side `limit`/`offset`
   * window is authoritative. Same contract as `useViewResults`' option.
   */
  live?: boolean;
}

export function useNotes(queryState: NoteQueryState, opts?: UseNotesOptions) {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const { db } = useSync();
  const mirrorOn = isMirrorEnabled();
  const live = opts?.live ?? true;

  const queryKey = useMemo(() => ["notes", activeId, queryState], [activeId, queryState]);
  const params = useMemo(() => {
    const p = buildNoteQueryParams(queryState);
    // Lean list shape: this list renders NoteRow (title + preview + tags +
    // provenance), never `note.content`, so ask the vault for the lean frame.
    // The win is on the LIVE subscription — vault#620 makes the subscribe
    // snapshot/upsert ship titles+previews instead of every note's full body
    // when `include_content=false` (default subscribe frame stays full). The
    // REST poll already omits content (vault's list default), so this is a
    // no-op there; against a vault that predates #620 the subscribe ignores the
    // flag and sends full frames, which still render (full is a superset of
    // lean — NoteRow reads displayTitle/preview either way).
    p.set("include_content", "false");
    return p;
  }, [queryState]);

  // Live layer: open a live subscription (WebSocket) for this exact query and
  // reconcile events into the same cache key. When the stream is open + healthy
  // we relax the aggressive 10s staleTime (the stream keeps the cache fresh);
  // on any non-open state we revert to the polling floor below. The hook is a
  // no-op for unsubscribable queries (e.g. `search`) — those stay on polling.
  // See `live-query.ts` for the full fallback guarantee, and `UseNotesOptions`
  // for why a paginated caller must disable this entirely (app#109).
  const { isLive } = useLiveNotesQuery({ queryKey, params, client, enabled: live });
  // Cold-launch seed (flag-gated): render the last-mirrored list instantly
  // while the network revalidates.
  const seed = useMirrorListSeed(db, activeId, params, mirrorOn);

  return useQuery({
    queryKey,
    enabled: !!client,
    queryFn: () =>
      mirrorOn
        ? withMirrorList(db, activeId, params, () => client!.queryNotes(params))
        : client!.queryNotes(params),
    staleTime: isLive ? Number.POSITIVE_INFINITY : 10_000,
    // The polling FLOOR (live is WebSocket-only; there's no SSE fallback — the
    // fallback IS polling). When the live stream is down (old server without
    // the WS binding, WS-blocked network, or a drop) a background interval +
    // refetch-on-focus keep the list fresh within a sane window — not just on
    // mount. Disabled while live: the stream keeps the cache fresher than any
    // interval, and re-enables automatically the moment `isLive` flips false.
    refetchInterval: isLive ? false : 30_000,
    refetchOnWindowFocus: !isLive,
    // Flag on: keep the previous list on filter changes (as before), else fall
    // to the mirror seed on cold launch. Flag off: exactly keepPreviousData.
    placeholderData: mirrorOn ? (prev) => prev ?? seed : keepPreviousData,
    // Flag on: run the queryFn even when navigator.onLine is false so the
    // cold-launch-offline fallback can reach the mirror (default "online" pauses
    // the fetch offline and would render nothing). Flag off: the default.
    networkMode: mirrorOn ? "always" : "online",
  });
}

// Cap on how many notes to pull back for the full-vault graph in v1.
// If a vault grows beyond this, the graph page will show the first N —
// pagination/sampling is a future PR.
export const VAULT_GRAPH_NOTE_CAP = 5000;

// Lightweight variant for the Cmd+K switcher: no links, no content — just
// enough to render a title/path/tags line per entry. Capped at the same N
// as the graph so huge vaults degrade gracefully (pagination is a later PR).
export function useAllNotesForSwitcher(enabled: boolean) {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);

  return useQuery({
    queryKey: ["allNotesForSwitcher", activeId],
    enabled: !!client && enabled,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("include_content", "true");
      // Without an explicit sort, the vault's default is created_at ASC —
      // on a vault past the VAULT_GRAPH_NOTE_CAP, that silently drops the
      // NEWEST notes from the switcher instead of the oldest. `desc` matches
      // the other capped-window queries below (useNotesForDateViews,
      // useNotesForPathTree) so "capped at N" always means "the N most
      // recent," never "the N oldest."
      params.set("sort", "desc");
      params.set("limit", String(VAULT_GRAPH_NOTE_CAP));
      return client!.queryNotes(params);
    },
    staleTime: 60_000,
  });
}

// Fetches a capped window of recent notes (by vault's default sort, desc) for
// date-grouped surfaces like /today and /calendar. The vault has no date-range
// filter, so we client-side bucket. A vault with more than the cap gets the
// most-recent N — older days on the calendar show empty.
export function useNotesForDateViews() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const { db } = useSync();
  const mirrorOn = isMirrorEnabled();

  const queryKey = useMemo(() => ["notesForDateViews", activeId], [activeId]);
  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set("sort", "desc");
    p.set("limit", String(VAULT_GRAPH_NOTE_CAP));
    // Lean list shape — see `useNotes`. Recent / Activity / Calendar render
    // NoteRow (title + preview + tags), never `note.content`, so the live
    // subscription can ship lean frames (vault#620); the REST poll is already
    // content-less by the vault list default.
    p.set("include_content", "false");
    return p;
  }, []);

  // Live layer for Recent / Activity / Calendar — same reconcile-into-cache
  // pattern as `useNotes`. The capped recent-notes window is a plain
  // sort+limit query (subscribable). When live, relax the 60s staleTime; when
  // not, the same polling floor as `useNotes` (interval + focus refetch).
  const { isLive } = useLiveNotesQuery({ queryKey, params, client });
  const seed = useMirrorListSeed(db, activeId, params, mirrorOn);

  return useQuery({
    queryKey,
    enabled: !!client,
    queryFn: () =>
      mirrorOn
        ? withMirrorList(db, activeId, params, () => client!.queryNotes(params))
        : client!.queryNotes(params),
    staleTime: isLive ? Number.POSITIVE_INFINITY : 60_000,
    refetchInterval: isLive ? false : 60_000,
    refetchOnWindowFocus: !isLive,
    // Flag on: cold-launch seed from the mirror (Recent / Calendar paint
    // instantly); flag off: unchanged (no placeholderData).
    placeholderData: mirrorOn ? (prev) => prev ?? seed : undefined,
    networkMode: mirrorOn ? "always" : "online",
  });
}

// Fetches a capped metadata-only window of the vault for the path-tree
// sidebar. We want a stable index of every path so the tree and threshold
// check aren't skewed by whatever filter is currently applied to the main
// list. Capped at VAULT_GRAPH_NOTE_CAP; vaults beyond that get a tree for
// the most-recent N paths (the fallback input on the filter bar still works
// for navigating outside the window).
export function useNotesForPathTree(enabled: boolean) {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const { db } = useSync();
  const mirrorOn = isMirrorEnabled();

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set("sort", "desc");
    p.set("limit", String(VAULT_GRAPH_NOTE_CAP));
    return p;
  }, []);
  const seed = useMirrorListSeed(db, activeId, params, mirrorOn && enabled);

  return useQuery({
    queryKey: ["notesForPathTree", activeId],
    enabled: !!client && enabled,
    queryFn: () =>
      mirrorOn
        ? withMirrorList(db, activeId, params, () => client!.queryNotes(params))
        : client!.queryNotes(params),
    staleTime: 60_000,
    placeholderData: mirrorOn ? (prev) => prev ?? seed : undefined,
    networkMode: mirrorOn ? "always" : "online",
  });
}

export function useAllNotesWithLinks() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);

  return useQuery({
    queryKey: ["allNotesWithLinks", activeId],
    enabled: !!client,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("include_links", "true");
      // Same fix as useAllNotesForSwitcher above: no explicit sort defaults
      // to created_at ASC, which drops the newest notes (not the oldest)
      // off a >VAULT_GRAPH_NOTE_CAP vault's graph.
      params.set("sort", "desc");
      params.set("limit", String(VAULT_GRAPH_NOTE_CAP));
      return client!.queryNotes(params);
    },
    staleTime: 60_000,
  });
}

export function useTags() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const { db } = useSync();
  const mirrorOn = isMirrorEnabled();
  const seed = useMirrorTagsSeed(db, activeId, mirrorOn);

  return useQuery({
    queryKey: ["tags", activeId],
    enabled: !!client,
    queryFn: () =>
      mirrorOn ? withMirrorTags(db, activeId, () => client!.listTags()) : client!.listTags(),
    staleTime: 60_000,
    placeholderData: mirrorOn ? (prev) => prev ?? seed : undefined,
    networkMode: mirrorOn ? "always" : "online",
  });
}

// Same source as `useTags()` but returns the joined TagRecord[] shape with
// description / fields / parent_names / relationships per tag. Vault's
// `GET /api/tags?include_schema=true` returns a single envelope so this is
// one request, not N. Used by the Notes UI tag viewer (notes-ui,
// 2026-05-27 unified create + tag schemas pass) so the row UI can show
// "fields: a, b, c" inline without a waterfall.
//
// Separate hook (not an overload of `useTags`) so the cache key is
// distinct — the cheap listing and the schema-bearing listing are
// different queries with different invalidation lifetimes.
export function useTagsWithSchema() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);

  return useQuery({
    queryKey: ["tags", activeId, "with-schema"],
    enabled: !!client,
    queryFn: () => client!.listTags({ includeSchema: true }),
    staleTime: 60_000,
  });
}

// Single-tag identity row (description, fields, parent_names, relationships).
// Used by the Tags page schema editor (notes-ui, 2026-05-27). VaultClient
// resolves a 404 to `null`, so consumers can treat "no schema yet" as the
// data shape without forking on error.
export function useTag(name: string | null) {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  return useQuery({
    queryKey: ["tag", activeId, name],
    enabled: !!client && !!name,
    queryFn: () => client!.getTag(name!),
    staleTime: 30_000,
  });
}

// Upsert a tag's identity row — description, fields, parent_names. Vault's
// PUT /api/tags/:name is merge-on-write at the row level (omitted keys
// preserved, explicit null clears). The mutation invalidates both the
// single-tag cache and the list so the Tags page UI reflects the change.
//
// Important: vault DOES NOT backfill schemas onto notes already carrying
// the tag. The PUT only touches the tag-identity row; existing notes keep
// whatever metadata shape they already had. The Tags UI surfaces a warning
// to that effect when the operator edits a schema.
export function useUpdateTag() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      name: string;
      payload: TagUpsertPayload;
    }): Promise<TagRecord> => {
      if (!client) throw new Error("No active vault");
      return client.updateTag(args.name, args.payload);
    },
    onSuccess: (rec, args) => {
      qc.setQueryData(["tag", activeId, args.name], rec);
      qc.invalidateQueries({ queryKey: ["tags", activeId] });
    },
  });
}

/**
 * The `useNote` poll cadence — the fallback that guarantees the open-note view
 * converges even when the live socket (`useLiveNote`) is down or absent. Two
 * polls, one predicate (pure so it's unit-testable without timers):
 *
 *   1. Local-id bridge (2s): while `id` is still a local id that hasn't
 *      resolved to a server note, poll so the view flips to the real note once
 *      the `create-note` row drains and the id-map fills. Preserved exactly
 *      from the original predicate.
 *   2. Pending-transcription (4s): once resolved (or when opened directly on a
 *      server note), keep polling while the note's own transcription is in a
 *      non-terminal state (`_Transcript pending._` / the attachment's
 *      `transcribe_status: "pending"`), so the transcript — or the
 *      failure/limit marker — lands without a manual refresh. Stops on any
 *      terminal state (done / failed / voice-limit).
 *
 * Returns the interval in ms, or `false` to stop polling.
 */
export function noteRefetchInterval(
  id: string | undefined,
  data: Note | undefined,
): number | false {
  // Local-id bridge: poll until the local id resolves to a server note, then
  // fall through to the pending check on the resolved note.
  if (id && isLocalId(id) && !(data && !isLocalId(data.id))) return 2_000;
  if (data && isTranscriptionPending(data)) return 4_000;
  return false;
}

export function useNote(id: string | undefined) {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const { db } = useSync();
  const qc = useQueryClient();
  const mirrorOn = isMirrorEnabled();
  // Cold-launch seed: the FULL mirror row (never a lean stub), so opening a note
  // offline / on first paint shows real content, not a placeholder.
  const seed = useMirrorNoteSeed(db, activeId, id, mirrorOn);

  return useQuery({
    queryKey: ["note", activeId, id],
    enabled: !!client && !!id,
    queryFn: () => {
      const online = async (): Promise<Note | null> => {
        // Offline-created notes (a voice or text capture made while offline)
        // navigate to `/n/<localId>` before their `create-note` row drains.
        // `getNote(localId)` would 404, so resolve the local id to its server id
        // via the sync id-map first. Until the row drains (no mapping yet), serve
        // the optimistic note the capture flow seeded into the cache — the
        // capture must land on a readable note, not an error screen.
        if (id && isLocalId(id)) {
          const realId = db && activeId ? await resolveNoteId(db, id, activeId) : null;
          if (!realId) {
            const optimistic = qc.getQueryData<Note>(["note", activeId, id]);
            if (optimistic) return optimistic;
            throw new Error("This note is still syncing — try again in a moment.");
          }
          return client!.getNote(realId, { includeLinks: true, includeAttachments: true });
        }
        return client!.getNote(id!, { includeLinks: true, includeAttachments: true });
      };
      return mirrorOn ? withMirrorNote(db, activeId, id, online) : online();
    },
    // See `noteRefetchInterval` — the two-poll fallback (local-id bridge +
    // pending-transcription) that converges the note view even when the live
    // socket (`useLiveNote`) is down or absent.
    refetchInterval: (query) => noteRefetchInterval(id, query.state.data as Note | undefined),
    staleTime: 10_000,
    // Flag on: paint the mirrored note instantly on cold launch, and run the
    // queryFn offline so the fallback reaches the FULL mirror row (default
    // "online" would pause the fetch offline). Flag off: unchanged.
    placeholderData: mirrorOn ? seed : undefined,
    networkMode: mirrorOn ? "always" : "online",
  });
}

// Offline policy for mutations: we don't trust `navigator.onLine` alone. In the
// installed-PWA standalone mode (caught 2026-04-21, issue #61) airplane mode
// leaves `onLine === true` on Android Chrome, and a service worker can also
// intercept the POST and never settle its fetch promise. So the policy is:
//
//   1. If we can see we're offline AND we have somewhere to enqueue, skip the
//      network attempt entirely — cheap, no-wait enqueue.
//   2. Otherwise try the network with a bounded AbortController timeout.
//   3. If the network call rejects (error, abort, or timeout) and we have the
//      sync DB available, enqueue the mutation and return the optimistic row.
//   4. If there's nowhere to enqueue, re-throw — that's a genuine config fail.
//
// Callers keep the same signature; the returned Note is optimistic (local id +
// local timestamps) and is replaced by the server-authored one when the drain
// lands.
const OFFLINE_FALLBACK_MS = 8_000;

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export async function withOfflineFallback<T>(
  online: (signal: AbortSignal) => Promise<T>,
  enqueueFallback: (() => Promise<T>) | null,
): Promise<T> {
  if (enqueueFallback && isOffline()) {
    return enqueueFallback();
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("offline-timeout")), OFFLINE_FALLBACK_MS);
  try {
    return await online(ctrl.signal);
  } catch (err) {
    if (enqueueFallback) return enqueueFallback();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function optimisticCreatedNote(payload: CreateNotePayload, localId: string): Note {
  const now = new Date().toISOString();
  return {
    id: localId,
    path: payload.path,
    createdAt: now,
    updatedAt: now,
    tags: payload.tags,
    metadata: payload.metadata,
    content: payload.content,
  };
}

async function enqueueCreate(
  db: LensDB,
  vaultId: string,
  payload: CreateNotePayload,
): Promise<Note> {
  const localId = newLocalId();
  await enqueue(db, { kind: "create-note", localId, payload }, { vaultId });
  return optimisticCreatedNote(payload, localId);
}

async function enqueueUpdate(
  db: LensDB,
  vaultId: string,
  targetId: string,
  payload: UpdateNotePayload,
  existing: Note | undefined,
): Promise<Note> {
  // Baseline carries the last-known server `updatedAt` so the drain handler
  // can send `if_updated_at` and avoid silently clobbering a peer's edit. A
  // missing baseline (note never fetched in this session) is fine — the drain
  // gets a 428 on first PATCH, refetches, and retries.
  const baselineUpdatedAt = existing?.updatedAt;
  await enqueue(
    db,
    {
      kind: "update-note",
      targetId,
      payload,
      ...(baselineUpdatedAt && { baselineUpdatedAt }),
    },
    { vaultId },
  );
  const base: Note = existing ?? { id: targetId, createdAt: new Date().toISOString() };
  return {
    ...base,
    ...(payload.content !== undefined && { content: payload.content }),
    ...(payload.path !== undefined && { path: payload.path }),
    ...(payload.metadata !== undefined && { metadata: payload.metadata }),
    updatedAt: new Date().toISOString(),
  };
}

export function useUpdateNote(id: string | undefined) {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const { db } = useSync();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateNotePayload) => {
      if (!id) throw new Error("No note id");
      const fallback =
        db && activeId
          ? () => {
              const existing = qc.getQueryData<Note>(["note", activeId, id]);
              return enqueueUpdate(db, activeId, id, payload, existing);
            }
          : null;
      return withOfflineFallback((signal) => {
        if (!client) throw new Error("No active vault");
        return client.updateNote(id, payload, { signal });
      }, fallback);
    },
    onSuccess: (updated) => {
      qc.setQueryData(["note", activeId, id], updated);
      qc.invalidateQueries({ queryKey: ["notes", activeId] });
      qc.invalidateQueries({ queryKey: ["tags", activeId] });
      // If the path changed (→ new id), also seed the new key.
      if (updated?.id && updated.id !== id) {
        qc.setQueryData(["note", activeId, updated.id], updated);
      }
      // Keep the offline mirror current on the direct (online) update path;
      // no-ops when the mirror flag is off. Fire-and-forget — the mutation's
      // result doesn't depend on it.
      if (db && activeId && updated) void mirrorRecordUpsert(db, activeId, updated);
    },
  });
}

export function useCreateNote() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const { db } = useSync();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateNotePayload) => {
      const fallback = db && activeId ? () => enqueueCreate(db, activeId, payload) : null;
      return withOfflineFallback((signal) => {
        if (!client) throw new Error("No active vault");
        return client.createNote(payload, { signal });
      }, fallback);
    },
    onSuccess: (created) => {
      qc.setQueryData(["note", activeId, created.id], created);
      qc.invalidateQueries({ queryKey: ["notes", activeId] });
      // W2-10: Home's in-place composer saves WITHOUT navigating — the Recent
      // timeline (a `notesForDateViews` consumer) must show the new
      // note immediately, not on the next poll/live tick.
      qc.invalidateQueries({ queryKey: ["notesForDateViews", activeId] });
      qc.invalidateQueries({ queryKey: ["tags", activeId] });
      qc.invalidateQueries({ queryKey: ["vaultInfo", activeId] });
      // Seed the offline mirror with the new note. Online: the server row.
      // Offline: the optimistic local-id row, which the queue drain later
      // swaps for the server row. No-ops when the mirror flag is off.
      if (db && activeId) void mirrorRecordUpsert(db, activeId, created);
    },
  });
}

export function useUploadStorageFile() {
  const client = useActiveVaultClient();
  return useMutation({
    mutationFn: async (args: {
      file: File;
      onProgress?: (p: UploadProgress) => void;
      signal?: AbortSignal;
    }): Promise<StorageUploadResult> => {
      if (!client) throw new Error("No active vault");
      return client.uploadStorageFile(args.file, {
        onProgress: args.onProgress,
        signal: args.signal,
      });
    },
  });
}

export function useLinkAttachment() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      noteId: string;
      path: string;
      mimeType: string;
    }): Promise<NoteAttachment> => {
      if (!client) throw new Error("No active vault");
      return client.linkAttachment(args.noteId, { path: args.path, mimeType: args.mimeType });
    },
    onSuccess: (_att, args) => {
      qc.invalidateQueries({ queryKey: ["note", activeId, args.noteId] });
    },
  });
}

/**
 * Retry a failed (or voice-capped) transcription. On click we OPTIMISTICALLY
 * flip the note's failed audio attachment(s) + failure markers back to pending
 * so the chip immediately reads "Transcribing…"; the Wave 1 live subscription +
 * pending poll then track reality. `POST /api/notes/:id/retry-transcription`
 * (write scope) lives on both doors. An honest 4xx ("nothing retriable") is
 * caught by the caller's `onError`, which reverts the optimistic flip — the
 * chip returns to failed rather than spinning forever.
 *
 * `cacheId` is what `useNote` keys on (the route id — may be a path); `serverId`
 * is what the wire call targets (the note's server id). They're usually equal
 * for a note that already has a server-side transcription result, but we keep
 * them distinct so the optimistic cache write always hits the right key.
 */
export function useRetryTranscription() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const qc = useQueryClient();
  const pushToast = useToastStore((s) => s.push);
  return useMutation({
    mutationFn: async (args: { cacheId: string; serverId: string }) => {
      if (!client) throw new Error("No active vault");
      await client.retryTranscription(args.serverId);
    },
    onMutate: async ({ cacheId }) => {
      const key = ["note", activeId, cacheId];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Note>(key);
      if (prev) qc.setQueryData<Note>(key, retryOptimisticNote(prev));
      return { prev, key };
    },
    onError: (_err, _args, ctx) => {
      // Revert the optimistic flip so the failed chip comes back (never a stuck
      // spinner) when the retry can't proceed — including the endpoint's honest
      // 4xx ("nothing retriable"). One quiet line; the chip is the real signal.
      if (ctx?.prev && ctx.key) qc.setQueryData(ctx.key, ctx.prev);
      pushToast("Couldn't retry transcription right now.", "error");
    },
    onSettled: (_data, _err, { cacheId }) => {
      qc.invalidateQueries({ queryKey: ["note", activeId, cacheId] });
    },
  });
}

export function useDeleteAttachment() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const { db } = useSync();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: { noteId: string; attachmentId: string }) => {
      if (isOffline() && db && activeId) {
        await enqueue(
          db,
          { kind: "delete-attachment", noteId: args.noteId, attachmentId: args.attachmentId },
          { vaultId: activeId },
        );
        return args;
      }
      if (!client) throw new Error("No active vault");
      await client.deleteAttachment(args.noteId, args.attachmentId);
      return args;
    },
    onSuccess: (args) => {
      qc.invalidateQueries({ queryKey: ["note", activeId, args.noteId] });
    },
  });
}

export function useRenameTag() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      oldName: string;
      newName: string;
    }): Promise<{ renamed: number }> => {
      if (!client) throw new Error("No active vault");
      return client.renameTag(args.oldName, args.newName);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tags", activeId] });
      qc.invalidateQueries({ queryKey: ["notes", activeId] });
      qc.invalidateQueries({ queryKey: ["vaultInfo", activeId] });
    },
  });
}

export function useMergeTags() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      sources: string[];
      target: string;
    }): Promise<{ merged: Record<string, number>; target: string }> => {
      if (!client) throw new Error("No active vault");
      return client.mergeTags(args.sources, args.target);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tags", activeId] });
      qc.invalidateQueries({ queryKey: ["notes", activeId] });
      qc.invalidateQueries({ queryKey: ["vaultInfo", activeId] });
    },
  });
}

export function useDeleteNote() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const { db } = useSync();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const fallback =
        db && activeId
          ? async () => {
              await enqueue(db, { kind: "delete-note", targetId: id }, { vaultId: activeId });
              return id;
            }
          : null;
      return withOfflineFallback(async (signal) => {
        if (!client) throw new Error("No active vault");
        await client.deleteNote(id, { signal });
        return id;
      }, fallback);
    },
    onSuccess: (id) => {
      qc.removeQueries({ queryKey: ["note", activeId, id] });
      qc.invalidateQueries({ queryKey: ["notes", activeId] });
      qc.invalidateQueries({ queryKey: ["tags", activeId] });
      qc.invalidateQueries({ queryKey: ["vaultInfo", activeId] });
      // Drop the mirror row too (online path); no-ops when the flag is off.
      if (db && activeId) void mirrorRecordRemove(db, activeId, id);
    },
  });
}
