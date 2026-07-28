import { NoteRow, NoteRowList } from "@/components/NoteRow";
import { TagSchemaEditor } from "@/components/TagSchemaEditor";
import { ViewNavIcon } from "@/components/ViewNavIcon";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { RefinementChip } from "@/components/ui/RefinementChip";
import { Skeleton } from "@/components/ui/Skeleton";
import { BoardView } from "@/components/views/BoardView";
import { CalendarView } from "@/components/views/CalendarView";
import { FieldsControl } from "@/components/views/FieldsControl";
import { GalleryView } from "@/components/views/GalleryView";
import { DateFieldControl, GroupByControl, LensSwitcher } from "@/components/views/LensSwitcher";
import { NoteFieldChips } from "@/components/views/NoteFieldChips";
import { TableView } from "@/components/views/TableView";
import { useToastStore } from "@/lib/toast/store";
import { useCreateNote, useUpdateNote, useVaultStore } from "@/lib/vault";
import { useTagRoles } from "@/lib/vault/settings";
import type { TagRoles } from "@/lib/vault/tag-roles";
import type { Note, TagFieldSchema } from "@/lib/vault/types";
import {
  type ViewConfigDraft,
  applyConfig,
  configDraftToSearchParams,
  draftPatchMetadata,
  fullConfigMetadata,
  hasConfigDraft,
  normalizeConfigDraft,
  searchParamsToConfigDraft,
  withLens,
} from "@/lib/views/config";
import { viewPathForName } from "@/lib/views/defaults";
import {
  type ResolvedField,
  singleQueryTag,
  useResolvedViewFields,
  useSchemaFields,
  useSchemaReady,
} from "@/lib/views/fields";
import { useViewModifiedBar } from "@/lib/views/modified-bar";
import { partitionPinned } from "@/lib/views/partition";
import { defaultSaveMode, useMySub, useViewNote, useViewResults } from "@/lib/views/queries";
import {
  type BaseChip,
  type ViewRefinements,
  composeViewQuery,
  describeBaseQuery,
  hasRefinements,
  primaryQueryTag,
  queryTags,
  refinementsToSearchParams,
  searchParamsToRefinements,
} from "@/lib/views/query";
import { type ViewDef, type ViewProblem, decodeViewDef } from "@/lib/views/schema";
import type { QueryKey } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";

// The rendering pipeline (VIEWS-RENDER-SPEC §2):
//
//   note ──decodeViewDef──► ViewDef ──(+ URL refinements)──► useViewResults
//         ──partitionPinned──► KindRenderer (list only, wave 1)
//
// Mounted at /views/:id — note ID, not path (ids survive renames).

// The back link to /notes — shared by the loaded body and the loading/error
// shells so every state of this route keeps the same escape hatch.
function BackNav() {
  return (
    <nav className="mb-6 text-sm text-fg-dim">
      <Link to="/notes" className="focus-ring hover:text-accent">
        ← All notes
      </Link>
    </nav>
  );
}

export function ViewSurface() {
  // `:id` arrives ALREADY decoded (the router decodes params); a second
  // decodeURIComponent threw on ids with a literal `%` — see TagPage.tsx
  // for the full framing. Decode once, at the boundary. (app#113)
  const { id: decodedId } = useParams<{ id: string }>();
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const note = useViewNote(decodedId);

  // NAVIGATION.md: route guard, no active vault — replace.
  if (!activeVault) return <Navigate to="/" replace />;

  // The loaded body owns its OWN page wrapper — a board/table earns a wider
  // width than the reading-width shell, which only the resolved kind knows
  // (below). Loading/error/not-found stay at the reading width.
  if (note.data) return <ViewSurfaceBody note={note.data} />;

  return (
    <div className="page">
      <BackNav />
      {note.isPending ? (
        <ViewSurfaceSkeleton />
      ) : note.isError ? (
        <ErrorState
          title="Couldn't load this view"
          message={note.error instanceof Error ? note.error.message : undefined}
          retry={() => note.refetch()}
        />
      ) : (
        <EmptyState title="View not found" description="It may have been deleted or moved." />
      )}
    </div>
  );
}

function ViewSurfaceSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton height={32} width="40%" />
      <Skeleton height={20} width="60%" />
      <div className="space-y-2 pt-4">
        <Skeleton height={56} />
        <Skeleton height={56} />
        <Skeleton height={56} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Body — decodes the note, reads refinements from the URL, executes, renders.
// ---------------------------------------------------------------------------

function ViewSurfaceBody({ note }: { note: Note }) {
  const def = useMemo(() => decodeViewDef(note), [note]);
  return <ViewCanvas def={def} backingNote={note} nav={<BackNav />} />;
}

// The shared view CANVAS — controls, refinement bar, problems, results, and
// (only when there's a real note behind it) the explore-then-save affordance.
// `ViewSurface` drives it from a decoded `#view` note; the `/tags/:name`
// derived-view page (`TagPage.tsx`) drives it from `deriveTagViewDef`'s def
// with `backingNote={null}`. A null backing note has NO id to fetch or PATCH,
// so it gates off both the "Edit view note" header link and the whole Save
// path — the real Save-as-view flow for a derived page is a later wave.
export function ViewCanvas({
  def,
  backingNote,
  pageSize,
  total,
  nav,
}: {
  def: ViewDef;
  backingNote: Note | null;
  /**
   * The breadcrumb rendered inside this canvas's page wrapper (each route's own
   * "← All notes" / "← Tags"). The canvas OWNS the wrapper because the wrapper's
   * width is `wide` — board/table earn `.page-wide` — and `wide` is read from
   * the draft-inclusive `effDef` that lives only here: switch a list view to a
   * board and the page must widen, which a caller holding just `def` couldn't
   * do. So the breadcrumb rides in as a node rather than the callers owning the
   * wrapper.
   */
  nav?: ReactNode;
  /**
   * When set (> 0) the canvas PAGES its results at this size instead of
   * rendering the whole set — the derived tag page passes it so a tag on
   * hundreds of notes opens as one page (a header count, 50 rows, a pager),
   * not a thousands-of-pixels-tall wall. Paging is poll-only (`live: false`
   * below): a live snapshot is always the complete matching set, so it can't
   * be windowed by a `limit`. Absent (a saved `#view`) → today's unpaged,
   * live behavior, byte-identical.
   */
  pageSize?: number;
  /**
   * Total notes carrying this page's tag (`tag.count`) — the "N notes" size the
   * header shows while nothing has narrowed the view. It is NOT the pager's
   * next-page oracle: the archived exclusion and live refinements narrow the
   * rendered set below it, so the pager rides a one-row peek instead (see the
   * fetch below) and only ever shows "of N" once that peek has proven the end.
   */
  total?: number;
}) {
  const vault = useVaultStore((s) => s.getActiveVault());
  const { roles } = useTagRoles(vault?.id ?? null);
  const paginated = typeof pageSize === "number" && pageSize > 0;
  const [offset, setOffset] = useState(0);

  // One URL, two explore-then-save axes (train B): the QUERY refinements
  // (§5 — `tag`/`noExclude`/`search`/`sort`) and the CONFIG draft
  // (`kind`/`group`/`date`/`fields`). Disjoint param names; every write
  // re-emits BOTH so changing one axis never drops the other. `replace:
  // true` throughout — exploration never spams history; leaving discards
  // silently, back restores, a shared link carries it.
  const [searchParams, setSearchParams] = useSearchParams();
  const refinements = useMemo(() => searchParamsToRefinements(searchParams), [searchParams]);
  // Normalized on READ as well as write (review should-fix): a shared link
  // carrying params equal to the saved config (`?kind=list` on a list view)
  // is no divergence — no bar over a view that looks exactly like itself.
  const draft = useMemo(
    () => normalizeConfigDraft(def, searchParamsToConfigDraft(searchParams)),
    [def, searchParams],
  );
  const writeParams = (nextDraft: ViewConfigDraft, nextRefinements: ViewRefinements) => {
    const params = configDraftToSearchParams(nextDraft);
    for (const [k, v] of refinementsToSearchParams(nextRefinements)) params.append(k, v);
    setSearchParams(params, { replace: true });
  };
  const setRefinements = (next: ViewRefinements) => writeParams(draft, next);
  // Normalize on write: a control set back to the saved value clears its key,
  // so the modified bar disappears exactly when the config matches the note.
  const setDraft = (next: ViewConfigDraft) => {
    writeParams(normalizeConfigDraft(def, next), refinements);
  };

  // The EFFECTIVE def this render explores — saved note + draft overlay.
  // Lossless lens switching by construction: `useViewResults`' cache key is
  // built from the composed QUERY only (kind/group/date/fields never enter
  // it), so `effDef` re-renders the same cached result set without a refetch.
  const effDef = useMemo(() => applyConfig(def, draft), [def, draft]);

  // Paging (tag page): jump back to the first page whenever the RESULT SET
  // changes — a different tag, or a refinement that narrows it — so we never
  // sit on an offset past the end. `applyConfig` leaves `query` untouched, so
  // switching lens (list↔table) keeps your page.
  const resetKey = useMemo(
    () => JSON.stringify({ q: effDef.query, r: refinements }),
    [effDef.query, refinements],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is the trigger; setOffset is stable
  useEffect(() => {
    setOffset(0);
  }, [resetKey]);

  // The FETCHED def carries the page window (offset) AND a one-row peek on top
  // of the page size. Fetching `pageSize + 1` and rendering `pageSize` answers
  // "is there a next page?" as a FACT — does row 51 exist? — the same window
  // mechanism the All-notes list uses (app#109). Inferring it from a `total`
  // instead left the archived exclusion and any live refinement — both of which
  // narrow the set below the tag's own count — able to leave Next enabled into
  // empty trailing pages. Unpaged callers fetch the def unchanged.
  const fetchDef = useMemo(() => {
    if (!paginated || !effDef.query) return effDef;
    return { ...effDef, query: { ...effDef.query, offset, limit: pageSize! + 1 } };
  }, [paginated, effDef, offset, pageSize]);

  // Paged surfaces poll (no live subscription): a live snapshot is always the
  // complete matching set, which would clobber the page window (see
  // `useViewResults`' `live` option).
  const results = useViewResults(fetchDef, refinements, { live: !paginated });
  // The page renders `pageSize` rows; the (pageSize+1)-th, when present, is the
  // peek — proof a next page exists, never itself shown. Unpaged callers render
  // the whole set.
  const pageData = useMemo(
    () => (paginated && results.data ? results.data.slice(0, pageSize) : results.data),
    [paginated, results.data, pageSize],
  );
  const shownCount = pageData?.length ?? 0;
  const hasNextPage = paginated ? (results.data?.length ?? 0) > pageSize! : false;
  // Two totals, two meanings. The PAGER may only ever show one it can PROVE:
  // the peek makes the exact count a fact once there is no next page
  // (`offset + shown`); before that the true result total is unknowable — the
  // archived exclusion and any refinement both narrow it below the tag's own
  // count, and no count endpoint exists until vault#626 — so the pager shows
  // "of N" only at that proven end and a bare range otherwise. The HEADER's
  // "N notes" is a different quantity: the tag's own membership size
  // (`tag.count`), a stable, true tag-level fact worth keeping while the viewer
  // hasn't narrowed the view with a refinement (a refinement makes it read as
  // the result count, which it isn't, so it's dropped then).
  const narrowed = hasRefinements(refinements);
  const provenTotal = paginated && !hasNextPage ? offset + shownCount : undefined;
  const headerCount = narrowed ? undefined : total;
  // The view's shown/editable fields (Part B) — the tag-schema default or the
  // view's `fields` override — resolved once and threaded to every kind, so a
  // card/row can show + edit them through the shared mutation primitive.
  const fields = useResolvedViewFields(effDef);
  // The Fields control's union source — the primary tag's declared schema (a
  // hidden schema field must still be offered for checking) — and the type
  // source for the Fields/Group-by menus' glyphs and sectioning.
  const schemaFields = useSchemaFields(effDef);
  const problems: ViewProblem[] = [...effDef.problems, ...results.problems];

  const partition = useMemo(() => {
    if (!pageData) return { pinned: [], rest: [] };
    return partitionPinned(pageData, roles.pinned, queryTags(effDef.query));
  }, [pageData, roles.pinned, effDef.query]);

  // ONE bar covers both axes — query edits are config too (decision 1). Save
  // only exists with a real note behind the view: a derived tag page
  // (`backingNote === null`) has nothing to update, and its Save-as-view flow
  // is a later wave — so we hide the bar rather than surface a Save that would
  // PATCH the synthetic `derived:tag:<name>` id. Exploration stays fully
  // reversible through the controls themselves (the lens switcher, the
  // refinement chips' × removers).
  const canSave = backingNote !== null;
  const modified = hasConfigDraft(draft) || hasRefinements(refinements);
  const showModifiedBar = modified && canSave;
  const [showSave, setShowSave] = useState(false);
  // Revert discards the exploration — clear the URL, write nothing.
  const revert = () => setSearchParams(new URLSearchParams(), { replace: true });

  // --- The field on-ramp -----------------------------------------------
  //
  // The view's SINGLE query tag — the same tag `resolveViewFields` reads its
  // schema from. `null` for a multi-tag or tagless query: nothing to add a
  // field to, and the pills say so rather than inviting an impossible one
  // (`NO_PRIMARY_TAG_NOTE`).
  const primaryTag = useMemo(() => singleQueryTag(effDef.query), [effDef.query]);
  // Whether the primary tag's schema has actually answered — so the empty
  // controls only invite "add a field" once the fetch confirms the absence,
  // never during the load window on a tag that does declare fields.
  const schemaReady = useSchemaReady(effDef);
  // The on-ramp is now purely: NOTICE the absence, open the shipped tag-schema
  // editor so the USER names the field (Aaron, 2026-07-25 — the app proposes
  // no field vocabulary of its own). The intent routes the editor's starter
  // row and, on save, which axis auto-adopts the field; `null` = closed.
  const [addFieldIntent, setAddFieldIntent] = useState<"group" | "date" | null>(null);

  /**
   * After the editor writes the tag schema, organize by the field the user
   * just made — the old one-click flow's auto-select, but for a field THEY
   * named. The pick is by TYPE, never by name: the group axis takes the first
   * field that declares values (its enum renders the empty lanes), else the
   * first non-date field; the date axis takes the first date-typed field.
   * `useUpdateTag` has already written the new record into the tag cache, so
   * the draft resolves against it on this same tick. The `group_by`/
   * `date_field` rides the URL DRAFT, not the note — Save stays explicit
   * (train B's explore-then-save model): revert and you keep the field, the
   * view untouched.
   */
  const onSchemaSaved = (fields: Record<string, TagFieldSchema>) => {
    const intent = addFieldIntent;
    if (!intent) return;
    const entries = Object.entries(fields);
    const pick =
      intent === "date"
        ? entries.find(([, s]) => s.type === "date")?.[0]
        : (entries.find(([, s]) => (s.enum?.length ?? 0) > 0) ??
            entries.find(([, s]) => s.type !== "date"))?.[0];
    if (pick) setDraft({ ...draft, [intent === "group" ? "groupBy" : "dateField"]: pick });
  };

  // Board and table read ACROSS — grids, not prose — so they get the wider
  // `.page-wide` ceiling instead of the reading-width cap that would clip a
  // multi-lane board (e.g. the on-ramp's To do / In progress / Done + the
  // uncategorized lane). List / calendar / gallery keep the reading width.
  const wide = effDef.kind === "board" || effDef.kind === "table";

  return (
    <div className={wide ? "page page-wide" : "page"}>
      {nav}
      <article className={showModifiedBar ? "pb-20" : undefined}>
        <ViewHeader def={effDef} backingNote={backingNote} count={headerCount} />
        {/* The controls row (polish V3): lens pill first (the view's identity),
          the organize-by pill second (board/calendar only — and it renders
          even with nothing to offer), Fields third. Each pill tints its
          border when ITS key diverges from the saved def. */}
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-2 py-1">
          <LensSwitcher
            kind={effDef.kind}
            onSwitch={(kind) => setDraft(withLens(def, draft, kind, fields))}
            dirty={def.kind !== effDef.kind}
          />
          {effDef.kind === "board" ? (
            <GroupByControl
              value={effDef.groupBy}
              fields={fields}
              onChange={(name) => setDraft({ ...draft, groupBy: name })}
              dirty={def.groupBy !== effDef.groupBy}
              createTag={primaryTag}
              schemaReady={schemaReady}
              onAddField={() => setAddFieldIntent("group")}
            />
          ) : null}
          {effDef.kind === "calendar" ? (
            <DateFieldControl
              value={effDef.dateField}
              fields={fields}
              onChange={(name) => setDraft({ ...draft, dateField: name })}
              dirty={def.dateField !== effDef.dateField}
              createTag={primaryTag}
              schemaReady={schemaReady}
              onAddField={() => setAddFieldIntent("date")}
            />
          ) : null}
          {/* Fields matter to EVERY lens — chips, cards, and calendar entries
            all render the one resolved set — so this control is unconditional. */}
          <FieldsControl
            fields={fields}
            schemaFields={schemaFields}
            onChange={(names) => setDraft({ ...draft, fields: names })}
            dirty={def.fields !== effDef.fields}
          />
        </div>
        <RefinementBar def={def} refinements={refinements} onChange={setRefinements} />
        {problems.length > 0 ? <ProblemsBanner problems={problems} /> : null}
        <div className="mt-6">
          <ViewResults
            def={effDef}
            data={pageData}
            isPending={results.isPending}
            isError={results.isError}
            error={results.error}
            retry={results.refetch}
            viewResultsKey={results.queryKey}
            fields={fields}
            pinned={partition.pinned}
            rest={partition.rest}
            roles={roles}
          />
        </div>
        {paginated ? (
          <ViewPager
            offset={offset}
            shown={shownCount}
            total={provenTotal}
            hasPrev={offset > 0}
            hasNext={hasNextPage}
            onPrev={() => setOffset((o) => Math.max(0, o - pageSize!))}
            onNext={() => setOffset((o) => o + pageSize!)}
          />
        ) : null}
        {showModifiedBar ? (
          <ViewModifiedBar onSave={() => setShowSave(true)} onRevert={revert} />
        ) : null}
        {showSave && backingNote ? (
          <SaveSheet
            note={backingNote}
            def={def}
            draft={draft}
            refinements={refinements}
            roles={roles}
            onClose={() => setShowSave(false)}
            onSaved={revert}
          />
        ) : null}
        {/* The on-ramp's editor — the shipped Tags-page schema editor, mounted
          here so naming a field never costs a trip out of the view. `intent`
          orients its starter row (a values-bearing field for a board, a date
          field for a calendar); `onSaved` auto-adopts what the user made. */}
        {addFieldIntent && primaryTag ? (
          <TagSchemaEditor
            tagName={primaryTag}
            intent={addFieldIntent}
            onSaved={onSchemaSaved}
            onClose={() => setAddFieldIntent(null)}
          />
        ) : null}
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The modified bar — the explore-then-save affordance for CONFIG + QUERY
// divergence (train B). Distinct from DATA writes (chips, board moves),
// which stay immediate and never wait here. A bottom-anchored strip: above
// the BottomTabBar below lg (which is `bottom-0 z-20`, content padded
// `pb-16`), at the screen bottom on desktop where the tab bar is hidden.
// ---------------------------------------------------------------------------

function ViewModifiedBar({ onSave, onRevert }: { onSave: () => void; onRevert: () => void }) {
  // While the bar is on screen the AmbientMapFab (same corner, same z) hides
  // — mount/unmount IS the signal (Revert, Save, and leaving all unmount).
  const setShown = useViewModifiedBar((s) => s.setShown);
  useEffect(() => {
    setShown(true);
    return () => setShown(false);
  }, [setShown]);

  return (
    <div
      aria-label="View modified"
      // Below lg the strip rests on the BottomTabBar: h-14 of content plus
      // its own env(safe-area-inset-bottom) padding — so the offset must be
      // 3.5rem + the inset, not a hardcoded 4rem, or a notched phone's tab
      // bar covers the bottom of Save/Revert (review must-fix).
      className="glass-panel fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-border lg:bottom-0 lg:pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex w-full max-w-(--w-page) items-center justify-between gap-3 px-5 py-2.5 md:px-10">
        {/* The bar's voice (polish V6): a live accent dot (stilled under
            reduced motion — the gate in index.css) + copy that says what
            state you're in and what Save does, not just that state exists. */}
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="view-modified-pulse h-2 w-2 shrink-0 rounded-full bg-accent"
          />
          <p className="min-w-0 text-sm text-fg-muted">
            <span className="font-medium text-fg">View modified</span> — you're exploring. Save to
            keep this layout.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onRevert} className="btn btn-secondary btn-touch">
            Revert
          </button>
          <button type="button" onClick={onSave} className="btn btn-primary btn-touch">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header — hue+kind mark, title, "Edit view note" (the note-editor bridge).
// ---------------------------------------------------------------------------

function ViewHeader({
  def,
  backingNote,
  count,
}: {
  def: ViewDef;
  backingNote: Note | null;
  /** When set, the "size of what you're looking at" line under the title (a
      paged derived tag page passes the tag's note count). */
  count?: number;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <ViewNavIcon kind={def.kind} hueTag={primaryQueryTag(def.query)} />
        <div className="min-w-0">
          <h1 className="page-title truncate">{def.title}</h1>
          {typeof count === "number" ? (
            <p className="text-sm text-fg-dim">
              {count === 1 ? "1 note" : `${count.toLocaleString()} notes`}
            </p>
          ) : null}
        </div>
      </div>
      {/* The note-editor bridge exists only for a real `#view` note. A derived
          tag page (`backingNote === null`) builds no edit link from its
          synthetic id — there's nothing there to open. */}
      {backingNote ? (
        <Link
          to={`/n/${encodeURIComponent(backingNote.id)}/edit`}
          className="btn btn-secondary btn-touch"
        >
          Edit view note
        </Link>
      ) : null}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Pager — the SAME offset window the Notes list uses (`VaultSurface`): a
// "Showing m–n" line (+ "of total" once the total is a proven fact) and
// Previous/Next. Only the derived tag page mounts it (via `pageSize`); a saved
// `#view` renders unpaged as before. `hasNext`/`hasPrev` arrive as FACTS the
// canvas derives from the one-row peek and the offset — never inferred from
// `total`, so Next can't run into empty trailing pages when the archived
// exclusion or a refinement has narrowed the set below the tag's own count.
// `total` is passed only when proven (the peek showed no next page); otherwise
// the line is a bare range.
// ---------------------------------------------------------------------------

function ViewPager({
  offset,
  shown,
  total,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  offset: number;
  shown: number;
  /** The result total — passed ONLY when proven (end reached); else undefined. */
  total: number | undefined;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const first = shown > 0 ? offset + 1 : 0;
  const last = offset + shown;
  // Nothing to page and nowhere paged from — render nothing (a small tag).
  if (!hasPrev && !hasNext) return null;
  return (
    <div className="mt-6 flex items-center justify-between text-fg-dim text-sm">
      <span>
        {shown > 0
          ? typeof total === "number"
            ? `Showing ${first}–${last} of ${total.toLocaleString()}`
            : `Showing ${first}–${last}`
          : ""}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!hasPrev}
          onClick={onPrev}
          className="btn btn-secondary btn-touch"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={!hasNext}
          onClick={onNext}
          className="btn btn-secondary btn-touch"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Problems banner — degrade honestly, never blank (§3).
// ---------------------------------------------------------------------------

function ProblemsBanner({ problems }: { problems: ViewProblem[] }) {
  return (
    <output
      aria-live="polite"
      className="mt-4 block rounded-lg border border-[--color-warning] bg-[--color-warning-soft] p-3 text-sm text-fg"
    >
      <ul className="list-disc space-y-1 pl-5">
        {problems.map((p, i) => (
          <li key={`${p.code}-${i}`}>{p.message}</li>
        ))}
      </ul>
    </output>
  );
}

// ---------------------------------------------------------------------------
// Results — shared state guards (§3), then dispatch on the view's KIND
// (Views Wave 2b). list is byte-identical to before; board/gallery/calendar/
// table each render the SAME fetched results a different way. An unknown kind —
// or a board missing its lane config — falls through to the list, the one
// shape a view is never wrong to render as (§1). Calendar never falls through
// (train F): without a date field it mounts read-only, plotting by createdAt.
// ---------------------------------------------------------------------------

function ViewResults({
  def,
  data,
  isPending,
  isError,
  error,
  retry,
  viewResultsKey,
  fields,
  pinned,
  rest,
  roles,
}: {
  def: ViewDef;
  data: Note[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  retry: () => void;
  viewResultsKey: QueryKey;
  fields: ResolvedField[];
  pinned: Note[];
  rest: Note[];
  roles: TagRoles;
}) {
  // §3: an unparseable query never fetches — nothing to render but the
  // problems banner above (already shown) plus a quiet placeholder here.
  if (def.query === null) {
    return (
      <EmptyState
        title="Nothing is being shown"
        description="Fix the view's query to see results."
      />
    );
  }
  if (isPending) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton height={56} />
        <Skeleton height={56} />
        <Skeleton height={56} />
      </div>
    );
  }
  if (isError) {
    return (
      <ErrorState
        title="Couldn't run this view"
        message={error instanceof Error ? error.message : undefined}
        retry={retry}
      />
    );
  }
  if (!data || (pinned.length === 0 && rest.length === 0)) {
    return <EmptyState title="No notes match this view yet." />;
  }

  // board/gallery/calendar all read one flat set — pinning surfaces within a
  // lane / grid / day rather than as its own band (the list's Pinned section
  // is the only kind that partitions).
  const all = [...pinned, ...rest];
  switch (def.kind) {
    case "board":
      if (def.groupBy) {
        return (
          <BoardView
            notes={all}
            laneBy={def.groupBy}
            subjectTag={primaryQueryTag(def.query)}
            roles={roles}
            viewResultsKey={viewResultsKey}
            fields={fields}
          />
        );
      }
      break;
    case "gallery":
      return (
        <GalleryView notes={all} roles={roles} viewResultsKey={viewResultsKey} fields={fields} />
      );
    case "table":
      // No required config (unlike board's group-by / calendar's date field):
      // zero resolved fields is still a coherent table — the title column.
      return (
        <TableView notes={all} roles={roles} viewResultsKey={viewResultsKey} fields={fields} />
      );
    case "calendar":
      // ALWAYS the calendar (train F, D8) — with no date field it plots by
      // createdAt in read-only mode (the hint points at the Date-field
      // control above, still rendered, as the graduation path).
      return (
        <CalendarView
          notes={all}
          dateField={def.dateField || null}
          roles={roles}
          viewResultsKey={viewResultsKey}
          fields={fields}
        />
      );
  }
  return (
    <ListResults
      pinned={pinned}
      rest={rest}
      roles={roles}
      viewResultsKey={viewResultsKey}
      fields={fields}
    />
  );
}

function ListResults({
  pinned,
  rest,
  roles,
  viewResultsKey,
  fields,
}: {
  pinned: Note[];
  rest: Note[];
  roles: { pinned: string; archived: string };
  viewResultsKey: QueryKey;
  fields: ResolvedField[];
}) {
  // The list row's editable field-chips band (Part C), when fields resolve —
  // rendered outside the row's anchor via NoteRow's `footer` slot, written
  // through the same shared mutation primitive as every other kind.
  const footerFor = (n: Note) =>
    fields.length > 0 ? (
      <NoteFieldChips note={n} fields={fields} viewResultsKey={viewResultsKey} />
    ) : null;
  return (
    <div className="space-y-6">
      {pinned.length > 0 ? (
        <section aria-label="Pinned">
          <p className="eyebrow mb-2">Pinned</p>
          <NoteRowList aria-label="Pinned notes">
            {pinned.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                pinnedTag={roles.pinned}
                archivedTag={roles.archived}
                footer={footerFor(n)}
              />
            ))}
          </NoteRowList>
        </section>
      ) : null}
      {rest.length > 0 ? (
        <section aria-label="Results">
          <NoteRowList aria-label="View results">
            {rest.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                pinnedTag={roles.pinned}
                archivedTag={roles.archived}
                footer={footerFor(n)}
              />
            ))}
          </NoteRowList>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Refinement bar — base chips (readable, quiet) + refinement chips
// (dismissable) + the add-filter controls (§5). Saving moved to the
// ViewModifiedBar (train B) — one Save/Revert affordance covers query
// refinements AND the config draft.
// ---------------------------------------------------------------------------

function RefinementBar({
  def,
  refinements,
  onChange,
}: {
  def: ViewDef;
  refinements: ViewRefinements;
  onChange: (next: ViewRefinements) => void;
}) {
  const baseChips = useMemo(() => describeBaseQuery(def.query), [def.query]);

  const toggleExclude = (tag: string) => {
    const on = refinements.removeExcludes.includes(tag);
    onChange({
      ...refinements,
      removeExcludes: on
        ? refinements.removeExcludes.filter((t) => t !== tag)
        : [...refinements.removeExcludes, tag],
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      {baseChips.map((chip) => (
        <BaseChipButton
          key={`${chip.kind}-${chip.value ?? chip.label}`}
          chip={chip}
          toggled={
            chip.kind === "exclude" &&
            !!chip.value &&
            refinements.removeExcludes.includes(chip.value)
          }
          onToggle={
            chip.kind === "exclude" && chip.value ? () => toggleExclude(chip.value!) : undefined
          }
        />
      ))}

      {refinements.addTags.map((t) => (
        <RefinementChip
          key={`add-${t}`}
          label={`+#${t}`}
          onRemove={() =>
            onChange({ ...refinements, addTags: refinements.addTags.filter((x) => x !== t) })
          }
        />
      ))}
      {refinements.search ? (
        <RefinementChip
          label={`"${refinements.search}"`}
          onRemove={() => onChange({ ...refinements, search: undefined })}
        />
      ) : null}
      {refinements.sort ? (
        <RefinementChip
          label={`sorted by ${refinements.sort === "desc" ? "newest" : "oldest"}`}
          onRemove={() => onChange({ ...refinements, sort: undefined })}
        />
      ) : null}

      <AddTagControl
        onAdd={(tag) => onChange({ ...refinements, addTags: [...refinements.addTags, tag] })}
      />
      <SearchControl
        value={refinements.search ?? ""}
        onChange={(search) => onChange({ ...refinements, search: search || undefined })}
      />
      <SortControl
        value={refinements.sort}
        onChange={(sort) => onChange({ ...refinements, sort })}
      />
    </div>
  );
}

function BaseChipButton({
  chip,
  toggled,
  onToggle,
}: {
  chip: BaseChip;
  toggled: boolean;
  onToggle?: () => void;
}) {
  // Only the exclude chip toggles (§5: "removing the not #archived base
  // chip... is how you peek at archived"); every other base chip is a
  // read-only, non-destructive label of the view's own query.
  if (onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={!toggled}
        title={toggled ? "Excluded again — tap to peek" : "Tap to peek at these too"}
        className={`chip ${toggled ? "opacity-50 line-through" : ""}`}
      >
        {chip.label}
      </button>
    );
  }
  return <span className="chip">{chip.label}</span>;
}

function AddTagControl({ onAdd }: { onAdd: (tag: string) => void }) {
  const [value, setValue] = useState("");
  const submit = () => {
    const tag = value.trim().replace(/^#/, "");
    if (!tag) return;
    onAdd(tag);
    setValue("");
  };
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      }}
      placeholder="+ tag"
      aria-label="Add a tag filter"
      className="w-24 rounded-full border border-border bg-bg/40 px-2.5 py-1 text-xs text-fg focus:border-accent focus:outline-none"
    />
  );
}

function SearchControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search…"
      aria-label="Search within this view"
      className="w-32 rounded-full border border-border bg-bg/40 px-2.5 py-1 text-xs text-fg focus:border-accent focus:outline-none"
    />
  );
}

function SortControl({
  value,
  onChange,
}: {
  value: "asc" | "desc" | undefined;
  onChange: (v: "asc" | "desc" | undefined) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(value === "desc" ? "asc" : value === "asc" ? undefined : "desc")}
      className="chip"
      aria-label="Cycle sort order"
    >
      {value === "desc" ? "Newest first" : value === "asc" ? "Oldest first" : "Sort"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Save sheet — mutate-when-you-own / fork-when-you-don't (§5), now saving
// BOTH axes (train B): the merged query AND the config draft.
// ---------------------------------------------------------------------------

function SaveSheet({
  note,
  def,
  draft,
  refinements,
  roles,
  onClose,
  onSaved,
}: {
  note: Note;
  def: ViewDef;
  draft: ViewConfigDraft;
  refinements: ViewRefinements;
  roles: TagRoles;
  onClose: () => void;
  onSaved: () => void;
}) {
  const pushToast = useToastStore((s) => s.push);
  const mySub = useMySub();
  const defaultMode = defaultSaveMode(note, mySub);
  const [mode, setMode] = useState<"update" | "fork">(defaultMode);
  const [name, setName] = useState(`${def.title} (copy)`);
  const [pending, setPending] = useState(false);

  const updateNote = useUpdateNote(note.id);
  const createNote = useCreateNote();

  const doSave = async () => {
    setPending(true);
    try {
      // §5: the merged query is written EXPLICITLY — including any
      // exclude_tags the base carried — never a surface-side default. A
      // `null` base (unparseable, §3) stays null: the builders then OMIT
      // the query key rather than writing "{}" (which would promote "run
      // nothing" into match-everything — review should-fix).
      const merged = composeViewQuery(def.query, refinements);
      if (mode === "update") {
        // Partial patch: kind + query, plus EXACTLY the config keys the
        // draft overrides (vault merges metadata key-level, so untouched
        // config keys on the note survive).
        await updateNote.mutateAsync({
          metadata: draftPatchMetadata(def, draft, merged),
          ...(note.updatedAt ? { if_updated_at: note.updatedAt } : { force: true }),
        });
        pushToast(`Updated "${def.title}".`, "success");
      } else {
        await createNote.mutateAsync({
          content: "",
          path: viewPathForName(name),
          tags: [roles.view],
          // The FULL effective config, not just kind+query — forking a
          // board keeps its lanes (train-B fix: group_by/date_field/fields
          // used to be silently dropped).
          metadata: fullConfigMetadata(applyConfig(def, draft), merged),
        });
        pushToast(`Saved "${name}".`, "success");
      }
      onSaved();
      onClose();
    } catch (err) {
      pushToast(`Could not save: ${(err as Error).message}`, "error");
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="dialog-overlay"
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> requires imperative showModal()/close(); we want declarative open={showSave}
      role="dialog"
      aria-labelledby="save-view-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-panel max-w-md">
        <h2 id="save-view-title" className="mb-3 font-serif text-xl text-fg">
          Save this view
        </h2>
        <div className="mb-4 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="save-mode"
              checked={mode === "update"}
              onChange={() => setMode("update")}
            />
            Update this view
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="save-mode"
              checked={mode === "fork"}
              onChange={() => setMode("fork")}
            />
            Save as new view
          </label>
        </div>
        {mode === "fork" ? (
          <label className="mb-4 block text-sm">
            <span className="mb-1 block text-fg-muted">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg/40 px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
            />
          </label>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-touch">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void doSave()}
            disabled={pending || (mode === "fork" && !name.trim())}
            className="btn btn-primary btn-touch"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
