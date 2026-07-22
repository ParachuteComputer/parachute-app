import { NoteRow, NoteRowList } from "@/components/NoteRow";
import { ViewNavIcon } from "@/components/ViewNavIcon";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { BoardView } from "@/components/views/BoardView";
import { CalendarView } from "@/components/views/CalendarView";
import { GalleryView } from "@/components/views/GalleryView";
import { NoteFieldChips } from "@/components/views/NoteFieldChips";
import { useToastStore } from "@/lib/toast/store";
import { useCreateNote, useUpdateNote, useVaultStore } from "@/lib/vault";
import { useTagRoles } from "@/lib/vault/settings";
import type { TagRoles } from "@/lib/vault/tag-roles";
import type { Note } from "@/lib/vault/types";
import { viewPathForName } from "@/lib/views/defaults";
import { type ResolvedField, useResolvedViewFields } from "@/lib/views/fields";
import { partitionPinned } from "@/lib/views/partition";
import { defaultSaveMode, useMySub, useViewNote, useViewResults } from "@/lib/views/queries";
import {
  type BaseChip,
  EMPTY_REFINEMENTS,
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
import { useMemo, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";

// The rendering pipeline (VIEWS-RENDER-SPEC §2):
//
//   note ──decodeViewDef──► ViewDef ──(+ URL refinements)──► useViewResults
//         ──partitionPinned──► KindRenderer (list only, wave 1)
//
// Mounted at /views/:id — note ID, not path (ids survive renames).

export function ViewSurface() {
  const { id } = useParams<{ id: string }>();
  const decodedId = id ? decodeURIComponent(id) : undefined;
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const note = useViewNote(decodedId);

  // NAVIGATION.md: route guard, no active vault — replace.
  if (!activeVault) return <Navigate to="/" replace />;

  return (
    <div className="page">
      <nav className="mb-6 text-sm text-fg-dim">
        <Link to="/notes" className="focus-ring hover:text-accent">
          ← All notes
        </Link>
      </nav>

      {note.isPending ? (
        <ViewSurfaceSkeleton />
      ) : note.data ? (
        <ViewSurfaceBody note={note.data} />
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
  const vault = useVaultStore((s) => s.getActiveVault());
  const { roles } = useTagRoles(vault?.id ?? null);
  const def = useMemo(() => decodeViewDef(note), [note]);

  const [searchParams, setSearchParams] = useSearchParams();
  const refinements = useMemo(() => searchParamsToRefinements(searchParams), [searchParams]);
  const setRefinements = (next: ViewRefinements) => {
    setSearchParams(refinementsToSearchParams(next), { replace: true });
  };

  const results = useViewResults(def, refinements);
  // The view's shown/editable fields (Part B) — the tag-schema default or the
  // view's `fields` override — resolved once and threaded to every kind, so a
  // card/row can show + edit them through the shared mutation primitive.
  const fields = useResolvedViewFields(def);
  const problems: ViewProblem[] = [...def.problems, ...results.problems];

  const partition = useMemo(() => {
    if (!results.data) return { pinned: [], rest: [] };
    return partitionPinned(results.data, roles.pinned, queryTags(def.query));
  }, [results.data, roles.pinned, def.query]);

  return (
    <article>
      <ViewHeader def={def} />
      <RefinementBar
        note={note}
        def={def}
        refinements={refinements}
        onChange={setRefinements}
        roles={roles}
      />
      {problems.length > 0 ? <ProblemsBanner problems={problems} /> : null}
      <div className="mt-6">
        <ViewResults
          def={def}
          data={results.data}
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
    </article>
  );
}

// ---------------------------------------------------------------------------
// Header — hue+kind mark, title, "Edit view note" (the note-editor bridge).
// ---------------------------------------------------------------------------

function ViewHeader({ def }: { def: ViewDef }) {
  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <ViewNavIcon kind={def.kind} hueTag={primaryQueryTag(def.query)} />
        <h1 className="page-title truncate">{def.title}</h1>
      </div>
      <Link
        to={`/n/${encodeURIComponent(def.noteId)}/edit`}
        className="btn btn-secondary btn-touch"
      >
        Edit view note
      </Link>
    </header>
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
// (Views Wave 2b). list is byte-identical to before; board/gallery/calendar
// each render the SAME fetched results a different way. An unknown kind — or a
// board/calendar missing its lane/date config — falls through to the list, the
// one shape a view is never wrong to render as (§1).
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
    case "calendar":
      if (def.dateField) {
        return (
          <CalendarView
            notes={all}
            dateField={def.dateField}
            roles={roles}
            viewResultsKey={viewResultsKey}
            fields={fields}
          />
        );
      }
      break;
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
// (dismissable) + the add-filter controls + Save (§5).
// ---------------------------------------------------------------------------

function RefinementBar({
  note,
  def,
  refinements,
  onChange,
  roles,
}: {
  note: Note;
  def: ViewDef;
  refinements: ViewRefinements;
  onChange: (next: ViewRefinements) => void;
  roles: TagRoles;
}) {
  const [showSave, setShowSave] = useState(false);
  const baseChips = useMemo(() => describeBaseQuery(def.query), [def.query]);
  const active = hasRefinements(refinements);

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

      {active ? (
        <button
          type="button"
          onClick={() => setShowSave(true)}
          className="btn btn-primary btn-touch ml-auto"
        >
          Save
        </button>
      ) : null}

      {showSave ? (
        <SaveSheet
          note={note}
          def={def}
          refinements={refinements}
          roles={roles}
          onClose={() => setShowSave(false)}
          onSaved={() => onChange(EMPTY_REFINEMENTS)}
        />
      ) : null}
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

function RefinementChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="chip chip-tag-active">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove refinement ${label}`}
        className="focus-ring ml-1 rounded-full"
      >
        ×
      </button>
    </span>
  );
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
// Save sheet — mutate-when-you-own / fork-when-you-don't (§5).
// ---------------------------------------------------------------------------

function SaveSheet({
  note,
  def,
  refinements,
  roles,
  onClose,
  onSaved,
}: {
  note: Note;
  def: ViewDef;
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
      // exclude_tags the base carried — never a surface-side default.
      const merged = composeViewQuery(def.query, refinements) ?? {};
      if (mode === "update") {
        await updateNote.mutateAsync({
          metadata: { kind: def.kind, query: JSON.stringify(merged) },
          ...(note.updatedAt ? { if_updated_at: note.updatedAt } : { force: true }),
        });
        pushToast(`Updated "${def.title}".`, "success");
      } else {
        await createNote.mutateAsync({
          content: "",
          path: viewPathForName(name),
          tags: [roles.view],
          // kind inherited from the source view (§5).
          metadata: { kind: def.kind, query: JSON.stringify(merged) },
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
