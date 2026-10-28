import { AccountApiError, SessionExpiredError, deleteVault } from "@/lib/account/client";
import { type DoorDescriptor, getDoorDescriptor } from "@/lib/account/descriptor";
import { isHostedVaultRecord } from "@/lib/account/hosted-vault";
import { ACCOUNT_SUMMARY_QUERY_KEY } from "@/lib/account/use-summary";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

// "Delete this vault" — the last section of a vault's Settings (T-318).
// Settings is the per-vault management surface ("Everything about this
// vault"), so the destructive verb for the active vault lives there.
//
// Renders only for a HOSTED vault on THIS door — minted through the account
// session (`clientId === HOSTED_CLIENT_ID`) with the serving origin as issuer,
// i.e. a vault the signed-in account owns — and only when the door advertises
// `capabilities.vault_delete === true`. A self-hosted vault connected over
// OAuth (or any vault on a hub) never shows it; the door still enforces
// ownership server-side (403 not_owner).

function isHomeDoorHostedVault(vault: Pick<VaultRecord, "clientId" | "issuer">): boolean {
  if (!isHostedVaultRecord(vault.clientId)) return false;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return vault.issuer === origin;
}

function errorCopy(err: unknown): string {
  if (err instanceof SessionExpiredError) {
    return "Your sign-in has ended. Sign in again, then come back here to delete this vault.";
  }
  if (err instanceof AccountApiError) {
    if (err.message === "confirm_mismatch") return "That doesn't match the vault name.";
    if (err.message === "not_owner") return "That vault isn't linked to this account.";
    // The door's own message ("…try again.", …).
    if (err.message && !/^[a-z0-9_]+$/.test(err.message)) return err.message;
  }
  return "Couldn't delete this vault. Try again.";
}

export function DeleteVault({ vault }: { vault: VaultRecord }) {
  const hosted = isHomeDoorHostedVault(vault);
  const [descriptor, setDescriptor] = useState<DoorDescriptor | null>(null);

  useEffect(() => {
    // Only a hosted vault ever needs the door's answer — a self-hosted vault
    // never pays for the descriptor read.
    if (!hosted) return;
    let live = true;
    getDoorDescriptor().then((d) => {
      if (live) setDescriptor(d);
    });
    return () => {
      live = false;
    };
  }, [hosted]);

  if (!hosted || descriptor?.capabilities?.vault_delete !== true) return null;
  return <DeleteVaultSection vault={vault} />;
}

function DeleteVaultSection({ vault }: { vault: VaultRecord }) {
  const inputId = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const removeVault = useVaultStore((s) => s.removeVault);
  const pushToast = useToastStore((s) => s.push);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The local record is forgotten AFTER this screen unmounts, not before we
  // navigate: Settings redirects to "/" the moment it has no active vault, which
  // would race (and win over) the move to the Vaults list when this was the
  // last vault on the device.
  const forgetOnUnmount = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (forgetOnUnmount.current) removeVault(forgetOnUnmount.current);
    },
    [removeVault],
  );

  const name = vault.name;
  const confirmed = typed === name;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteVault(name, typed);
    } catch (err) {
      setError(errorCopy(err));
      setBusy(false);
      return;
    }
    // The vault is gone on the door — drop this device's record of it (token,
    // services catalog, drafts) the same way "Remove from this device" does,
    // and let the plan's vault count refresh.
    forgetOnUnmount.current = vault.id;
    void queryClient.invalidateQueries({ queryKey: ACCOUNT_SUMMARY_QUERY_KEY });
    pushToast(`Vault ${name} deleted.`, "success");
    navigate("/vaults");
  }

  return (
    <section aria-label="Delete this vault" className="card space-y-3 rounded-xl p-6 shadow-soft">
      <h2 className="font-serif text-xl text-fg">Delete this vault</h2>
      <p className="text-sm text-fg-muted">
        This deletes the vault <b className="font-semibold text-fg">{name}</b> now: every note,
        file, snapshot and export in it. It is immediate and permanent, and there is no undo.{" "}
        <Link to="/export" className="focus-ring text-accent underline">
          Export first
        </Link>{" "}
        if you want a copy.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor={inputId} className="block text-sm font-medium text-fg">
          Type the vault name to confirm
        </label>
        <input
          id={inputId}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={name}
          className="input"
        />
        <button
          type="submit"
          disabled={!confirmed || busy}
          className="btn btn-danger-solid btn-touch"
        >
          {busy ? "Deleting…" : "Delete vault"}
        </button>
      </form>
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
