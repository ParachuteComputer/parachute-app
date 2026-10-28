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
 * Fallback, unchanged from before: `<vault.url>/mcp` — a self-hosted hub (no
 * `mcp_url` in its list), a vault connected over OAuth from another door (not
 * in this door's list), a signed-out session, or any failure.
 */
import { listVaults } from "@/lib/account/client";
import { isHostedVaultRecord } from "@/lib/account/hosted-vault";
import type { AccountVault } from "@/lib/account/types";
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

type Fetch = typeof fetch;

/** How long Connect AI waits for the door before showing the derived address. */
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
    // derived one (it works too) and stop waiting.
    const giveUp = setTimeout(() => {
      if (live) setState({ url: derived, settled: true });
      live = false;
    }, LOOKUP_TIMEOUT_MS);
    listVaults(fetchImpl)
      .then((res) => {
        if (!live) return;
        const advertised = advertisedMcpUrl(
          Array.isArray(res?.vaults) ? res.vaults : [],
          vault.name,
        );
        setState({ url: advertised ?? derived, settled: true });
      })
      .catch(() => {
        if (live) setState({ url: derived, settled: true });
      });
    return () => {
      live = false;
      clearTimeout(giveUp);
    };
  }, [hosted, derived, vault.name, fetchImpl]);

  return state;
}
