import { decodeJwtSub } from "@/lib/vault/jwt";
import { useLiveNotesQuery } from "@/lib/vault/live-query";
import { useActiveVaultClient, useNote } from "@/lib/vault/queries";
import { loadToken } from "@/lib/vault/storage";
import { useVaultStore } from "@/lib/vault/store";
import type { TagRoles } from "@/lib/vault/tag-roles";
import type { Note } from "@/lib/vault/types";
import { type QueryKey, keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { type DefaultPageId, defaultPagePath, resolveDefaultViewDef } from "./defaults";
import {
  type MappedViewQuery,
  type ViewRefinements,
  composeViewQuery,
  viewQueryToNotesQuery,
} from "./query";
import type { ViewDef } from "./schema";

/** A single view note by id — thin alias so `views/queries.ts` names everything §1 lists. */
export const useViewNote = useNote;

/**
 * Every note carrying the vault's `view` role tag, anywhere in the vault
 * (no path prefix — tags are types, paths are filing, §6). Feeds the Rail
 * band; live-reconciled like every other note list.
 */
export function useViewList(viewTag: string) {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set("tag", viewTag);
    p.set("sort", "asc");
    return p;
  }, [viewTag]);
  const queryKey = useMemo(() => ["viewList", activeId, viewTag], [activeId, viewTag]);

  const { isLive } = useLiveNotesQuery({ queryKey, params, client, enabled: !!viewTag });

  return useQuery({
    queryKey,
    enabled: !!client && !!viewTag,
    queryFn: () => client!.queryNotes(params),
    staleTime: isLive ? Number.POSITIVE_INFINITY : 30_000,
    refetchInterval: isLive ? false : 30_000,
    refetchOnWindowFocus: !isLive,
  });
}

/**
 * Resolve a default page's effective ViewDef (VIEWS-RENDER-SPEC §7, wave
 * 2a) — the pack note at the page's canonical path when present and
 * parseable, else the app's built-in def, INSTANTLY (the pure resolution
 * in `defaults.ts` never needs the note to have loaded). `pageId === null`
 * skips the lookup entirely (other presets don't have a default page).
 */
export function useDefaultViewDef(
  pageId: DefaultPageId | null,
  roles: TagRoles,
): { def: ViewDef | null; isPackNote: boolean } {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const path = pageId ? defaultPagePath(pageId) : null;

  const packNote = useQuery({
    queryKey: ["defaultViewNote", activeId, path],
    queryFn: async () => {
      const results = await client!.queryNotes({ path: path! });
      return results[0] ?? null;
    },
    enabled: !!client && !!path,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  return useMemo(() => {
    if (!pageId) return { def: null, isPackNote: false };
    return resolveDefaultViewDef(pageId, packNote.data ?? null, roles);
  }, [pageId, packNote.data, roles]);
}

export interface UseViewResultsResult {
  data: Note[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  /** Decode + query-mapping problems merged — the problems banner's source (§3). */
  problems: MappedViewQuery["problems"];
  /**
   * The exact TanStack Query key this view's results live under — the target an
   * editable kind (e.g. the board's tap-to-move) optimistically writes so a
   * change re-lanes instantly (see `src/lib/views/mutate.ts`).
   */
  queryKey: QueryKey;
}

/**
 * Execute a view's composed query (base + refinements, §5) against the
 * vault. `def === null` (still loading its note) and `def.query === null`
 * (unparseable, §3) both fetch nothing — the caller renders the loading /
 * problems state instead.
 */
export function useViewResults(
  def: ViewDef | null,
  refinements: ViewRefinements,
): UseViewResultsResult {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);

  const composed = useMemo(
    () => (def ? composeViewQuery(def.query, refinements) : null),
    [def, refinements],
  );
  const mapped = useMemo(() => (composed ? viewQueryToNotesQuery(composed) : null), [composed]);

  const queryKey = useMemo(
    () => ["viewResults", activeId, def?.noteId, mapped?.params.toString() ?? null],
    [activeId, def?.noteId, mapped],
  );

  const { isLive } = useLiveNotesQuery({
    queryKey,
    params: mapped?.params ?? new URLSearchParams(),
    client: mapped ? client : null,
    enabled: !!mapped,
  });

  const query = useQuery({
    queryKey,
    enabled: !!client && !!mapped,
    queryFn: () => client!.queryNotes(mapped!.params),
    staleTime: isLive ? Number.POSITIVE_INFINITY : 10_000,
    refetchInterval: isLive ? false : 30_000,
    refetchOnWindowFocus: !isLive,
    placeholderData: keepPreviousData,
  });

  return {
    data: query.data,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
    problems: mapped?.problems ?? [],
    queryKey,
  };
}

/**
 * The signed-in principal's own `sub`, decoded client-side from the active
 * vault's access token — a DISPLAY decision (§5's Save-sheet default), never
 * a security boundary. `null` when there's no active vault, no stored
 * token, or the token isn't JWT-shaped (an older `pvt_*` opaque token).
 */
export function useMySub(): string | null {
  const activeId = useVaultStore((s) => s.activeVaultId);
  return useMemo(() => {
    if (!activeId) return null;
    const token = loadToken(activeId);
    if (!token?.accessToken) return null;
    return decodeJwtSub(token.accessToken);
  }, [activeId]);
}

/**
 * Ownership resolution (§5): `createdBy === my sub` defaults the Save sheet
 * to "Update this view"; anything else (a seed pack's views, an agent's,
 * a missing stamp on an old note) defaults to "Save as new view."
 */
export function defaultSaveMode(
  note: Pick<Note, "createdBy"> | undefined,
  mySub: string | null,
): "update" | "fork" {
  if (mySub && note?.createdBy && note.createdBy === mySub) return "update";
  return "fork";
}
