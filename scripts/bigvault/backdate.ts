/**
 * Spread the seeded notes' timestamps over ~2 years so Recent/day-grouping
 * reads like a lived-in vault, not a bulk import. REST cannot set
 * `updated_at`, so this writes the sandbox sqlite directly — run with the
 * vault STOPPED, and only ever against a marker-bearing sandbox home.
 *
 * Ages are keyed off each note's PATH (see backdateFor), so the result is
 * deterministic even though concurrent seeding makes row order racy.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assertSandboxHome } from "./sandbox.ts";
import { backdateFor } from "./taxonomy.ts";

export function backdateVault(homeArg: string, anchorMs: number): number {
  const home = assertSandboxHome(homeArg);
  const dbPath = join(home, "vault", "data", "default", "vault.db");
  if (!existsSync(dbPath)) throw new Error(`no vault db at ${dbPath} — seed first`);
  const db = new Database(dbPath);
  try {
    const rows = db.query("SELECT id, path FROM notes").all() as Array<{
      id: string;
      path: string | null;
    }>;
    const stmt = db.prepare(
      "UPDATE notes SET created_at = ?, updated_at = ?, updated_at_ms = ? WHERE id = ?",
    );
    for (const row of rows) {
      // Key off `path`, never insert order — that was the original
      // non-determinism (rows come back in whatever order concurrent seeding
      // wrote them). `id` is a legitimate fallback for a pathless row, but it
      // is NOT stable across runs, so a vault containing one would stop being
      // reproducible. Every note bigvault seeds carries a path; if that ever
      // stops being true, this is where determinism quietly breaks.
      if (!row.path)
        throw new Error(`note ${row.id} has no path — backdating would not be reproducible`);
      const { createdAtMs, updatedAtMs } = backdateFor(row.path, anchorMs);
      stmt.run(
        new Date(createdAtMs).toISOString(),
        new Date(updatedAtMs).toISOString(),
        updatedAtMs,
        row.id,
      );
    }
    // Strip write-attribution so list rows don't all read "via API".
    db.run(
      "UPDATE notes SET created_by = NULL, created_via = NULL, last_updated_by = NULL, last_updated_via = NULL",
    );
    return rows.length;
  } finally {
    db.close();
  }
}
