import { NOTES_APP } from "@/lib/capture/new-note-tags";

// Write-attribution (vault#298, surface-client 0.3.5) — the wire's four
// nullable fields, `createdBy`/`createdVia` set once at create, the
// `lastUpdated*` pair tracking the most recent mutating write. `*By` is a
// principal (a JWT sub, an `operator`/`token:<id>` label); `*Via` is the
// interface the write arrived through (`mcp`, `api`, `cli`/`operator`,
// `agent:<id>`, `surface:<name>`). `null`/absent = unknown, or a legacy
// record written before attribution existed — indistinguishable from each
// other and from "never updated," and NOT rendered as "unknown" noise.
//
// This module turns those four raw fields into display text. FACTUAL
// PROVENANCE ONLY: `friendlyVia` is a capitalization/expansion pass over the
// literal channel string, never a guess at who or what wrote the note — a
// vault#298 rule the spec carries into the UI verbatim. Never render
// `createdBy`/`lastUpdatedBy` (the principal, often a JWT sub or an internal
// id) as the visible label; they're only ever reachable via `raw`, meant for
// a title/tooltip attribute.
export interface ProvenanceAttribution {
  createdBy?: string | null;
  createdVia?: string | null;
  lastUpdatedBy?: string | null;
  lastUpdatedVia?: string | null;
  /** The note's metadata — read only for the app's own `app` stamp. */
  metadata?: Record<string, unknown> | null;
}

export interface ProvenanceParts {
  /** "via MCP" / "created via MCP · updated via API" — the ONE fragment a
   * compact context (a note row) shows. */
  compact: string;
  /** "via MCP" — null when createdVia is absent. */
  created: string | null;
  /** "via API" — null when lastUpdatedVia is absent. */
  updated: string | null;
  /** True when the created and last-updated PRINCIPAL differ — the signal
   * both compact and detail rendering use to decide whether "updated" adds
   * anything beyond "created". */
  differs: boolean;
  /** The raw createdBy/createdVia/lastUpdatedBy/lastUpdatedVia, human-joined
   * for a title/tooltip attribute — never the visible label. */
  raw: string;
}

const VIA_LABELS: Record<string, string> = {
  mcp: "MCP",
  api: "API",
  cli: "CLI",
  operator: "operator",
};

function friendlyVia(via: string): string {
  const known = VIA_LABELS[via];
  if (known) return known;
  // `agent:<id>` — the id isn't human-meaningful in a badge (stays in the
  // tooltip via `raw`); the generic noun is the factual, guess-free label.
  if (via.startsWith("agent:")) return "agent";
  // `surface:<name>` — the name IS the friendly noun (e.g. "surface:notes"
  // → "Notes"), still literal provenance, not an inference.
  if (via.startsWith("surface:")) {
    const name = via.slice("surface:".length);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : "surface";
  }
  // Unrecognized channel — pass the raw string through rather than guess.
  return via;
}

export function describeProvenance(note: ProvenanceAttribution): ProvenanceParts | null {
  // A note made in this app (T-318) carries `metadata.app: "notes"`, and the
  // vault stamps the channel of the app's own credential (`api` on both
  // doors). That channel is how the app talks to its vault, not news to the
  // person who typed the note here — "via API" reads as jargon. So the app's
  // channel says nothing; a write through any OTHER channel (an MCP edit)
  // still shows. Still factual: this hides a label, it never invents one.
  const ownVia = note.metadata?.app === NOTES_APP ? note.createdVia : null;
  const label = (via: string | null | undefined) =>
    via && via !== ownVia ? `via ${friendlyVia(via)}` : null;
  const created = label(note.createdVia);
  const updated = label(note.lastUpdatedVia);
  // Nothing factual to say (legacy record, or attribution never captured) —
  // tolerate silently, no "unknown" placeholder.
  if (!created && !updated) return null;

  const createdId = note.createdBy ?? note.createdVia ?? null;
  const updatedId = note.lastUpdatedBy ?? note.lastUpdatedVia ?? null;
  const differs = updatedId !== null && updatedId !== createdId;

  // When the principal DOESN'T differ, both compact and detail tell the
  // CREATED story (detail only ever shows "created" in this case — see
  // ProvenanceBadge's detail variant) — prefer `created` here too, so the
  // two mount points never disagree about which channel to name for the
  // same note.
  // On the app's own note the only fragment left can be a later edit from
  // elsewhere — say "updated" so it doesn't read as how the note was made.
  const fallback = ownVia && updated ? `updated ${updated}` : (updated ?? "");
  const compact =
    differs && created && updated
      ? `created ${created} · updated ${updated}`
      : (created ?? fallback);

  const raw = [
    note.createdBy ? `createdBy: ${note.createdBy}` : null,
    note.createdVia ? `createdVia: ${note.createdVia}` : null,
    note.lastUpdatedBy ? `lastUpdatedBy: ${note.lastUpdatedBy}` : null,
    note.lastUpdatedVia ? `lastUpdatedVia: ${note.lastUpdatedVia}` : null,
  ]
    .filter((s): s is string => !!s)
    .join(" · ");

  return { compact, created, updated, differs, raw };
}
