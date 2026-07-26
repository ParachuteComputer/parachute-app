import { Skeleton } from "@/components/ui/Skeleton";
import { useTag, useVaultStore } from "@/lib/vault";
import { DEFAULT_PAGE_SIZE } from "@/lib/vault/note-query";
import { useTagRoles } from "@/lib/vault/settings";
import type { TagRecord } from "@/lib/vault/types";
import { deriveTagViewDef } from "@/lib/views/derive";
import { useMemo } from "react";
import { Link, Navigate, useParams } from "react-router";
import { ViewCanvas } from "./ViewSurface";

// The tag page (`/tags/:name`) — a view DERIVED from the tag's own schema,
// rendered on the fly. Clicking a tag used to drop into `/notes?tag=X`, a flat
// filter over All-notes that looked identical whether the tag had a rich field
// schema or none. This gives the tag its own page: a typed tag opens as a
// database (a table with its schema fields as columns), a plain tag as the
// familiar list — the whole point is the contrast. Nothing is stored; the def
// is `deriveTagViewDef`'s output, recomputed each visit, so it can never
// dangle. Reuses the exact `ViewCanvas` machinery `/views/:id` renders, with
// `backingNote={null}` (there's no note behind a derived view).

// The back link to /tags — shared by the loaded page (handed to `ViewCanvas`'s
// wrapper as its breadcrumb) and the loading shell, so every state of this
// route keeps the same escape hatch.
function TagsBackNav() {
  return (
    <nav className="mb-6 text-sm text-fg-dim">
      <Link to="/tags" className="focus-ring hover:text-accent">
        ← Tags
      </Link>
    </nav>
  );
}

export function TagPage() {
  const { name } = useParams<{ name: string }>();
  const decodedName = name ? decodeURIComponent(name) : undefined;
  const activeVault = useVaultStore((s) => s.getActiveVault());
  // The tag-identity row (schema fields drive table-vs-list). A plain tag with
  // no schema row — or one that doesn't exist — resolves to `null` (vault 404
  // → null), which reads as zero fields → a list. Deduped with the same
  // `useTag(name)` `ViewCanvas` runs for field resolution.
  const tag = useTag(decodedName ?? null);

  // NAVIGATION.md: route guards — replace.
  if (!activeVault) return <Navigate to="/" replace />;
  if (!decodedName) return <Navigate to="/tags" replace />;

  // The loaded page owns its OWN width-aware wrapper — a typed tag's table
  // earns `.page-wide`, which `ViewCanvas` decides from its (draft-inclusive)
  // effective kind — so, like `ViewSurface`, only the loading shell wraps here.
  if (tag.isPending) {
    // Wait for the tag row to settle before deriving, so a typed tag opens
    // straight into its table instead of flashing list → table.
    return (
      <div className="page">
        <TagsBackNav />
        <TagPageSkeleton />
      </div>
    );
  }

  return <TagPageBody name={decodedName} tag={tag.data ?? null} />;
}

function TagPageBody({ name, tag }: { name: string; tag: TagRecord | null }) {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const { roles } = useTagRoles(activeVault?.id ?? null);
  const def = useMemo(() => deriveTagViewDef(name, tag, roles), [name, tag, roles]);
  // Page the derived view: a capture or journal tag can carry hundreds of
  // notes, so it opens as one 50-row page (with the tag's size on the header
  // and a pager), never a thousands-of-pixels wall. `tag.count` is the tag's
  // note total — the same number the Tags list shows per row. `ViewCanvas` owns
  // the page wrapper (its width tracks the lens), so the breadcrumb rides in as
  // `nav`.
  return (
    <ViewCanvas
      def={def}
      backingNote={null}
      pageSize={DEFAULT_PAGE_SIZE}
      total={tag?.count}
      nav={<TagsBackNav />}
    />
  );
}

function TagPageSkeleton() {
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
