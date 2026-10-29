import type { VaultClient } from "./client";
import { NOTES_REQUIRED_SCHEMA, type RequiredTagDecl } from "./schema";
import { auditSchema } from "./schema-audit";

// Per-session ref guard so we don't hammer the vault on every capture. The
// audit + create calls are idempotent, but there's no point making the
// network round-trip if we already ensured this vault's schema in this
// session.
//
// Module-level Set rather than a hook because the call sites
// (NoteNew's save paths) are short-lived components and we want the guard to
// survive remount. localStorage was the alternative but it has the
// "delete localStorage = re-run forever" failure mode the team-lead
// flagged — refs in a module are the right scope: ephemeral, but
// session-stable.
const ensuredVaults = new Set<string>();

// The schema-apply machinery as a plain function: writes the given tag
// declarations via `update-tag`. Callers decide WHICH declarations to write —
// the lazy-ensure passes only the audit's `missing` set so an existing
// (possibly user-customized) tag row is never overwritten.
async function applyTagDecls(client: VaultClient, decls: RequiredTagDecl[]): Promise<void> {
  // Sequential rather than Promise.all — write parents before children so
  // `parent_names` can resolve. The vault's PUT is permissive about ordering,
  // but keeping the order matches the conceptual model + makes failure modes
  // clearer in logs. (The declared schema is a single parentless tag today;
  // the ordering discipline stands if it ever grows again.)
  for (const decl of decls) {
    await client.updateTag(decl.name, {
      description: decl.description,
      ...(decl.parent_names ? { parent_names: decl.parent_names } : {}),
    });
  }
}

// Quiet lazy-ensure, fired only when a save actually adds the inbox tag
// ("Tag new notes as an inbox" on — T-318; NoteNew's text + voice saves and
// Home's composer). Nothing calls it for an untagged note, so a vault that
// never opts in never gets the tag declared. `tagName` is the capture role in
// use (default `capture`); a renamed role is declared under its own name with
// the same description. Audits the vault's tags and creates only the MISSING
// one — a tag the
// vault already has is left alone even if its description drifted; the row
// belongs to the operator once it exists. Replaces the connect-time
// suggestion banner (notes#129, retired 2026-07): populate quietly instead
// of prompting.
//
// Contract: best-effort, silent, idempotent — NEVER blocks or fails the
// capture. Failures are logged and the guard rolls back so a later capture
// retries.
export async function ensureNotesSchema(
  vaultId: string,
  client: VaultClient,
  tagName: string = NOTES_REQUIRED_SCHEMA.tags[0]!.name,
): Promise<void> {
  const guardKey = `${vaultId}\u0000${tagName}`;
  if (ensuredVaults.has(guardKey)) return;
  // Mark as ensured BEFORE the async calls so concurrent invocations don't
  // race into a double-fire (two save paths can run in the same tick).
  ensuredVaults.add(guardKey);
  // `capture` keeps the description core's packs declare (byte-equal); a
  // renamed role gets a plain one that fits a text-only or voice-only tag.
  const capture = NOTES_REQUIRED_SCHEMA.tags[0]!;
  const decl: RequiredTagDecl = {
    name: tagName,
    description:
      tagName === capture.name
        ? capture.description
        : "Inbox: new notes from the Notes app that had no other tag yet.",
  };
  try {
    const audit = await auditSchema(client, [decl]);
    const missing = audit.missing.map((row) => row.expected);
    if (missing.length > 0) {
      await applyTagDecls(client, missing);
    }
  } catch (err) {
    // Roll back the guard so a future capture can retry. Schema-ensure is
    // best-effort; a transient 5xx shouldn't permanently disable it for the
    // session.
    ensuredVaults.delete(guardKey);
    // Don't rethrow — the capture itself still succeeds without the schema
    // setup (vault accepts notes whose tags have no identity row yet).
    if (typeof console !== "undefined") {
      console.warn(`[schema-ensure] failed to ensure required schema for vault ${vaultId}:`, err);
    }
  }
}

// Test-only escape hatch — resets the in-session guard so a test can
// exercise the ensure-once behavior across multiple captures without
// reloading the module.
export function _resetEnsuredVaultsForTesting(): void {
  ensuredVaults.clear();
}
