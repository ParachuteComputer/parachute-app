/**
 * The ONE MCP address to show a person (T-318).
 *
 * A hosted vault's REST URL in the app comes from the token mint's services
 * catalog — the vault worker's MACHINE origin (`u.parachute.computer` on
 * cloud). That address keeps working forever, but it is not what the door
 * advertises: cloud prints `my.parachute.computer/vault/<name>/mcp` everywhere
 * else (console, emails). So Connect AI asks the home door: when
 * `GET /account/vaults` carries an `mcp_url` for this vault, that is the
 * address shown and copied, and the Claude Code command uses it too.
 *
 * When that list can't answer (the account session is gone while the vault
 * token still works, a slow network) or lists the vault without `mcp_url`, the door's
 * PUBLIC descriptor still knows the address: its `vault_url_template` is built
 * from the same advertised origin as `mcp_url`, needs no session, and is cached
 * per origin. Without this a phone whose session had lapsed showed u.… while
 * the desktop showed my.… for the same vault (snag #13).
 *
 * Last resort: `<vault.url>/mcp` — a self-hosted hub that publishes neither, a
 * vault connected over OAuth from another door (not in this door's list), or
 * no answer at all. It works too; it just isn't the address the door prints.
 */
import { listVaults } from "@/lib/account/client";
import {
  type DoorDescriptor,
  getDoorDescriptor,
  peekDoorDescriptor,
} from "@/lib/account/descriptor";
import { isHostedVaultRecord } from "@/lib/account/hosted-vault";
import type { AccountVault } from "@/lib/account/types";
import { vaultServerSlug } from "@/lib/vault/deep-link";
import type { VaultRecord } from "@/lib/vault/types";
import { useEffect, useState } from "react";
import { mcpEndpoint } from "./connect";

/** The door's advertised MCP URL for `name`, or null when absent / not a URL. */
export function advertisedMcpUrl(vaults: readonly AccountVault[], name: string): string | null {
  const row = vaults.find((v) => v?.name === name);
  const raw = row?.mcp_url;
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? raw : null;
  } catch {
    return null;
  }
}

/** `<template with {name}>/mcp` from the door's descriptor, or null when it
 *  publishes no usable template. */
export function templatedMcpUrl(door: DoorDescriptor | null, slug: string): string | null {
  const template = door?.vault_url_template;
  if (typeof template !== "string" || !template.includes("{name}")) return null;
  try {
    const u = new URL(template.replace("{name}", encodeURIComponent(slug)));
    return u.protocol === "https:" || u.protocol === "http:" ? mcpEndpoint(u.href) : null;
  } catch {
    return null;
  }
}

type Fetch = typeof fetch;

/** How long Connect AI waits for the door before showing a fallback address. */
export const LOOKUP_TIMEOUT_MS = 4000;

/**
 * The address to show for `vault`: `{ url, settled }`. For a home-door
 * (hosted) vault it waits for the door's answer (`settled: false` meanwhile, so
 * the page never flashes the machine address and then swaps it); any other
 * vault resolves to the derived address at once.
 */
export function useMcpAddress(
  vault: Pick<VaultRecord, "url" | "name" | "clientId">,
  fetchImpl?: Fetch,
): { url: string; settled: boolean } {
  const derived = mcpEndpoint(vault.url);
  const hosted = isHostedVaultRecord(vault.clientId);
  // Match by the SERVER slug: a renamed vault keeps its slug, not its label.
  const slug = vaultServerSlug(vault.url) ?? vault.name;
  const [state, setState] = useState<{ url: string; settled: boolean }>({
    url: derived,
    settled: !hosted,
  });

  useEffect(() => {
    if (!hosted) {
      setState({ url: derived, settled: true });
      return;
    }
    let live = true;
    setState({ url: derived, settled: false });
    // Never leave the page without an address: if the door is slow, show the
    // descriptor's address this device already knows (else the derived one,
    // which works too) and stop waiting.
    const giveUp = setTimeout(() => {
      if (live)
        setState({ url: templatedMcpUrl(peekDoorDescriptor(), slug) ?? derived, settled: true });
      live = false;
    }, LOOKUP_TIMEOUT_MS);
    const fallBack = async () =>
      templatedMcpUrl(await getDoorDescriptor(fetchImpl), slug) ?? derived;
    listVaults(fetchImpl)
      .then(async (res) => {
        if (!live) return;
        const rows = Array.isArray(res?.vaults) ? res.vaults : [];
        // The template only stands in for a row the door lists without an
        // mcp_url; a vault the list doesn't carry isn't this door's to name.
        const listed = rows.some((v) => v?.name === slug);
        const advertised = advertisedMcpUrl(rows, slug);
        const url = advertised ?? (listed ? await fallBack() : derived);
        clearTimeout(giveUp);
        if (live) setState({ url, settled: true });
      })
      .catch(async () => {
        const url = await fallBack();
        clearTimeout(giveUp);
        if (live) setState({ url, settled: true });
      });
    return () => {
      live = false;
      clearTimeout(giveUp);
    };
  }, [hosted, derived, slug, fetchImpl]);

  return state;
}
