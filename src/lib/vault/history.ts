/** Wire selectors are deliberately distinct: imported indexes are not native versions. */
export type HistorySelector = { version_ix: number } | { origin: "git-import"; import_ix: number };

export interface HistoryRow {
  note_id: string;
  version_ix?: number;
  origin?: "git-import";
  import_ix?: number;
  superseded_at: string;
  op: string;
  path: string | null;
  content_len: number;
  encoding: string;
  actor?: string | null;
  via?: string | null;
}

export interface HistoryVersion extends HistoryRow {
  content: string | null;
  metadata: Record<string, unknown>;
  extension: string | null;
}

export function historySelector(row: HistoryRow): HistorySelector {
  if (row.origin === "git-import" && Number.isSafeInteger(row.import_ix) && row.import_ix! >= 0) {
    return { origin: "git-import", import_ix: row.import_ix! };
  }
  if (row.origin === undefined && Number.isSafeInteger(row.version_ix) && row.version_ix! >= 0) {
    return { version_ix: row.version_ix! };
  }
  throw new Error("This server returned an unsupported history selector.");
}

export function historyVersionPath(id: string, selector: HistorySelector): string {
  return `/api/notes/${encodeURIComponent(id)}/${"import_ix" in selector ? `imports/${selector.import_ix}` : `versions/${selector.version_ix}`}`;
}
