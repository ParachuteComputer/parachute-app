import type { TagRecord } from "@/lib/vault/types";
import { isFinePointer } from "@/lib/views/dnd";
import { useEffect, useMemo, useRef, useState } from "react";

// Tag-primary browser for the Notes sidebar. Leads with a typeahead (name
// filter, count-ranked, Enter toggles the top match) so a busy vault's tags
// are reachable by typing rather than scrolling — the `/tags` directory page
// has had this box for a while; this is the same box, here. Below the
// typeahead, a SHORTLIST (selected, then pinned, then top-by-count, capped
// ~10 rows) covers the common case at a glance; an "All N tags" disclosure
// underneath reveals the full grouped tree unchanged (slash-delimited tags
// collapse under a collapsible parent, e.g. `summary/daily`, `summary/weekly`
// → "summary"). Drives the existing `selectedTags` multi-select used by the
// notes list query.

const SHORTLIST_CAP = 10;

interface Props {
  tags: TagRecord[];
  pinnedTags: string[];
  selected: string[];
  onToggle: (name: string) => void;
  onClear: () => void;
  isLoading?: boolean;
}

interface GroupedTag {
  kind: "leaf";
  name: string;
  label: string;
  count: number;
  pinned: boolean;
  fields?: TagRecord["fields"];
}

interface GroupedTagNode {
  kind: "group";
  prefix: string;
  totalCount: number;
  // The parent tag itself, if it exists as a concrete tag (e.g. "summary").
  selfTag?: TagRecord & { pinned: boolean };
  children: Array<TagRecord & { pinned: boolean }>;
}

type Entry = GroupedTag | GroupedTagNode;

// Field count backing the `⊞ N` typed-tag marker — 0 (or no schema at all)
// renders nothing, so an untyped tag stays exactly as plain as it is today.
function fieldCountOf(t: { fields?: TagRecord["fields"] }): number {
  return Object.keys(t.fields ?? {}).length;
}

function groupAndRank(tags: TagRecord[], pinnedSet: Set<string>): Entry[] {
  // Partition into slash-prefixed vs flat. A slash-prefixed tag contributes
  // to a group only if at least 2 tags share its first segment (so we don't
  // wrap a single `summary/daily` into a pointless "summary" group of one).
  const firstSegmentIndex = new Map<string, TagRecord[]>();
  for (const t of tags) {
    const slash = t.name.indexOf("/");
    if (slash > 0) {
      const head = t.name.slice(0, slash);
      const bucket = firstSegmentIndex.get(head) ?? [];
      bucket.push(t);
      firstSegmentIndex.set(head, bucket);
    }
  }

  const groupedHeads = new Set<string>();
  for (const [head, members] of firstSegmentIndex) {
    if (members.length >= 2) groupedHeads.add(head);
  }

  const groups = new Map<string, GroupedTagNode>();
  const leaves: GroupedTag[] = [];

  for (const t of tags) {
    const slash = t.name.indexOf("/");
    const head = slash > 0 ? t.name.slice(0, slash) : t.name;
    const isGroupMember = slash > 0 && groupedHeads.has(head);

    if (isGroupMember) {
      let group = groups.get(head);
      if (!group) {
        group = { kind: "group", prefix: head, totalCount: 0, children: [] };
        groups.set(head, group);
      }
      group.children.push({ ...t, pinned: pinnedSet.has(t.name) });
      group.totalCount += t.count ?? 0;
    } else if (groupedHeads.has(t.name)) {
      // This tag is the concrete parent of a group (e.g. `summary` itself
      // exists as a tag, and so do `summary/daily`, `summary/weekly`).
      let group = groups.get(t.name);
      if (!group) {
        group = { kind: "group", prefix: t.name, totalCount: 0, children: [] };
        groups.set(t.name, group);
      }
      group.selfTag = { ...t, pinned: pinnedSet.has(t.name) };
      group.totalCount += t.count ?? 0;
    } else {
      leaves.push({
        kind: "leaf",
        name: t.name,
        label: t.name,
        count: t.count ?? 0,
        pinned: pinnedSet.has(t.name),
        fields: t.fields,
      });
    }
  }

  // Sort children of each group by count desc, with pinned first.
  for (const g of groups.values()) {
    g.children.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name);
    });
  }

  // Merge + rank top-level entries. Use max child count (or self count) as
  // the group's ranking signal rather than total — a group with many tiny
  // children shouldn't jump above a single heavy tag.
  const entries: Entry[] = [...leaves, ...Array.from(groups.values())];

  const rankOf = (e: Entry): { pinned: boolean; count: number; label: string } => {
    if (e.kind === "leaf") return { pinned: e.pinned, count: e.count, label: e.label };
    const anyPinned = (e.selfTag?.pinned ?? false) || e.children.some((c) => c.pinned);
    const heaviest = Math.max(e.selfTag?.count ?? 0, ...e.children.map((c) => c.count ?? 0)) || 0;
    return { pinned: anyPinned, count: heaviest, label: e.prefix };
  };

  entries.sort((a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (ra.pinned !== rb.pinned) return ra.pinned ? -1 : 1;
    return rb.count - ra.count || ra.label.localeCompare(rb.label);
  });

  return entries;
}

function isEntryPinned(e: Entry): boolean {
  if (e.kind === "leaf") return e.pinned;
  return (e.selfTag?.pinned ?? false) || e.children.some((c) => c.pinned);
}

function isEntrySelected(e: Entry, selectedSet: Set<string>): boolean {
  if (e.kind === "leaf") return selectedSet.has(e.name.toLowerCase());
  const selfSelected = e.selfTag ? selectedSet.has(e.selfTag.name.toLowerCase()) : false;
  return selfSelected || e.children.some((c) => selectedSet.has(c.name.toLowerCase()));
}

// Selected first, then pinned, then whatever's left — which is already
// count-ranked because `entries` (groupAndRank's output) is. Capped so the
// common case never scrolls; the "All N tags" disclosure covers the rest.
// Selections are reserved before the cap is applied to the remainder — the
// cap governs discovery, never active state, so a selected tag can never
// fall out of the shortlist no matter how many are selected.
function buildShortlist(entries: Entry[], selectedSet: Set<string>, cap: number): Entry[] {
  const selectedEntries = entries.filter((e) => isEntrySelected(e, selectedSet));
  const rest = entries.filter((e) => !isEntrySelected(e, selectedSet));
  const pinnedEntries = rest.filter(isEntryPinned);
  const others = rest.filter((e) => !isEntryPinned(e));
  const remainder = Math.max(0, cap - selectedEntries.length);
  return [...selectedEntries, ...[...pinnedEntries, ...others].slice(0, remainder)];
}

export function TagBrowser({ tags, pinnedTags, selected, onToggle, onClear, isLoading }: Props) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Desktop-only autofocus (UI-audit finding: autofocusing on phone throws
  // up the keyboard and covers the list). Read once at mount — a hybrid
  // device changing pointer mid-session isn't worth re-deciding for a
  // one-shot focus.
  useEffect(() => {
    if (isFinePointer()) inputRef.current?.focus();
  }, []);

  const pinnedSet = useMemo(() => new Set(pinnedTags.map((p) => p.toLowerCase())), [pinnedTags]);
  const selectedSet = useMemo(() => new Set(selected.map((s) => s.toLowerCase())), [selected]);
  const entries = useMemo(() => groupAndRank(tags, pinnedSet), [tags, pinnedSet]);
  const shortlist = useMemo(
    () => buildShortlist(entries, selectedSet, SHORTLIST_CAP),
    [entries, selectedSet],
  );

  // Per-group open state. Default all groups to collapsed so the sidebar
  // stays scannable at a glance — users expand what they care about.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (head: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(head)) next.delete(head);
      else next.add(head);
      return next;
    });
  };

  const trimmedQuery = query.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!trimmedQuery) return [];
    return tags
      .filter((t) => t.name.toLowerCase().includes(trimmedQuery))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name));
  }, [tags, trimmedQuery]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const topMatch = searchResults[0];
    if (!topMatch) return;
    e.preventDefault();
    onToggle(topMatch.name);
  };

  const renderEntry = (entry: Entry) =>
    entry.kind === "leaf" ? (
      <li key={entry.name}>
        <TagRow
          name={entry.name}
          label={entry.label}
          count={entry.count}
          pinned={entry.pinned}
          active={selectedSet.has(entry.name.toLowerCase())}
          fieldCount={fieldCountOf(entry)}
          onToggle={() => onToggle(entry.name)}
        />
      </li>
    ) : (
      <li key={entry.prefix}>
        <TagGroup
          group={entry}
          isOpen={openGroups.has(entry.prefix)}
          onToggleOpen={() => toggleGroup(entry.prefix)}
          selectedSet={selectedSet}
          onToggleTag={onToggle}
        />
      </li>
    );

  return (
    <nav aria-label="Browse by tag">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-wider text-fg-dim">Tags</h2>
        {selected.length > 0 ? (
          <button type="button" onClick={onClear} className="text-xs text-fg-dim hover:text-accent">
            Clear
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Filter tags…"
        aria-label="Filter tags"
        className="input mb-2 w-full text-sm"
      />

      {isLoading ? (
        <p className="text-xs text-fg-dim">Loading…</p>
      ) : tags.length === 0 ? (
        <p className="text-xs text-fg-dim">No tags in this vault.</p>
      ) : trimmedQuery ? (
        searchResults.length === 0 ? (
          <p className="text-xs text-fg-dim">No tags match "{query}".</p>
        ) : (
          <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto pr-1" aria-label="Matching tags">
            {searchResults.map((t) => (
              <li key={t.name}>
                <TagRow
                  name={t.name}
                  label={t.name}
                  count={t.count ?? 0}
                  pinned={pinnedSet.has(t.name.toLowerCase())}
                  active={selectedSet.has(t.name.toLowerCase())}
                  fieldCount={fieldCountOf(t)}
                  onToggle={() => onToggle(t.name)}
                />
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <ul className="space-y-0.5" aria-label="Shortlist">
            {shortlist.map(renderEntry)}
          </ul>
          {entries.length > shortlist.length ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="mt-1 flex items-center gap-1 rounded-lg px-1 py-1 text-xs text-fg-dim hover:text-accent"
            >
              <span aria-hidden="true" className="font-mono">
                {showAll ? "▾" : "▸"}
              </span>
              All {tags.length} tags
            </button>
          ) : null}
          {showAll ? (
            <ul
              className="mt-2 max-h-[60vh] space-y-0.5 overflow-y-auto border-t border-border pr-1 pt-2"
              aria-label="All tags"
            >
              {entries.map(renderEntry)}
            </ul>
          ) : null}
        </>
      )}
    </nav>
  );
}

function TagRow({
  name,
  label,
  count,
  pinned,
  active,
  fieldCount,
  onToggle,
}: {
  name: string;
  label: string;
  count: number;
  pinned: boolean;
  active: boolean;
  fieldCount?: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      title={`#${name}`}
      className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-sm ${
        active ? "bg-accent/15 text-accent" : "text-fg-muted hover:bg-bg/60 hover:text-accent"
      }`}
    >
      {pinned ? (
        <span aria-hidden="true" className="shrink-0 text-accent">
          ★
        </span>
      ) : null}
      <span className="flex-1 truncate">#{label}</span>
      {fieldCount ? (
        <span
          className="shrink-0 text-xs text-fg-dim"
          title={`${fieldCount} schema field${fieldCount === 1 ? "" : "s"}`}
        >
          ⊞ {fieldCount}
        </span>
      ) : null}
      <span className="shrink-0 text-xs text-fg-dim">{count}</span>
    </button>
  );
}

function TagGroup({
  group,
  isOpen,
  onToggleOpen,
  selectedSet,
  onToggleTag,
}: {
  group: GroupedTagNode;
  isOpen: boolean;
  onToggleOpen: () => void;
  selectedSet: Set<string>;
  onToggleTag: (name: string) => void;
}) {
  const anyChildSelected = group.children.some((c) => selectedSet.has(c.name.toLowerCase()));
  const selfSelected = group.selfTag ? selectedSet.has(group.selfTag.name.toLowerCase()) : false;
  // Force open whenever a descendant (or the self-tag) is selected, so the
  // user can see what's active without having to manually expand.
  const effectiveOpen = isOpen || anyChildSelected || selfSelected;
  const groupPinned = (group.selfTag?.pinned ?? false) || group.children.some((c) => c.pinned);

  return (
    <div>
      <div className="flex items-center gap-1 rounded-lg px-1 py-0.5">
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={effectiveOpen}
          aria-label={`${effectiveOpen ? "Collapse" : "Expand"} ${group.prefix}`}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-fg-dim hover:text-accent"
        >
          <span aria-hidden="true" className="font-mono text-xs">
            {effectiveOpen ? "▾" : "▸"}
          </span>
        </button>
        {group.selfTag ? (
          <TagRow
            name={group.selfTag.name}
            label={group.prefix}
            // The family TOTAL, not the parent's own count — a collapsed
            // family whose parent exists (e.g. `#capture` with 0 notes of
            // its own, but 951 across `capture/voice` + `capture/text` +
            // `capture/photo`) used to show the parent's bare count here,
            // rendering the vault's heaviest family as "#capture 0".
            count={group.totalCount}
            pinned={group.selfTag.pinned}
            active={selfSelected}
            fieldCount={fieldCountOf(group.selfTag)}
            onToggle={() => onToggleTag(group.selfTag!.name)}
          />
        ) : (
          <button
            type="button"
            onClick={onToggleOpen}
            className="flex flex-1 items-center gap-1.5 truncate rounded-lg px-2 py-1 text-left text-sm text-fg-muted hover:bg-bg/60 hover:text-accent"
          >
            {groupPinned ? (
              <span aria-hidden="true" className="shrink-0 text-accent">
                ★
              </span>
            ) : null}
            <span className="flex-1 truncate">#{group.prefix}/</span>
            <span className="shrink-0 text-xs text-fg-dim">{group.totalCount}</span>
          </button>
        )}
      </div>
      {effectiveOpen ? (
        <ul className="ml-4 space-y-0.5 border-l border-border pl-2">
          {group.children.map((c) => {
            const leafLabel = c.name.slice(group.prefix.length + 1) || c.name;
            return (
              <li key={c.name}>
                <TagRow
                  name={c.name}
                  label={leafLabel}
                  count={c.count ?? 0}
                  pinned={c.pinned}
                  active={selectedSet.has(c.name.toLowerCase())}
                  fieldCount={fieldCountOf(c)}
                  onToggle={() => onToggleTag(c.name)}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
