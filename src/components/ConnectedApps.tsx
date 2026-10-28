import { disconnectVaultConnection, listVaultConnections } from "@/lib/account/client";
import { getDoorDescriptor } from "@/lib/account/descriptor";
import { isHostedVaultRecord } from "@/lib/account/hosted-vault";
import type { VaultConnection } from "@/lib/account/types";
import { relativeTime } from "@/lib/time";
import { useToastStore } from "@/lib/toast/store";
import { vaultServerSlug } from "@/lib/vault/deep-link";
import type { VaultRecord } from "@/lib/vault/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

// "Connected apps" in vault settings (T-318): the AIs and apps that can reach
// this vault, each with a Disconnect. Keeps the promise Connect AI and the
// consent page make ("Disconnect anytime from your vault's settings").
//
// Shown only when the home door advertises `capabilities.connections` (cloud)
// and the active vault is a home-door vault — the connections API answers for
// the door's own vaults. A hub, or a vault connected from another door, renders
// nothing here (unchanged from before).

type Fetch = typeof fetch;

type Load =
  | { kind: "loading" }
  | { kind: "ready"; connections: VaultConnection[] }
  | { kind: "error" };

const ACCESS_LABEL: Record<string, string> = {
  read: "Can read notes",
  write: "Can read and write notes",
  admin: "Full access",
};

export function ConnectedApps({
  vault,
  fetchImpl,
}: {
  vault: Pick<VaultRecord, "name" | "clientId"> & Partial<Pick<VaultRecord, "url">>;
  fetchImpl?: Fetch;
}) {
  const hosted = isHostedVaultRecord(vault.clientId);
  const [enabled, setEnabled] = useState(false);
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    if (!hosted) return;
    let live = true;
    getDoorDescriptor(fetchImpl)
      .then((d) => {
        if (live) setEnabled(d?.capabilities?.connections === true);
      })
      .catch(() => {
        // No descriptor → no capability → stay hidden.
      });
    return () => {
      live = false;
    };
  }, [hosted, fetchImpl]);

  // Only the newest request may paint: a slow answer for a vault the person
  // has since switched away from must never show under this vault's heading.
  // The SERVER slug, not the device-local label (a renamed vault keeps its slug).
  const slug = vaultServerSlug(vault.url) ?? vault.name;
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    setLoad((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    try {
      const res = await listVaultConnections(slug, fetchImpl);
      if (ticket !== latest.current) return;
      const list = Array.isArray(res?.connections) ? res.connections.filter(isConnection) : [];
      setLoad({ kind: "ready", connections: list });
    } catch {
      if (ticket === latest.current) setLoad({ kind: "error" });
    }
  }, [slug, fetchImpl]);

  // A different vault starts from a clean slate, never the previous list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: vault.name is the trigger.
  useEffect(() => {
    latest.current++;
    setLoad({ kind: "loading" });
  }, [vault.name]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  if (!hosted || !enabled) return null;

  return (
    <section
      aria-labelledby="connected-apps-heading"
      className="card space-y-4 rounded-xl p-6 shadow-soft"
    >
      <div>
        <h2 id="connected-apps-heading" className="font-serif text-xl text-fg">
          Connected apps
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          AIs and apps you've allowed into {vault.name}. Disconnect one and it loses access within
          about a minute.
        </p>
      </div>
      {load.kind === "loading" ? (
        <p className="text-sm text-fg-dim" aria-live="polite">
          Loading…
        </p>
      ) : load.kind === "error" ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-fg-muted">Couldn't load connected apps.</p>
          <button type="button" className="btn btn-secondary" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      ) : load.connections.length === 0 ? (
        <p className="text-sm text-fg-muted">
          Nothing is connected yet.{" "}
          <Link to="/connect" className="text-accent hover:underline">
            Connect an AI
          </Link>{" "}
          to read and write this vault from Claude, ChatGPT, or any MCP client.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {load.connections.map((c) => (
            <ConnectionRow
              key={c.client_id}
              connection={c}
              vaultSlug={slug}
              fetchImpl={fetchImpl}
              onDisconnected={refresh}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function isConnection(c: unknown): c is VaultConnection {
  return !!c && typeof c === "object" && typeof (c as VaultConnection).client_id === "string";
}

function ConnectionRow({
  connection: c,
  vaultSlug,
  fetchImpl,
  onDisconnected,
}: {
  connection: VaultConnection;
  vaultSlug: string;
  fetchImpl?: Fetch;
  onDisconnected: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const push = useToastStore((s) => s.push);
  const name = typeof c.client_name === "string" && c.client_name.trim() ? c.client_name : "An app";
  const connected = relativeTime(c.connected_at);
  const lastUsed = c.last_used_at ? relativeTime(c.last_used_at) : "";

  async function disconnect() {
    setBusy(true);
    try {
      await disconnectVaultConnection(vaultSlug, c.client_id, fetchImpl);
      push(`${name} is disconnected.`, "success");
      await onDisconnected();
    } catch {
      push(`Couldn't disconnect ${name}. Try again.`, "error");
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="block font-medium text-fg">{name}</span>
          <span className="mt-0.5 block text-sm text-fg-muted">
            {ACCESS_LABEL[c.access] ?? "Has access"}
            {connected ? ` · connected ${connected}` : ""}
            {lastUsed ? ` · last used ${lastUsed}` : ""}
          </span>
          {c.covers === "account" ? (
            <span className="mt-0.5 block text-xs text-fg-dim">
              Reaches every vault in your account; disconnecting removes it from all of them.
            </span>
          ) : null}
        </span>
        {!confirming ? (
          <button
            type="button"
            className="btn btn-secondary shrink-0"
            onClick={() => setConfirming(true)}
          >
            Disconnect
          </button>
        ) : null}
      </div>
      {confirming ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-sm text-fg">
            Disconnect {name}? You can connect it again later.
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            {busy ? "Disconnecting…" : `Yes, disconnect ${name}`}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </li>
  );
}
