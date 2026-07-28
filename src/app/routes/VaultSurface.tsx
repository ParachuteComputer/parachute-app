import { COMPOSER_INPUT_ID, Composer } from "@/components/Composer";
import { LensStrip } from "@/components/LensStrip";
import { NoteRow, NoteRowList } from "@/components/NoteRow";
import { PathTree } from "@/components/PathTree";
import { RecentTimeline, SectionLabel } from "@/components/RecentTimeline";
import { TagBrowser } from "@/components/TagBrowser";
import { normalizeTag } from "@/components/TagEditor";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { OfflineRibbon } from "@/components/ui/OfflineRibbon";
import { Skeleton } from "@/components/ui/Skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { isHostedVaultRecord } from "@/lib/account/hosted-vault";
import { summaryOrNull, useAccountSummary } from "@/lib/account/use-summary";
import { shiftDay, toDateKey, todayKey } from "@/lib/dates";
import {
  type HomeStepId,
  deriveSteps,
  hasUserAuthoredNote,
  stepsComplete,
} from "@/lib/home/checklist";
import { useHomeChecklist } from "@/lib/home/use-home-checklist";
import { meetsAutoThreshold, usePathTreeMode } from "@/lib/path-tree";
import {
  useDeleteView,
  useRenameView,
  useSaveView,
  useSavedViews,
  useUpdateView,
} from "@/lib/saved-views/queries";
import {
  type SavedView,
  type SavedViewFilters,
  filtersToSearchParams,
  isFiltersNonEmpty,
  searchParamsToFilters,
} from "@/lib/saved-views/spec";
import { useToastStore } from "@/lib/toast/store";
import {
  DEFAULT_NOTE_QUERY,
  DEFAULT_PAGE_SIZE,
  type NoteQueryState,
  isFilteringActive,
  useNotes,
  useNotesForDateViews,
  useNotesForPathTree,
  usePinnedTags,
  useTagRoles,
  useTagsWithSchema,
  useUpdateNote,
  useVaultStore,
} from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import type { Note, TagRecord } from "@/lib/vault/types";
import type { DefaultPageId } from "@/lib/views/defaults";
import { useDefaultViewDef } from "@/lib/views/queries";
import { queryTags } from "@/lib/views/query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";

export type VaultView = "pinned" | "archived" | "untagged" | "orphaned";

const VIEW_ORDER: VaultView[] = ["pinned", "archived", "untagged", "orphaned"];

// The lens label (LENS-SPEC §3 anatomy item 5) — a sage eyebrow + quiet hint
// naming the lens the list is wearing. It replaces BOTH the old "All notes"
// H1 (the vault masthead owns the headline now) and the SectionLabel count.
// Recent + All are the writing lenses; Pinned/Archive are the browse lenses;
// Untagged/Orphaned are maintenance sub-views (§1 — filters, not lenses: the
// rail keeps All notes lit).
const LENS_LABELS: Record<VaultView | "all" | "recent", { label: string; hint: string }> = {
  recent: { label: "Recent", hint: "what you've touched lately" },
  all: { label: "All notes", hint: "everything, searchable" },
  pinned: { label: "Pinned", hint: "starred" },
  archived: { label: "Archive", hint: "set aside, never deleted" },
  untagged: { label: "Untagged", hint: "notes without any tags" },
  orphaned: { label: "Orphaned", hint: "notes with no links" },
};

function parsePreset(value: string | null): VaultView | undefined {
  return VIEW_ORDER.find((p) => p === value);
}

// VaultSurface — the ONE surface over the vault (LENS-SPEC §3): the lenses
// (Recent · All · Pinned · Archive) are dresses over this component, toggled
// in the rail; only the list changes. The vault name is the masthead on every
// lens; the lens is a label, not a headline; the composer rides the writing
// lenses (Recent + All); Pinned/Archive are composer-less browse lenses.
// Formerly `Notes.tsx` (git-mv'd for history).
//
// Two bodies, one surface (owner decision ii — Recent and All stay distinct
// lenses because their data machinery differs): `lens="recent"` is the capped
// live window (day-grouped, floored — BootGate's vault-active branches render
// it at `/`; the old Home dissolved into it in LZ-4); everything else is the
// paginated searchable query, its lens normally read from the `?view=` query
// param (the four built-in views are filters INSIDE the All-notes list, not
// their own routes — the old /pinned etc. redirect into /notes?view=). The
// optional `preset` prop is an explicit override kept for direct-render
// callers (tests, embeds).
export function VaultSurface({ preset, lens }: { preset?: VaultView; lens?: "recent" } = {}) {
  if (lens === "recent") return <RecentLens />;
  return <SearchableLenses preset={preset} />;
}

// The masthead (§3 anatomy item 1, every lens) — the vault NAME leads as the
// serif headline (identity everywhere; the same masthead the old Home
// carried), with the ownership line under it. The lens gets a quiet label
// above the list, never the headline.
function VaultMasthead({ name }: { name: string }) {
  return (
    <header className="mb-6">
      <h1 className="page-title" style={{ fontSize: "clamp(2rem, 4vw, 2.6rem)" }}>
        {name}
      </h1>
      <p className="mt-1.5 text-fg-muted">Everything here is yours. Open format. Export anytime.</p>
    </header>
  );
}

// The paginated, searchable side of the surface — the All lens plus the
// Pinned/Archive browse lenses and the Untagged/Orphaned maintenance
// sub-views. (The Recent lens below is the other body: same masthead, same
// composer, different machinery.)
function SearchableLenses({ preset: presetProp }: { preset?: VaultView }) {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const { roles } = useTagRoles(activeVault?.id ?? null);
  const { pinnedTags } = usePinnedTags(activeVault?.id ?? null);
  const [searchParams, setSearchParams] = useSearchParams();
  const preset = presetProp ?? parsePreset(searchParams.get("view"));

  // Hydrate filter state from URL on mount and when the URL changes
  // externally (clicking a saved view rewrites params). Sync direction is
  // local-state → URL; we track the last-known URL signature to avoid an
  // immediate echo loop after a user edit.
  const initial = useMemo(() => searchParamsToFilters(searchParams), [searchParams]);
  const [search, setSearch] = useState(initial.search ?? "");
  const [pathPrefix, setPathPrefix] = useState(initial.pathPrefix ?? "");
  const [selectedTags, setSelectedTags] = useState<string[]>(initial.tags ?? []);
  const [tagMatch, setTagMatch] = useState<"any" | "all">(initial.tagMatch ?? "any");
  const [sort, setSort] = useState<"asc" | "desc">(initial.sort ?? "desc");
  const [showArchived, setShowArchived] = useState(initial.showArchived ?? false);
  const [offset, setOffset] = useState(0);

  // Re-sync from URL when navigating between saved views without remount.
  // Keyed on the params signature so updates from local state (which write
  // back to the URL) don't loop.
  const urlSignature = useMemo(() => searchParams.toString(), [searchParams]);
  useEffect(() => {
    const f = searchParamsToFilters(new URLSearchParams(urlSignature));
    setSearch(f.search ?? "");
    setPathPrefix(f.pathPrefix ?? "");
    setSelectedTags(f.tags ?? []);
    setTagMatch(f.tagMatch ?? "any");
    setSort(f.sort ?? "desc");
    setShowArchived(f.showArchived ?? false);
  }, [urlSignature]);

  const debouncedSearch = useDebouncedValue(search, 300);
  const debouncedPrefix = useDebouncedValue(pathPrefix, 300);

  // Push the current filter state back to the URL so it's shareable and so
  // saved-view linking is symmetric. Skip on preset routes (/pinned,
  // /archived) — those have their own canonical URL.
  // biome-ignore lint/correctness/useExhaustiveDependencies: writes only when filter dimensions change
  useEffect(() => {
    if (preset) return;
    const next: SavedViewFilters = {
      search: debouncedSearch,
      tags: selectedTags,
      tagMatch,
      pathPrefix: debouncedPrefix,
      sort,
      showArchived,
    };
    const desired = filtersToSearchParams(next).toString();
    if (desired !== urlSignature) {
      setSearchParams(filtersToSearchParams(next), { replace: true });
    }
  }, [preset, debouncedSearch, debouncedPrefix, selectedTags, tagMatch, sort, showArchived]);

  // Views cutover (VIEWS-RENDER-SPEC §7, wave 2a): Pinned/Archive no longer
  // hardcode their tag — they resolve it from a ViewDef. A Views/Pinned or
  // Views/Archive note (the opt-in starter-ontology pack, or a
  // hand-authored override) wins when present and its query parses; the
  // app's own built-in def — the same `roles.pinned`/`roles.archived` this
  // used to inline directly — wins otherwise, resolved instantly (never
  // blocks or blanks this page). Everything else about this surface is
  // unchanged: same search/filters/pagination chrome, same NoteRowList
  // rendering. Untagged/orphaned/all/recent aren't default pages and stay
  // on the literal-tags path (recent is its own lens body below; all notes
  // is wave 2b).
  const defaultPageId: DefaultPageId | null =
    preset === "pinned" || preset === "archived" ? preset : null;
  const { def: resolvedViewDef } = useDefaultViewDef(defaultPageId, roles);

  // User can add more tags on top via the panel's TagBrowser. Untagged and
  // orphaned use vault-native filters (has_tags / has_links).
  const effectiveTags = useMemo(() => {
    if (!defaultPageId) return selectedTags;
    const baseTags = resolvedViewDef ? queryTags(resolvedViewDef.query) : [];
    return Array.from(new Set([...baseTags, ...selectedTags]));
  }, [defaultPageId, resolvedViewDef, selectedTags]);

  const effectiveTagMatch: "any" | "all" = defaultPageId ? "all" : tagMatch;

  // Any filter change resets pagination.
  // biome-ignore lint/correctness/useExhaustiveDependencies: offset is the target, not a trigger
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, debouncedPrefix, effectiveTags, effectiveTagMatch, sort, showArchived]);

  const queryState: NoteQueryState = useMemo(
    () => ({
      ...DEFAULT_NOTE_QUERY,
      search: debouncedSearch,
      pathPrefix: debouncedPrefix,
      tags: effectiveTags,
      tagMatch: effectiveTagMatch,
      sort,
      offset,
      // The peek: ask for one row beyond the page. If a PAGE+1-th row comes
      // back, a next page EXISTS — `hasNext` below is a fact, not an
      // inference from "the page looks full" (which mis-fired on sets that
      // are an exact multiple of the page: Next led to an empty page wearing
      // the empty-vault copy). The peek row is trimmed before render
      // (`displayNotes`) and never joins the pinned-first sort.
      limit: DEFAULT_PAGE_SIZE + 1,
      ...(preset === "untagged" ? { hasTags: false } : {}),
      ...(preset === "orphaned" ? { hasLinks: false } : {}),
    }),
    [debouncedSearch, debouncedPrefix, effectiveTags, effectiveTagMatch, sort, offset, preset],
  );

  // live:false — this list pages by limit/offset, and a live subscription's
  // snapshot is always the COMPLETE matching set, which would clobber the
  // bounded page the moment the socket delivers (app#109: 2,606 rows in a
  // 330,339px page, pager dead). The server-side window stays authoritative;
  // freshness comes from the polling floor (30s interval + refetch-on-focus)
  // and from mutations invalidating the cache on our own writes.
  const notes = useNotes(queryState, { live: false });
  // Schema-bearing listing — the tag picker's typed-tag marker needs field
  // info, and the /tags page already pays for this query shape, so this
  // isn't a new network cost, just a shared one.
  const tags = useTagsWithSchema();
  const savedViews = useSavedViews(roles.view);
  const saveView = useSaveView(roles.view);
  const renameView = useRenameView();
  const updateView = useUpdateView();
  const deleteView = useDeleteView();
  const pushToast = useToastStore((s) => s.push);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [renaming, setRenaming] = useState<SavedView | null>(null);
  // W2-11 progressive disclosure: everything beyond the resting search lives
  // behind ONE "Filters" disclosure. Deliberately NOT persisted — the page
  // rests calm on every arrival; the button's count badge carries any active
  // (but folded) filter state, so nothing is hidden surprisingly.
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Path tree: independent capped fetch (separate from the filtered list) so
  // the tree stays stable as the user narrows results. Disabled on preset
  // routes (no views column) and when the user has set the mode to `never`.
  // Only fetches once the Folders accordion (inside the Filters panel) is
  // opened — a merely-hidden tree would fire the 5000-note query on every
  // Notes load, which is worst-of-both-worlds (hidden but still expensive).
  const { mode: pathTreeMode } = usePathTreeMode(activeVault?.id ?? null);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const showFoldersAccordion = !preset && pathTreeMode !== "never";
  const treeEnabled = showFoldersAccordion && foldersOpen;
  const treeNotes = useNotesForPathTree(treeEnabled);
  const treePaths = useMemo(() => (treeNotes.data ?? []).map((n) => n.path), [treeNotes.data]);
  const showPathTree =
    treeEnabled &&
    (pathTreeMode === "always" || (pathTreeMode === "auto" && meetsAutoThreshold(treePaths)));

  const currentFilters: SavedViewFilters = useMemo(
    () => ({
      search: debouncedSearch,
      tags: selectedTags,
      tagMatch,
      pathPrefix: debouncedPrefix,
      sort,
      showArchived,
    }),
    [debouncedSearch, debouncedPrefix, selectedTags, tagMatch, sort, showArchived],
  );

  const onSaveView = useCallback(
    async (name: string) => {
      try {
        await saveView.mutateAsync({ name, filters: currentFilters });
        pushToast(`Saved view "${name}".`, "success");
        setShowSaveDialog(false);
      } catch (err) {
        pushToast(`Could not save view: ${(err as Error).message}`, "error");
      }
    },
    [saveView, currentFilters, pushToast],
  );

  const onRenameView = useCallback(
    async (view: SavedView, newName: string) => {
      try {
        await renameView.mutateAsync({ view, newName });
        pushToast(`Renamed to "${newName}".`, "success");
        setRenaming(null);
      } catch (err) {
        pushToast(`Could not rename: ${(err as Error).message}`, "error");
      }
    },
    [renameView, pushToast],
  );

  const onUpdateView = useCallback(
    async (view: SavedView) => {
      try {
        await updateView.mutateAsync({ view, filters: currentFilters });
        pushToast(`Updated "${view.name}".`, "success");
      } catch (err) {
        pushToast(`Could not update: ${(err as Error).message}`, "error");
      }
    },
    [updateView, currentFilters, pushToast],
  );

  const onDeleteView = useCallback(
    async (view: SavedView) => {
      // Plain confirm is consistent with the other destructive flows in this
      // app (Vaults.tsx removal, SyncStatusPanel discard).
      if (!confirm(`Delete saved view "${view.name}"? This can't be undone.`)) return;
      try {
        await deleteView.mutateAsync(view);
        pushToast(`Deleted "${view.name}".`, "success");
      } catch (err) {
        pushToast(`Could not delete: ${(err as Error).message}`, "error");
      }
    },
    [deleteView, pushToast],
  );

  // Client-side post-process: hide archived on default list unless toggled, and
  // pinned-first stable sort on default list. Preset views skip both.
  const displayNotes = useMemo(() => {
    if (!notes.data) return notes.data;
    // Drop the peek row first (fetched only to prove a next page exists —
    // see queryState) so it never renders and never joins the sort below.
    let list = notes.data.slice(0, DEFAULT_PAGE_SIZE);
    if (!preset && !showArchived) {
      list = list.filter((n) => !(n.tags ?? []).includes(roles.archived));
    }
    if (!preset) {
      const pinnedTag = roles.pinned;
      list = [...list].sort((a, b) => {
        const ap = (a.tags ?? []).includes(pinnedTag) ? 0 : 1;
        const bp = (b.tags ?? []).includes(pinnedTag) ? 0 : 1;
        return ap - bp;
      });
    }
    return list;
  }, [notes.data, preset, showArchived, roles.archived, roles.pinned]);

  // NAVIGATION.md: route guard, no active vault — replace.
  if (!activeVault) return <Navigate to="/" replace />;

  const lens = LENS_LABELS[preset ?? "all"];
  const pageFirst = offset + 1;
  const pageLast = offset + (displayNotes?.length ?? 0);
  const hasPrev = offset > 0;
  // The peek row (queryState asks for PAGE+1) makes this a FACT: a PAGE+1-th
  // fetched row IS the next page's first row, so a set of exactly N×PAGE
  // notes ends with Next disabled instead of one extra click onto an empty
  // page. Sound only because the window is authoritative
  // (`useNotes({ live: false })` above): `notes.data` is exactly the polled
  // page, never a live snapshot of the whole set.
  const fetchedLen = notes.data?.length ?? 0;
  const hasNext = fetchedLen > DEFAULT_PAGE_SIZE;
  // INTERIM total (vault#626 tracks the real one): list responses are a bare
  // JSON array — no total exists anywhere in the poll. All we know is what
  // the window shape implies: a short page ends the set (total = offset +
  // fetchedLen), a full page only bounds it from below ("of N+"). Also
  // provisional: this total counts SERVER rows while the visible range counts
  // rows AFTER the client-side archived filter (`displayNotes`), so a short
  // page can read "Showing 1–25 of 30" with archived hidden — honest to the
  // server, odd to a person. Both quirks resolve together when the contract
  // count lands (vault#626); do not build on this.
  const knownTotal = hasNext ? null : offset + fetchedLen;
  const totalLabel =
    knownTotal !== null ? ` of ${knownTotal}` : ` of ${offset + DEFAULT_PAGE_SIZE}+`;
  const filteringActive = isFiltersNonEmpty(currentFilters);

  // How many FOLDED filter dimensions are live — the Filters button wears
  // this as a badge so closing the panel never hides active state. Search is
  // excluded (it stays visible at rest).
  const foldedFilterCount =
    (selectedTags.length > 0 ? 1 : 0) +
    (pathPrefix.trim() ? 1 : 0) +
    (showArchived ? 1 : 0) +
    (sort !== "desc" ? 1 : 0);

  // A genuinely empty vault (settled, unfiltered, first page) gets the calm
  // arrival: masthead + composer + search + the empty-state invitation ONLY —
  // no filter chrome hovering over nothing (WALK-nav N3). The moment anything
  // is filterable (notes exist, a filter is live, or a preset scopes the
  // list) the disclosure comes back.
  const vaultEmpty =
    !preset &&
    !filteringActive &&
    foldedFilterCount === 0 &&
    !notes.isPending &&
    (notes.data?.length ?? 0) === 0 &&
    offset === 0;
  const showFiltersControl = !vaultEmpty;
  const showPagination = hasPrev || hasNext || (displayNotes?.length ?? 0) > 0;

  return (
    <div className="page-surface">
      <VaultMasthead name={activeVault.name} />

      {/* The mobile lens strip (§5.1, LZ-5) — below lg the rail is gone, so
          the surface itself carries the lens set: the nav model's lens band
          as a chip row under the masthead, on every lens. `lg:hidden` — the
          desktop rail owns the set at lg+. */}
      <LensStrip />

      {/* The composer rides the writing lenses (§3 item 2; ratified decision
          i) — here that means All notes (Recent mounts its own above). The
          browse lenses and the maintenance sub-views are triage, not writing:
          no composer on any `?view=`. Keyed by vault id (the notes#175
          draft-clobber guard — a mid-session vault switch remounts a fresh
          composer bound to the new vault's draft). */}
      {!preset ? <Composer key={activeVault.id} vault={activeVault} focused={false} /> : null}

      {/* The at-rest chrome (W2-11 progressive disclosure): a search field
          and one Filters disclosure. Everything else — sort, archived
          visibility, path prefix, tags, pinned tags, saved views, folders,
          the Untagged/Orphaned maintenance views — lives in the panel below,
          folded until asked for. The desktop view-chip row (PresetFilterBar)
          retired in LZ-3: the rail owns the lens set now (LENS-SPEC §3 item
          4). `data-notes-chrome` scopes the resting-control census test. */}
      <div data-notes-chrome className="mb-6 flex items-center gap-3">
        <input
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input min-w-0 flex-1"
          aria-label="Search notes"
        />
        {showFiltersControl ? (
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            aria-controls="notes-filters"
            className="btn btn-secondary btn-touch shrink-0"
          >
            Filters
            {foldedFilterCount > 0 ? (
              <span className="rounded-full bg-grass-soft px-1.5 font-semibold text-grass-ink text-xs">
                {foldedFilterCount}
              </span>
            ) : null}
            <span aria-hidden="true" className="font-mono text-xs">
              {filtersOpen ? "▴" : "▾"}
            </span>
          </button>
        ) : null}
      </div>

      {filtersOpen && showFiltersControl ? (
        <section id="notes-filters" aria-label="Filters" className="card mb-6 p-4 md:p-5">
          {/* Two columns at most (was 3): the one-surface width (--w-surface,
              52rem) leaves three columns too cramped for the tag browser and
              saved views — [spec-resolved §3] builder's-discretion drop. */}
          <div className={`grid gap-x-8 gap-y-6 ${preset === "untagged" ? "" : "md:grid-cols-2"}`}>
            {/* Refine — order, archived visibility, path narrowing. */}
            <div>
              <h2 className="eyebrow mb-3">Refine</h2>
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setSort((s) => (s === "desc" ? "asc" : "desc"))}
                  className="focus-ring block text-fg-muted text-sm hover:text-accent"
                  aria-label="Toggle sort direction"
                >
                  Sort: {sort === "desc" ? "newest" : "oldest"} first
                </button>
                {!preset ? (
                  <label className="flex items-center gap-1.5 text-fg-muted text-sm hover:text-accent">
                    <input
                      type="checkbox"
                      checked={showArchived}
                      onChange={(e) => setShowArchived(e.target.checked)}
                    />
                    Show archived
                  </label>
                ) : null}
                <input
                  type="text"
                  placeholder="Title starts with…"
                  value={pathPrefix}
                  onChange={(e) => setPathPrefix(e.target.value)}
                  className="input w-full font-mono"
                  aria-label="Filter by path prefix"
                />
                <MaintenanceViewsRow active={preset} />
              </div>
            </div>

            {/* Tags — browse-by-tag multi-select. Pinned tags float to the
                top of its shortlist rather than living in a strip of their
                own (the old strip was single-select-replace right above a
                multi-select-toggle control — two look-alikes, different
                behavior). (The untagged view is definitionally tag-free.) */}
            {preset !== "untagged" ? (
              <div className="space-y-4">
                <TagBrowser
                  tags={tags.data ?? []}
                  pinnedTags={pinnedTags}
                  selected={selectedTags}
                  onToggle={(name) =>
                    setSelectedTags((cur) =>
                      cur.includes(name) ? cur.filter((t) => t !== name) : [...cur, name],
                    )
                  }
                  onClear={() => setSelectedTags([])}
                  isLoading={tags.isPending}
                />
                {selectedTags.length > 1 ? (
                  <fieldset className="flex items-center gap-3 text-xs">
                    <legend className="sr-only">Match mode</legend>
                    <span className="text-fg-dim">Match</span>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="tag-match"
                        value="any"
                        checked={tagMatch === "any"}
                        onChange={() => setTagMatch("any")}
                      />
                      Any
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="tag-match"
                        value="all"
                        checked={tagMatch === "all"}
                        onChange={() => setTagMatch("all")}
                      />
                      All
                    </label>
                  </fieldset>
                ) : null}
              </div>
            ) : null}

            {/* Views & folders — saved views + the lazy folder tree (full
                list only; presets are already a view). */}
            {!preset ? (
              <div className="space-y-6">
                <div>
                  <SavedViewsSidebar
                    views={savedViews.data}
                    isPending={savedViews.isPending}
                    error={savedViews.error}
                    canUpdateWithCurrent={isFiltersNonEmpty(currentFilters)}
                    onRename={(v) => setRenaming(v)}
                    onUpdate={onUpdateView}
                    onDelete={onDeleteView}
                  />
                  {filteringActive ? (
                    <button
                      type="button"
                      onClick={() => setShowSaveDialog(true)}
                      className="btn btn-accent-soft btn-sm mt-3"
                    >
                      Save view…
                    </button>
                  ) : null}
                </div>
                {showFoldersAccordion ? (
                  <details
                    className="group"
                    open={foldersOpen}
                    onToggle={(e) => setFoldersOpen(e.currentTarget.open)}
                  >
                    <summary className="eyebrow flex cursor-pointer list-none items-center justify-between rounded-lg px-1 py-1 hover:text-accent">
                      <span>Folders</span>
                      <span
                        aria-hidden="true"
                        className="font-mono text-xs transition-transform group-open:rotate-90"
                      >
                        ▸
                      </span>
                    </summary>
                    <div className="mt-2">
                      {showPathTree ? (
                        <PathTree
                          paths={treePaths}
                          vaultId={activeVault.id}
                          currentPrefix={pathPrefix}
                          onSelect={(p) => setPathPrefix(p)}
                        />
                      ) : treeNotes.isLoading ? (
                        <p className="px-1 text-xs text-fg-dim">Loading…</p>
                      ) : (
                        <p className="px-1 text-xs text-fg-dim">
                          Not enough folder variety to show a tree yet.
                        </p>
                      )}
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* The lens label (§3 item 5) — names the lens over the list: a sage
          eyebrow + quiet hint, replacing the old SectionLabel title+count
          (the pager line below still carries "Showing m–n"). Skipped on the
          fresh-empty-vault arrival (All by definition), where the composer +
          invitation carry the whole surface — no label over nothing. */}
      {!vaultEmpty ? (
        <SectionLabel>
          {lens.label}
          <span className="font-sans normal-case tracking-normal text-fg-muted">
            {" "}
            · {lens.hint}
          </span>
        </SectionLabel>
      ) : null}

      {notes.isPending ? (
        <SkeletonRows />
      ) : notes.isError && !notes.data ? (
        // Keep the last-loaded list on screen when a background refetch
        // fails (offline mid-session); only a truly empty cache errors.
        <NotesErrorBlock error={notes.error} retry={() => notes.refetch()} />
      ) : displayNotes && displayNotes.length > 0 ? (
        <>
          {notes.isError ? <OfflineRibbon /> : null}
          <NoteRowList aria-label="Notes">
            {displayNotes.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                pinnedTag={roles.pinned}
                archivedTag={roles.archived}
                trailing={
                  preset === "untagged" ? (
                    <QuickTagControl
                      noteId={n.id}
                      existing={n.tags ?? []}
                      suggestions={tags.data ?? []}
                    />
                  ) : undefined
                }
              />
            ))}
          </NoteRowList>
        </>
      ) : (
        <NotesEmptyBlock filtering={isFilteringActive(queryState) || !!preset} />
      )}

      {/* The pager only exists when there is something to page (or a page
          behind you) — an empty vault's arrival is the composer + search +
          the invitation, nothing more. */}
      {showPagination ? (
        <div className="mt-6 flex items-center justify-between text-fg-dim text-sm">
          <span>
            {notes.data && notes.data.length > 0
              ? `Showing ${pageFirst}–${pageLast}${totalLabel}`
              : notes.isFetching
                ? "Loading…"
                : ""}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!hasPrev}
              onClick={() => setOffset((o) => Math.max(0, o - DEFAULT_PAGE_SIZE))}
              className="btn btn-secondary btn-touch"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!hasNext}
              onClick={() => setOffset((o) => o + DEFAULT_PAGE_SIZE)}
              className="btn btn-secondary btn-touch"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {showSaveDialog ? (
        <SaveViewDialog
          existing={savedViews.data ?? []}
          isSaving={saveView.isPending}
          onCancel={() => setShowSaveDialog(false)}
          onSave={onSaveView}
        />
      ) : null}

      {renaming ? (
        <RenameViewDialog
          view={renaming}
          existing={savedViews.data ?? []}
          isSaving={renameView.isPending}
          onCancel={() => setRenaming(null)}
          onSave={(name) => onRenameView(renaming, name)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The Recent lens (LZ-4, LENS-SPEC §1 + §3) — the old Home, dissolved into
// the one surface. BootGate's vault-active branches render it at `/`. The
// body is the capped live window over the vault (`useNotesForDateViews`),
// day-grouped by RecentTimeline, with the two §1.1 changes from Home's list:
// archived notes drop OUT of Recent (they're set aside, not "touched
// lately" — Home used to show them dimmed), and the window wears a visible
// FLOOR — the most recent 14 days or 100 notes, whichever comes first — with
// a quiet foot line pointing at All notes. The cap is what makes Recent
// *mean* recent, and what keeps Recent ≠ All sharp.
//
// Recent + All are the writing lenses (ratified decision i): the composer
// rides here too, warmed (focus ring) while the vault is fresh. The
// Recent-only furniture — trial countdown, quick doors, setup nudge, plan
// backlink — relocated from Home verbatim: DESIGN-SPEC §3.1's "on Today
// only" ambience rule now reads "on the Recent lens only" (the same four
// sanctioned places, no expansion).
// ---------------------------------------------------------------------------

// The Recent floor (§1.1): most recent 14 days OR 100 notes, whichever comes
// first. Days are local calendar days counted back from today (the same
// day-keys the timeline buckets by), today inclusive.
export const RECENT_WINDOW_DAYS = 14;
export const RECENT_NOTE_CAP = 100;

function RecentLens() {
  const vault = useVaultStore((s) => s.getActiveVault());
  const notes = useNotesForDateViews();
  const { dismissed, dismiss } = useHomeChecklist(vault?.id ?? null);
  const { roles } = useTagRoles(vault?.id ?? null);

  // Trial ambience (DESIGN-SPEC §3.1, sanctioned places 2 + 4) — the SHARED
  // account-summary query, enabled only for a home-door (account-minted)
  // vault: a self-host door has no summary, so the fetch never fires. Lazy,
  // never gates paint; failed/absent read the same here (no ambience — the
  // retry affordance lives on /account).
  const isHosted = vault !== null && isHostedVaultRecord(vault.clientId);
  const summaryQuery = useAccountSummary({ enabled: isHosted });
  const plan = (isHosted ? summaryOrNull(summaryQuery.data) : null)?.plan ?? null;
  const trialDaysLeft = typeof plan?.trial_days_left === "number" ? plan.trial_days_left : null;

  // The floored window: archived drops out first, then the 14-day cut, then
  // the 100-note cap — sorted by the same touch stamp the timeline buckets
  // by, so "the most recent 100" is exact regardless of the server's sort
  // field. `undefined` until the query settles (the skeleton's cue).
  const recent = useMemo(() => {
    if (!notes.data) return undefined;
    const floorKey = shiftDay(todayKey(), -(RECENT_WINDOW_DAYS - 1));
    const stamp = (n: Note) => n.updatedAt ?? n.createdAt;
    return notes.data
      .filter((n) => !(n.tags ?? []).includes(roles.archived))
      .filter((n) => (toDateKey(stamp(n)) ?? "") >= floorKey)
      .sort((a, b) => (stamp(a) < stamp(b) ? 1 : stamp(a) > stamp(b) ? -1 : 0))
      .slice(0, RECENT_NOTE_CAP);
  }, [notes.data, roles.archived]);

  // BootGate only renders this lens when a vault is active, but guard anyway:
  // a vault removed mid-session falls back to the arrival (via the index).
  // NAVIGATION.md: route guard, no active vault — replace.
  if (!vault) return <Navigate to="/" replace />;

  // `settled` gates the "fresh" warmth on notes having loaded, so a returning
  // user never flashes the newcomer state before their notes come back.
  const settled = notes.data !== undefined;
  const hasUserNote = hasUserAuthoredNote(notes.data);

  const steps = deriveSteps({ hasUserNote });
  const allDone = stepsComplete(steps);
  const showSetup = !dismissed && !allDone;
  const incomplete = steps.filter((s) => !s.done);
  const doneCount = steps.length - incomplete.length;

  // Fresh = a brand-new vault the user hasn't made their own yet. Once a real
  // note exists (or they dismiss/finish setup) the lens goes quiet.
  const mode: "fresh" | "returning" = settled && !hasUserNote && showSetup ? "fresh" : "returning";

  // A genuinely EMPTY vault (settled, zero notes) gets the warm first-capture
  // invitation with no lens label over nothing and no foot (All notes would
  // be exactly as empty — same calm-arrival rule as the All lens). A vault
  // with notes but none inside the floor gets the honest dormant line + the
  // door to everything.
  const vaultEmpty = !notes.isPending && (notes.data?.length ?? 0) === 0;
  const lens = LENS_LABELS.recent;

  return (
    <div className="page-surface">
      <VaultMasthead name={vault.name} />

      {/* The mobile lens strip (§5.1, LZ-5) — same row as the searchable
          body's: the one lens vocabulary, on every lens, below lg only. */}
      <LensStrip />

      {/* The composer rides the writing lenses (§3 item 2; ratified decision
          i). Keyed by vault id (the notes#175 draft-clobber guard — a
          mid-session vault switch remounts a fresh composer bound to the new
          vault's draft); the focus warmth only while the vault is fresh. */}
      <Composer key={vault.id} vault={vault} focused={mode === "fresh"} />

      <TrialCountdownNudge daysLeft={trialDaysLeft} />

      {mode === "fresh" ? <QuickDoors /> : null}

      {showSetup && incomplete.length > 0 ? (
        <SetupNudge
          to={SETUP_DEST[incomplete[0].id].to}
          label={SETUP_DEST[incomplete[0].id].label}
          done={doneCount}
          total={steps.length}
          onDismiss={dismiss}
        />
      ) : null}

      <section aria-label="Recent notes">
        {/* The lens label (§3 item 5) — replaces Home's Today/Recent header
            (whose "All notes" link now lives in the floor's foot line). */}
        {!vaultEmpty ? (
          <SectionLabel>
            {lens.label}
            <span className="font-sans normal-case tracking-normal text-fg-muted">
              {" "}
              · {lens.hint}
            </span>
          </SectionLabel>
        ) : null}
        {notes.isPending ? (
          <RecentSkeleton />
        ) : notes.isError && !notes.data ? (
          <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-fg-muted">
            Couldn't load recent notes. They'll appear once you're back online.
          </p>
        ) : (notes.data?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center shadow-soft">
            <p className="mb-1 font-serif text-fg text-lg">A quiet, empty page.</p>
            <p className="mb-5 text-fg-muted text-sm">
              Anything at all can land here — a thought, a list, a memory.
            </p>
            {/* W2-10: the composer above is real — the first-capture CTA
                focuses it in place instead of hopping to /new (the affordance
                and the action finally agree). */}
            <button
              type="button"
              onClick={() => document.getElementById(COMPOSER_INPUT_ID)?.focus()}
              className="inline-flex rounded-full bg-accent px-5 py-2.5 font-round font-semibold text-on-accent text-sm shadow-soft hover:bg-accent-hover"
            >
              Write the first one
            </button>
          </div>
        ) : (recent?.length ?? 0) === 0 ? (
          // Dormant: the vault has notes, none touched inside the window
          // (or everything recent is archived). Honest, quiet, with the door.
          <>
            <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-fg-muted">
              Nothing touched in the last two weeks.
            </p>
            <RecentFoot />
          </>
        ) : (
          <>
            {notes.isError ? <OfflineRibbon /> : null}
            <RecentTimeline notes={recent ?? []} />
            <RecentFoot />
          </>
        )}
      </section>

      <PlanBacklink clientId={vault.clientId} trialDaysLeft={trialDaysLeft} />
    </div>
  );
}

// The floor's visible edge (§1.1) — a quiet foot line under the timeline:
// Recent ends on purpose, and the door to everything is one step. Also the
// successor to old Home's header "All notes" link (the lens label that
// replaced that header carries no link). NAVIGATION.md: user-initiated
// navigation — push.
function RecentFoot() {
  return (
    <p className="mt-6 text-fg-dim text-sm">
      Looking for older notes?{" "}
      <Link to="/notes" className="text-accent hover:underline">
        All notes →
      </Link>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Trial countdown nudge — sanctioned ambience place 4 of exactly four
// (DESIGN-SPEC §3.1): a single sun row under the composer, ONLY when
// `trial_days_left <= 7`, ONLY on the Recent lens. Not dismissible (it
// exists for ≤7 days by definition), never a modal, never on any other lens
// or page.
// ---------------------------------------------------------------------------

function TrialCountdownNudge({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft === null || daysLeft > 7) return null;
  return (
    <div className="nudge-sun mb-6">
      <span aria-hidden="true">✦</span>
      <Link to="/account" className="min-w-0 flex-1 truncate hover:underline">
        {daysLeft === 0
          ? "Your trial ends today — see plans →"
          : `Your trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"} — see plans →`}
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick doors — warm tiles for the two always-relevant next steps beyond
// writing (which the composer covers). Shown while the vault is fresh; they
// recede once it's lived-in so a returning user isn't nagged.
// ---------------------------------------------------------------------------

function QuickDoors() {
  return (
    <nav aria-label="Quick actions" className="mb-6 grid gap-3 sm:grid-cols-2">
      <DoorTile
        to="/connect"
        emoji="⚡"
        title="Connect your AI"
        description="Let Claude or ChatGPT read and write your vault."
      />
      <DoorTile
        to="/import"
        emoji="↯"
        title="Bring your notes over"
        description="Import from Obsidian or plain markdown."
      />
    </nav>
  );
}

function DoorTile({
  to,
  emoji,
  title,
  description,
}: {
  to: string;
  emoji: string;
  title: string;
  description: string;
}) {
  return (
    <Link to={to} className="focus-ring tile flex items-start gap-3 p-4">
      <span aria-hidden="true" className="text-lg leading-none">
        {emoji}
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-fg">{title}</span>
        <span className="mt-0.5 block text-fg-muted text-sm">{description}</span>
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Setup nudge — ONE quiet sun row (prototype's "✦ Finish setting up 1/3"), not
// a wall of checkboxes. Points at the next incomplete step; dismissible FOR
// THIS SESSION only (W3 — see use-home-checklist.ts). `write` is the only
// step left (state-derived: `connect` was dropped, `import` folded in — see
// checklist.ts's docstring), so this shelf disappears for good, on every
// device, the moment a real note exists.
// ---------------------------------------------------------------------------

const SETUP_DEST: Record<HomeStepId, { label: string; to: string }> = {
  write: { label: "Write your first note", to: "/new" },
};

function SetupNudge({
  to,
  label,
  done,
  total,
  onDismiss,
}: {
  to: string;
  label: string;
  done: number;
  total: number;
  onDismiss: () => void;
}) {
  return (
    <div className="nudge-sun mb-8">
      <span aria-hidden="true">✦</span>
      <Link to={to} className="min-w-0 flex-1 truncate hover:underline">
        Finish setting up — {label}
      </Link>
      <span className="font-round text-sm opacity-80">
        {done} / {total}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss setup"
        className="ml-1 text-sun-ink/70 hover:text-sun-ink"
      >
        ✕
      </button>
    </div>
  );
}

function RecentSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-14 rounded-xl" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account backlink — a quiet in-app door to the account manager, shown only for
// HOME-DOOR (account-minted) vaults. Navigates to `/account` (same origin, via
// react-router) rather than hopping to a cross-origin console — the /account
// surface owns plan + billing (Stripe-direct) + hosted vaults, so there's no
// re-login. A foreign self-hosted vault (connected via `/add` OAuth) has no
// account on THIS door, so no backlink is shown — never a dead affordance.
// ---------------------------------------------------------------------------

function PlanBacklink({
  clientId,
  trialDaysLeft,
}: {
  clientId: string;
  trialDaysLeft: number | null;
}) {
  if (!isHostedVaultRecord(clientId)) return null;
  return (
    <div className="mt-10 border-t border-border pt-4 text-sm">
      {/* Sanctioned ambience place 2 (§3.1): the backlink carries the trial
          line while trialing — plain otherwise. One link, one destination. */}
      <Link to="/account" className="text-fg-dim hover:text-accent">
        {trialDaysLeft !== null ? (
          <>
            <span className="font-medium text-sun-ink">
              Free trial ·{" "}
              {trialDaysLeft === 0
                ? "ends today"
                : `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left`}
            </span>{" "}
            · Manage your account →
          </>
        ) : (
          "Manage your account →"
        )}
      </Link>
    </div>
  );
}

function SavedViewsSidebar({
  views,
  isPending,
  error,
  canUpdateWithCurrent,
  onRename,
  onUpdate,
  onDelete,
}: {
  views: SavedView[] | undefined;
  isPending: boolean;
  error: Error | null;
  canUpdateWithCurrent: boolean;
  onRename: (view: SavedView) => void;
  onUpdate: (view: SavedView) => void;
  onDelete: (view: SavedView) => void;
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Close the menu when the user clicks/taps outside or presses Escape — small
  // dropdowns rendered inline like this don't get focus-trap behavior for free.
  useEffect(() => {
    if (!openMenuId) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-saved-view-menu]")) return;
      setOpenMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenuId(null);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenuId]);

  return (
    <aside>
      <h2 className="eyebrow mb-2">Saved views</h2>
      {isPending ? (
        <p className="text-xs text-fg-dim">Loading…</p>
      ) : error ? (
        <p className="text-xs text-danger">Could not load views.</p>
      ) : !views || views.length === 0 ? (
        <p className="text-xs text-fg-dim">
          None yet. Apply a filter and click “Save view” to add one.
        </p>
      ) : (
        <ul className="space-y-1" aria-label="Saved views">
          {views.map((v) => (
            <li
              key={v.id}
              className="group flex items-center rounded-lg border border-transparent hover:border-border hover:bg-card"
            >
              <Link
                to={`/notes?${filtersToSearchParams(v.filters).toString()}`}
                className="block flex-1 truncate px-2 py-1 text-sm text-fg-muted hover:text-accent"
              >
                {v.name}
              </Link>
              <div className="relative" data-saved-view-menu>
                <button
                  type="button"
                  onClick={() => setOpenMenuId((c) => (c === v.id ? null : v.id))}
                  aria-label={`Manage saved view ${v.name}`}
                  aria-haspopup="menu"
                  aria-expanded={openMenuId === v.id}
                  className="px-2 py-1 text-fg-dim hover:text-accent"
                >
                  <span aria-hidden="true" className="font-mono text-xs">
                    ⋯
                  </span>
                </button>
                {openMenuId === v.id ? (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-xl border border-border bg-card shadow-lift"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!canUpdateWithCurrent}
                      onClick={() => {
                        setOpenMenuId(null);
                        onUpdate(v);
                      }}
                      className="block w-full px-3 py-2 text-left text-sm text-fg-muted hover:bg-bg hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                      title={
                        canUpdateWithCurrent
                          ? undefined
                          : "Apply some filters first to update this view."
                      }
                    >
                      Update with current filters
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpenMenuId(null);
                        onRename(v);
                      }}
                      className="block w-full px-3 py-2 text-left text-sm text-fg-muted hover:bg-bg hover:text-accent"
                    >
                      Rename…
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpenMenuId(null);
                        onDelete(v);
                      }}
                      className="block w-full border-t border-border px-3 py-2 text-left text-sm text-danger hover:bg-bg"
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function RenameViewDialog({
  view,
  existing,
  isSaving,
  onCancel,
  onSave,
}: {
  view: SavedView;
  existing: SavedView[];
  isSaving: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(view.name);
  const trimmed = name.trim();
  // Same-name (no-op) is allowed-but-disabled — it's just clutter to send a
  // rename that doesn't change anything. Collision check skips the view itself
  // so re-typing its current name doesn't read as a collision.
  const collides = existing.some(
    (v) => v.id !== view.id && v.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const unchanged = trimmed === view.name;
  const canSave = trimmed.length > 0 && !collides && !unchanged && !isSaving;

  return (
    <div
      className="dialog-overlay"
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> requires imperative showModal()/close(); we want declarative open=!!renaming
      role="dialog"
      aria-modal="true"
      aria-label="Rename view"
    >
      <div className="dialog-panel max-w-(--w-narrow)">
        <h3 className="mb-3 font-serif text-lg text-fg">Rename view</h3>
        <label className="block text-sm">
          <span className="mb-1 block text-fg-muted">Name</span>
          <input
            type="text"
            value={name}
            // biome-ignore lint/a11y/noAutofocus: dialog focus
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) onSave(trimmed);
              if (e.key === "Escape") onCancel();
            }}
            aria-label="View name"
            className="input input-on-bg"
          />
        </label>
        {collides ? (
          <p className="mt-2 text-xs text-danger">A view with that name already exists.</p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn btn-secondary btn-touch">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => canSave && onSave(trimmed)}
            disabled={!canSave}
            className="btn btn-primary btn-touch"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SaveViewDialog({
  existing,
  isSaving,
  onCancel,
  onSave,
}: {
  existing: SavedView[];
  isSaving: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const collides = existing.some((v) => v.name.toLowerCase() === trimmed.toLowerCase());
  const canSave = trimmed.length > 0 && !collides && !isSaving;

  return (
    <div
      className="dialog-overlay"
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> requires imperative showModal()/close(); we want declarative open=showSaveDialog
      role="dialog"
      aria-modal="true"
      aria-label="Save view"
    >
      <div className="dialog-panel max-w-(--w-narrow)">
        <h3 className="mb-3 font-serif text-lg text-fg">Save view</h3>
        <label className="block text-sm">
          <span className="mb-1 block text-fg-muted">Name</span>
          <input
            type="text"
            value={name}
            // biome-ignore lint/a11y/noAutofocus: dialog focus
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) onSave(trimmed);
              if (e.key === "Escape") onCancel();
            }}
            placeholder="e.g. Daily journal"
            aria-label="View name"
            className="input input-on-bg"
          />
        </label>
        {collides ? (
          <p className="mt-2 text-xs text-danger">A view with that name already exists.</p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn btn-secondary btn-touch">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => canSave && onSave(trimmed)}
            disabled={!canSave}
            className="btn btn-primary btn-touch"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickTagControl({
  noteId,
  existing,
  suggestions,
}: {
  noteId: string;
  existing: string[];
  suggestions: TagRecord[];
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const update = useUpdateNote(noteId);
  const pushToast = useToastStore((s) => s.push);

  // Focus the input when opening; close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = normalizeTag(value).toLowerCase();
    const have = new Set(existing.map((t) => t.toLowerCase()));
    const pool = suggestions.filter((t) => !have.has(t.name.toLowerCase()));
    if (!q) return pool.slice(0, 8);
    return pool.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 8);
  }, [value, suggestions, existing]);

  const apply = useCallback(
    async (raw: string) => {
      const tag = normalizeTag(raw);
      if (!tag) return;
      try {
        await update.mutateAsync({ tags: { add: [tag] } });
        pushToast(`Added #${tag}`, "success");
        setValue("");
        setOpen(false);
      } catch (err) {
        pushToast(`Could not add tag: ${(err as Error).message}`, "error");
      }
    },
    [update, pushToast],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-sm border border-border bg-bg/60 text-fg-muted hover:border-accent hover:text-accent"
        aria-label="Add tag"
      >
        + tag
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply(value);
          }
        }}
        placeholder="tag…"
        aria-label="Tag name"
        disabled={update.isPending}
        className="input w-32 px-2 py-1 text-xs"
      />
      {filtered.length > 0 ? (
        <ul
          className="absolute right-0 z-20 mt-1 max-h-48 w-44 overflow-y-auto rounded-xl border border-border bg-card text-xs shadow-lift"
          aria-label="Tag suggestions"
        >
          {filtered.map((t) => (
            <li key={t.name}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  apply(t.name);
                }}
                className="flex w-full items-center justify-between px-2 py-1 text-left text-fg hover:bg-bg/60"
              >
                <span className="truncate">{t.name}</span>
                <span className="ml-2 shrink-0 text-fg-dim">{t.count ?? 0}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// The maintenance views (LENS-SPEC §1 — filters, NOT lenses), folded into the
// Filters panel's Refine column: Untagged and Orphaned are vault-upkeep
// passes over the full collection, so they live with the other refiners
// instead of the retired resting chip row. Same `?view=` URLs as always (old
// bookmarks + the /untagged & /orphaned shims keep working); the active chip
// links back to /notes so the filter toggles off the way it toggled on.
function MaintenanceViewsRow({ active }: { active?: VaultView }) {
  const items: Array<{ view: VaultView; label: string }> = [
    { view: "untagged", label: "Untagged" },
    { view: "orphaned", label: "Orphaned" },
  ];
  return (
    <nav aria-label="Show only" className="flex flex-wrap items-center gap-2">
      <span className="text-fg-muted text-sm">Show only:</span>
      {items.map((it) => {
        const isActive = it.view === active;
        return (
          <Link
            key={it.view}
            to={isActive ? "/notes" : `/notes?view=${it.view}`}
            aria-current={isActive ? "page" : undefined}
            className={`chip focus-ring max-w-full ${
              isActive ? "chip-tag-active font-medium" : "chip-tag"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

// The PARKED PresetFilterBar that lived here (LZ-3) was reborn in LZ-5 as
// the mobile LensStrip (components/LensStrip.tsx) — same spot in the anatomy
// (a chip row under the masthead), but projected from the nav model's lens
// band instead of carrying its own view list.

function SkeletonRows() {
  return (
    <ol className="flex flex-col gap-0.5" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="rounded-xl px-3 py-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </li>
      ))}
    </ol>
  );
}

function NotesErrorBlock({ error, retry }: { error: Error; retry: () => void }) {
  const isAuth = error instanceof VaultAuthError;
  return (
    <ErrorState
      title={isAuth ? "Session expired" : "Could not load notes"}
      message={error.message}
      retry={isAuth ? undefined : retry}
      action={
        isAuth ? (
          <Link to="/add" className="btn btn-primary">
            Reconnect vault
          </Link>
        ) : undefined
      }
    />
  );
}

function NotesEmptyBlock({ filtering }: { filtering: boolean }) {
  if (filtering) {
    return <EmptyState title="No notes match these filters." />;
  }
  return (
    <EmptyState
      title="This vault has no notes yet."
      action={
        <Link to="/new" className="btn btn-primary">
          Create one
        </Link>
      }
    />
  );
}
