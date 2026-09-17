import { VaultConflictError } from "@/lib/vault/client";
import { type HistoryRow, historySelector } from "@/lib/vault/history";
import { useActiveVaultClient } from "@/lib/vault/queries";
import { useVaultStore } from "@/lib/vault/store";
import type { Note } from "@/lib/vault/types";
import { onlineManager, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

/** Online-only recovery. The timestamp belongs to the comparison, not the latest render. */
export function NoteHistory({ note }: { note: Note }) {
  const [open, setOpen] = useState(false);
  const vaultId = useVaultStore((s) => s.activeVaultId);
  return (
    <section className="mt-6 border-t border-border pt-4">
      <button
        type="button"
        className="btn btn-secondary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Version history
      </button>
      {open && vaultId ? (
        <HistoryPanel key={`${vaultId}:${note.id}`} note={note} vaultId={vaultId} />
      ) : null}
    </section>
  );
}

function HistoryPanel({ note, vaultId }: { note: Note; vaultId: string }) {
  const client = useActiveVaultClient();
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<HistoryRow | null>(null);
  const [reviewed, setReviewed] = useState<Note | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["history", vaultId, note.id, offset],
    queryFn: () => client!.listHistory(note.id, offset),
    enabled: !!client,
    retry: false,
  });
  const version = useQuery({
    queryKey: ["historyVersion", vaultId, note.id, selected],
    queryFn: () => client!.readHistory(note.id, historySelector(selected!)),
    enabled: !!client && !!selected,
    retry: false,
  });
  const current = useMutation({
    networkMode: "always",
    retry: false,
    mutationFn: () => client!.getNote(note.id),
    onSuccess: (fresh) => {
      setReviewed(fresh);
      setConfirm(false);
      setMessage(null);
    },
  });
  const restore = useMutation({
    networkMode: "always",
    retry: false,
    mutationFn: () => {
      if (!onlineManager.isOnline()) throw new Error("Connect to the vault before restoring.");
      if (!client || !selected || !reviewed?.updatedAt)
        throw new Error("Read the current note before restoring.");
      return client.restoreHistory(note.id, historySelector(selected), reviewed.updatedAt);
    },
    onSuccess: (updated) => {
      // Restore omits link/attachment collections. Only a full note fetch may
      // replace the note cache and durable mirror.
      void qc.invalidateQueries({ queryKey: ["note", vaultId] });
      for (const key of ["history", "notes", "notesForDateViews", "viewList", "tags", "vaultInfo"])
        void qc.invalidateQueries({ queryKey: [key, vaultId] });
      setReviewed(updated);
      setConfirm(false);
      setMessage(
        "Version restored. The change you replaced is retained in history under the vault’s retention policy.",
      );
    },
    onError: (error) => {
      setConfirm(false);
      setReviewed(null);
      setMessage(
        error instanceof VaultConflictError
          ? "The server refused this restore. The note may have changed or the selected history may be unavailable. Read the current note again and review the comparison."
          : `Restore could not be confirmed. Read the current note again before retrying. ${error.message}`,
      );
    },
  });
  const choose = (row: HistoryRow) => {
    setSelected(row);
    setReviewed(null);
    setConfirm(false);
    setMessage(null);
    current.mutate();
  };
  const pending = restore.isPending || current.isPending;
  const canRestore =
    !!version.data &&
    !version.isFetching &&
    !version.isError &&
    !current.isError &&
    version.data.content !== null &&
    version.data.encoding !== "overflow" &&
    !!reviewed?.updatedAt &&
    !pending;
  return (
    <div className="mt-4 space-y-4" aria-label="Note version history">
      <p className="text-sm text-fg-muted">
        History contains retained snapshots, not every keystroke. Older versions may have been
        pruned. Imported snapshots are labeled separately. Recovery needs a connection to the vault.
      </p>
      {!client ? <p role="alert">Connect to this vault to read history.</p> : null}
      {list.fetchStatus === "paused" ? (
        <p role="alert">
          Connect to this vault to read history. Offline copies do not include version history.
        </p>
      ) : null}
      {list.isPending && client && list.fetchStatus !== "paused" ? (
        <output>Loading history…</output>
      ) : null}
      {list.isError ? (
        <div role="alert">
          <p>
            History is unavailable. This server may not support it, the note may be unavailable, or
            your connection/access may need attention. This is not an empty-history result.
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => list.refetch()}>
            Retry history
          </button>
        </div>
      ) : null}
      {list.data?.versions.length === 0 ? (
        <p>
          No retained versions on this page. Earlier edits may predate history capture or have been
          pruned.
        </p>
      ) : null}
      <ul className="space-y-2">
        {list.data?.versions.map((row, index) => (
          <li key={`${row.origin ?? "native"}:${row.import_ix ?? row.version_ix}:${index}`}>
            <button
              type="button"
              className="btn btn-secondary text-left"
              disabled={restore.isPending}
              onClick={() => choose(row)}
            >
              {row.origin === "git-import"
                ? `Imported snapshot ${row.import_ix}`
                : `Version ${row.version_ix}`}{" "}
              · {row.superseded_at} · {row.op}
            </button>
          </li>
        ))}
      </ul>
      {list.data ? (
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={offset === 0 || pending}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Newer
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={offset + 50 >= list.data.total || pending}
            onClick={() => setOffset(offset + 50)}
          >
            Older
          </button>
        </div>
      ) : null}
      {selected ? (
        <div className="space-y-3">
          {version.isPending || current.isPending ? <output>Loading comparison…</output> : null}
          {version.isError ? (
            <p role="alert">
              This version could not be read. It may have been pruned, exceed history limits, or
              have damaged stored content. Choose another version.
            </p>
          ) : null}
          {current.isError ? (
            <p role="alert">The current note could not be read. Restore is disabled.</p>
          ) : null}
          {version.data && reviewed ? (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <Snapshot
                  title="Selected version"
                  content={version.data.content}
                  metadata={version.data.metadata}
                  extension={version.data.extension}
                />
                <Snapshot
                  title="Current note when reviewed"
                  content={reviewed.content}
                  metadata={reviewed.metadata}
                  extension={(reviewed as Note & { extension?: string }).extension}
                />
              </div>
              {version.data.content === null ? (
                <p role="alert">
                  This version records a change but has no recoverable content. It cannot be
                  restored.
                </p>
              ) : null}
              {note.updatedAt !== reviewed.updatedAt ? (
                <output>
                  The displayed note has changed since this comparison. Refresh the comparison
                  before deciding.
                </output>
              ) : null}
              <p className="text-sm text-fg-muted">
                Restore replaces content, metadata and file type. It keeps the current path and
                tags. It creates a new recoverable change; it does not erase history.
              </p>
            </>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending}
            onClick={() => {
              setReviewed(null);
              setConfirm(false);
              current.mutate();
            }}
          >
            Read current note again
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!canRestore}
            onClick={() => setConfirm(true)}
          >
            Restore selected version…
          </button>
          {confirm ? (
            <div className="rounded border border-border p-4">
              <p>Replace the current note with this version? A newer edit will stop the restore.</p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canRestore}
                onClick={() => restore.mutate()}
              >
                Confirm restore
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={restore.isPending}
                onClick={() => setConfirm(false)}
              >
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {message ? <output>{message}</output> : null}
    </div>
  );
}

function Snapshot({
  title,
  content,
  metadata,
  extension,
}: {
  title: string;
  content: string | null | undefined;
  metadata: unknown;
  extension: string | null | undefined;
}) {
  return (
    <div className="min-w-0">
      <h3 className="font-semibold">{title}</h3>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-border p-3 text-sm">
        {content ?? "Content unavailable"}
      </pre>
      <details>
        <summary>Metadata and file type</summary>
        <pre className="overflow-auto text-sm">
          {JSON.stringify({ extension, metadata }, null, 2)}
        </pre>
      </details>
    </div>
  );
}
