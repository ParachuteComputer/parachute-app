import { IconSearch, IconSpark } from "@/components/NavIcons";
import { loadRecents } from "@/lib/quick-switch/recents";
import { type QuickSwitchEntry, computeResults } from "@/lib/quick-switch/results";
import { useAllNotesForSwitcher, useTags, useVaultStore } from "@/lib/vault";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

// The command palette. Opens from three doors — the rail's Search row, ⌘K
// (see QuickSwitchMount), and the mobile bottom-tab Search — and closes on
// Escape, click-outside/Cancel, or selection. Renders inside a <dialog open>
// so native a11y semantics and focus management help.
//
// W2-9 presentation (adopt #6 — prototype `13-home-search-command-palette.png`),
// same results engine underneath:
//   · desktop ≥lg — a bottom-centre glass pill; the results panel BLOOMS
//     UPWARD from it (`.glass-panel` + --shadow-lift; the pill's shadow grows
//     soft→lift on focus). DOM stays input-first (focus + combobox order);
//     `lg:flex-col-reverse` puts the pill at the bottom visually.
//   · mobile <lg — a full-screen sheet from the Search tab: pill row up top
//     (with an explicit Cancel — no Esc key on a phone), results filling the
//     screen below.
//
// The pill's right slot RESERVES space for a future "Smart" toggle — a
// clearly-inert visual placeholder (a dimmed span, aria-hidden, no handler).
// The prototype's "Smart search" AI-prompt rows are mocked and the app has no
// ask-AI endpoint; shipping fake prompts would violate the honesty rule
// (DESIGN-SPEC W2-9 spec-resolved note, §6-A2 owns the future toggle).
//
// The results list is a flat array — commands + notes + tags interleaved
// and ranked. Flat keeps ↑/↓/Enter simple (one selected index, always a
// real entry). Debounce is 150ms because the compute is cheap against the
// already-fetched note list, but pressing keys in rapid succession still
// gets smoother renders.

interface Props {
  onClose(): void;
}

const DEBOUNCE_MS = 150;

export function QuickSwitch({ onClose }: Props) {
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const listboxId = useId();

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  const notesQuery = useAllNotesForSwitcher(true);
  const tagsQuery = useTags();
  const recents = useMemo(() => (activeVaultId ? loadRecents(activeVaultId) : []), [activeVaultId]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const results = useMemo<QuickSwitchEntry[]>(
    () =>
      computeResults({
        query: debounced,
        notes: notesQuery.data ?? [],
        tags: tagsQuery.data ?? [],
        recents,
      }),
    [debounced, notesQuery.data, tagsQuery.data, recents],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when list size changes
  useEffect(() => {
    setSelectedIdx(0);
  }, [results.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runEntry = useCallback(
    (entry: QuickSwitchEntry) => {
      if (entry.kind === "note") {
        navigate(`/n/${encodeURIComponent(entry.id)}`);
      } else if (entry.kind === "tag") {
        navigate(`/notes?tag=${encodeURIComponent(entry.name)}`);
      } else {
        navigate(entry.action.to);
      }
      onClose();
    },
    [navigate, onClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(results.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const entry = results[selectedIdx];
        if (entry) runEntry(entry);
        return;
      }
    },
    [results, selectedIdx, runEntry, onClose],
  );

  useEffect(() => {
    const selectedEl = listRef.current?.querySelector<HTMLElement>(
      `[data-qs-idx="${selectedIdx}"]`,
    );
    // scrollIntoView is missing in jsdom; guard so tests don't throw.
    selectedEl?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIdx]);

  const loading = notesQuery.isPending;

  return (
    <dialog
      open
      aria-labelledby={inputId}
      className="enter-fade fixed inset-0 z-50 m-0 h-full max-h-full w-full max-w-full bg-transparent p-0 lg:flex lg:px-6 lg:pb-8"
      onMouseDown={(e) => {
        // Desktop click-outside: the transparent dialog root spans the
        // viewport around the bottom-centre column. (On mobile the sheet
        // fills the screen, so this never fires — Cancel closes instead.)
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Mobile: a full-screen cream sheet (bg + blur, like the Header bar).
          Desktop: a transparent bottom-centre column; col-reverse keeps the
          input first in the DOM while the pill sits visually at the bottom,
          the panel blooming upward above it. */}
      <div className="flex h-full w-full flex-col bg-bg/95 backdrop-blur-md lg:mx-auto lg:h-auto lg:w-full lg:max-w-xl lg:flex-col-reverse lg:self-end lg:bg-transparent lg:backdrop-blur-none">
        <div className="enter-rise flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 lg:p-0">
          <div className="glass-panel flex min-w-0 flex-1 items-center gap-2.5 rounded-full border border-border px-4 py-2.5 shadow-soft transition-shadow duration-(--dur-quick) ease-out focus-within:shadow-lift lg:px-5 lg:py-3">
            <span aria-hidden="true" className="shrink-0 text-fg-dim">
              <IconSearch width={18} height={18} />
            </span>
            <input
              id={inputId}
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search your vault…"
              aria-label="Quick switch query"
              aria-controls={listboxId}
              aria-activedescendant={results[selectedIdx] ? `qs-opt-${selectedIdx}` : undefined}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-base text-fg placeholder:text-fg-dim focus:outline-none"
            />
            {/* RESERVED, INERT: the future "Smart" toggle's seat (W2-9
                spec-resolved / §6-A2). Not a control — no handler, no focus,
                hidden from AT — just the pill holding space honestly until
                an ask-AI capability actually exists. */}
            <span
              aria-hidden="true"
              data-testid="smart-slot-reserved"
              className="hidden shrink-0 select-none items-center gap-1 rounded-full border border-border-light px-2.5 py-1 text-xs text-fg-dim opacity-70 lg:flex"
            >
              <IconSpark width={13} height={13} />
              Smart
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring shrink-0 rounded-full px-3 py-2 text-sm text-fg-muted hover:text-accent lg:hidden"
          >
            Cancel
          </button>
        </div>

        {/* The result panel — flat on the mobile sheet; a floating glass
            card on desktop (blooms upward from the pill per shot 13). */}
        <div className="enter-rise glass-panel flex min-h-0 flex-1 flex-col lg:mb-3 lg:max-h-[55vh] lg:flex-none lg:rounded-[var(--radius-2xl)] lg:border lg:border-border lg:shadow-lift">
          <div
            id={listboxId}
            ref={listRef}
            // biome-ignore lint/a11y/useSemanticElements: combobox pattern (listbox paired with input above), not a native <select>
            role="listbox"
            tabIndex={-1}
            aria-label="Quick switch results"
            aria-live="polite"
            className="min-h-0 flex-1 overflow-y-auto py-1 lg:max-h-[50vh]"
          >
            {loading && results.length === 0 ? (
              <div className="px-4 py-3 text-sm text-fg-dim">Loading notes…</div>
            ) : results.length === 0 ? (
              <div className="px-4 py-3 text-sm text-fg-dim">
                {query.trim().length === 0 ? "Start typing to search." : "No matches."}
              </div>
            ) : (
              results.map((entry, i) => (
                <ResultRow
                  key={entryKey(entry)}
                  entry={entry}
                  index={i}
                  selected={i === selectedIdx}
                  onPick={() => runEntry(entry)}
                  onHover={() => setSelectedIdx(i)}
                />
              ))
            )}
          </div>
          <div className="hidden items-center justify-between border-t border-border-light px-4 py-2 text-xs text-fg-dim lg:flex">
            <span>
              <kbd className="rounded bg-bg/60 px-1">↑↓</kbd> navigate{" "}
              <kbd className="rounded bg-bg/60 px-1">↵</kbd> open{" "}
              <kbd className="rounded bg-bg/60 px-1">esc</kbd> close{" "}
              <kbd className="rounded bg-bg/60 px-1">&gt;</kbd> commands
            </span>
            <span className="tabular-nums">
              {results.length > 0
                ? `${results.length} result${results.length === 1 ? "" : "s"}`
                : ""}
            </span>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function entryKey(e: QuickSwitchEntry): string {
  if (e.kind === "note") return `note:${e.id}`;
  if (e.kind === "tag") return `tag:${e.name}`;
  return `cmd:${e.id}`;
}

function ResultRow({
  entry,
  index,
  selected,
  onPick,
  onHover,
}: {
  entry: QuickSwitchEntry;
  index: number;
  selected: boolean;
  onPick(): void;
  onHover(): void;
}) {
  const bg = selected ? "bg-accent/10 text-fg" : "text-fg-muted";
  return (
    <div
      id={`qs-opt-${index}`}
      // biome-ignore lint/a11y/useSemanticElements: option-in-listbox combobox pattern, not a native <option>
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      data-qs-idx={index}
      onMouseEnter={onHover}
      onMouseDown={(e) => {
        // mouseDown (not click) so the input doesn't lose focus and close us
        // via backdrop handling first.
        e.preventDefault();
        onPick();
      }}
      className={`mx-1.5 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${bg}`}
    >
      {entry.kind === "note" ? (
        <>
          <span className="text-xs uppercase tracking-wider text-fg-dim">note</span>
          <span className="truncate font-medium">{entry.title}</span>
          {entry.path ? (
            <span className="ml-auto truncate font-mono text-xs text-fg-dim">{entry.path}</span>
          ) : null}
        </>
      ) : entry.kind === "tag" ? (
        <>
          <span className="text-xs uppercase tracking-wider text-fg-dim">tag</span>
          <span className="font-mono">#{entry.name}</span>
          <span className="ml-auto text-xs tabular-nums text-fg-dim">{entry.count}</span>
        </>
      ) : (
        <>
          <span className="text-xs uppercase tracking-wider text-accent">cmd</span>
          <span className="font-medium">{entry.label}</span>
          <span className="ml-auto text-xs text-fg-dim">{entry.description}</span>
        </>
      )}
    </div>
  );
}
