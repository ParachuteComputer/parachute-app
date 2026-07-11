import type { VaultRecord } from "@/lib/vault/types";
import { isHostedVaultRecord } from "./hosted-vault";
import type { AccountVaultUsage } from "./types";

/**
 * Provenance vocabulary shared by the Account manager surface and the Vaults
 * (device) list. Every vault the app can reach is one of two things:
 *
 *   · CLOUD — minted through the HOME DOOR (the app's own serving origin, via
 *     the account session). `clientId === HOSTED_CLIENT_ID`.
 *   · SELF-HOSTED — a foreign parachute connected via `/add` (OAuth to another
 *     door). Its `issuer` is that door's origin; we surface the host.
 *
 * The chip label is the ONE place this vocabulary is spoken, so both surfaces
 * stay consistent.
 */
export type VaultProvenance =
  | { kind: "cloud"; label: string }
  | { kind: "self-hosted"; host: string; label: string };

/**
 * The friendly name for a HOME-DOOR vault. The home door is the app's serving
 * origin; on cloud that reads "Cloud".
 *
 * TODO(door-agnostic): served by a user's own hub, the honest label is the
 * hub's name — derive it from a door descriptor once the contract carries one.
 * We launch on cloud first, so "Cloud" is correct for the shipped door.
 */
export function homeDoorLabel(): string {
  return "Cloud";
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Classify a stored vault by where it was minted (see `VaultProvenance`). */
export function vaultProvenance(
  record: Pick<VaultRecord, "clientId" | "issuer" | "url">,
): VaultProvenance {
  if (isHostedVaultRecord(record.clientId)) {
    return { kind: "cloud", label: homeDoorLabel() };
  }
  // A self-hosted vault's door is its issuer (captured at connect); fall back
  // to the vault URL's host, then a neutral phrase — never fabricate a host.
  const host = hostOf(record.issuer) ?? hostOf(record.url) ?? "your server";
  return { kind: "self-hosted", host, label: `Self-hosted · ${host}` };
}

/**
 * Human byte size — KB / MB / GB, one decimal below 10 of a unit. Returns null
 * for zero/negative so callers can drop the line rather than print "0 KB". The
 * shared formatter for vault usage AND account-level storage roll-ups.
 */
export function formatBytes(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const kb = bytes / 1024;
  const mb = kb / 1024;
  const gb = mb / 1024;
  if (gb >= 1) return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
  if (mb >= 1) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${Math.max(1, Math.round(kb))} KB`;
}

/**
 * A vault's total usage (notes + attachments), formatted. Cloud's usage is
 * BYTES only (no note count), nullable — so a missing/empty usage yields null.
 */
export function formatUsageBytes(usage?: AccountVaultUsage | null): string | null {
  if (!usage) return null;
  return formatBytes((usage.notes_bytes ?? 0) + (usage.attachment_bytes ?? 0));
}
