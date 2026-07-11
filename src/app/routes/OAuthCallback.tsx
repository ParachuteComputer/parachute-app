import { ParachuteMark, Wordmark } from "@/components/ParachuteMark";
import {
  PendingApprovalError,
  completeOAuth,
  saveServicesCatalog,
  storedFromTokenResponse,
  useVaultStore,
} from "@/lib/vault";
import { useAuthHaltStore } from "@/lib/vault/auth-halt-store";
import { announceVaultSwitch, vaultDisplayLabel } from "@/lib/vault/switch";
import { safeInternalRedirect } from "@/lib/vault/url";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

type Status =
  | { kind: "working" }
  | { kind: "error"; message: string }
  | { kind: "pending-approval"; approveUrl: string };

// The shared no-vault-yet layout — matches Landing.tsx / Welcome.tsx /
// CheckEmail.tsx / AddVault.tsx exactly, so the return trip from the hub
// hand-off reads as part of the same visual world.
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col">
      <div className="flex items-center px-6 pt-6 sm:px-10">
        <Wordmark />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <div className="mx-auto w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}

/** The hub/vault host named in an approve_url, for the "Approving Parachute
 *  on {host}" headline (sceneHubHandoff). Falls back to a generic phrase if
 *  the URL is somehow unparseable — it's already been validated as http(s)
 *  by `safeApproveUrl` before it reaches here, so this is defense-in-depth. */
function hostFromUrl(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    return "your hub";
  }
}

export function OAuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const addVault = useVaultStore((s) => s.addVault);
  const [status, setStatus] = useState<Status>({ kind: "working" });
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");

    if (oauthError) {
      // Surface the issuer's human-readable `error_description` alongside
      // the bare code — "invalid_scope" alone hides the actual reason
      // ("you do not own the vault: …").
      const description = params.get("error_description");
      setStatus({
        kind: "error",
        message: `Vault returned: ${oauthError}${description ? ` — ${description}` : ""}`,
      });
      return;
    }
    if (!code || !state) {
      setStatus({ kind: "error", message: "Missing code or state in callback URL." });
      return;
    }

    (async () => {
      try {
        const { pending, token } = await completeOAuth(code, state);
        // Hub-issued tokens carry a `services` catalog (Phase 1): trust the
        // hub's vault URL over whatever the user pasted, so a hub login works
        // even if the user typed the hub origin. Standalone-vault tokens have
        // no catalog, in which case the issuer URL itself is the vault URL.
        //
        // Multi-vault hubs (post hub#247/#248) also emit a per-vault key
        // `vault:<name>` alongside the legacy collapsed `vault` entry. Prefer
        // the per-vault key when the token's `vault` claim names which one we
        // OAuthed for — otherwise on a hub fronting boulder + gitcoin + techne
        // every connect would resolve to the same first-vault URL and the
        // stored VaultRecords would collide. Pre-#247 hubs (no per-vault keys)
        // fall through to the collapsed entry.
        const perVaultKey = token.vault ? `vault:${token.vault}` : undefined;
        const vaultUrl =
          (perVaultKey ? token.services?.[perVaultKey]?.url : undefined) ??
          token.services?.vault?.url ??
          pending.issuerUrl;
        // app-client's TokenResponse marks `vault` optional (hub responses
        // sometimes omit it on standalone-vault flows that pre-date hub-as-
        // issuer); fall back to the issuer-derived display name so VaultRecord
        // always carries something to render.
        const id = addVault(
          {
            url: vaultUrl,
            name: token.vault ?? pending.issuer,
            issuer: pending.issuer,
            tokenEndpoint: pending.tokenEndpoint,
            clientId: pending.clientId,
            scope: token.scope,
          },
          storedFromTokenResponse(token),
        );
        if (token.services) saveServicesCatalog(id, token.services);
        // Reconnect succeeded — clear the halt so the banner disappears.
        // Clear BOTH the new vault's id AND the originally-halted vault's id
        // when the reconnect path stashed one on the pending state. The two
        // can differ when the hub's token catalog resolves the vault to a
        // different URL than what was stored — addVault then creates a new
        // entry under a fresh id and the halt for the old id would otherwise
        // be orphaned in localStorage and re-surface the next time the user
        // switched back (notes#148).
        const halt = useAuthHaltStore.getState();
        halt.clearHalt(id);
        if (pending.priorHaltedVaultId && pending.priorHaltedVaultId !== id) {
          halt.clearHalt(pending.priorHaltedVaultId);
        }
        // Honor a post-connect redirect carried through the connect flow
        // (notes#63) — e.g. the hub `/account` "Import notes" deep-link
        // lands a first-time user on `/import` after connecting. Re-sanitize
        // defensively even though `/add` already filtered it: the pending
        // state rode through sessionStorage and an attacker who can plant
        // there must never steer navigate() off-origin. Falls back to `/`.
        const dest = safeInternalRedirect(pending.redirect) ?? "/";
        // §4.4 switch-confirmation — a fresh OAuth connect activates the new
        // vault (addVault sets it active), so it announces like every other
        // switch path. Label from the stored record (name, else URL host).
        const connected = useVaultStore.getState().vaults[id];
        if (connected) announceVaultSwitch(vaultDisplayLabel(connected));
        // NAVIGATION.md: "OAuth callback → target" — (b) one-shot params,
        // replace.
        navigate(dest, { replace: true });
      } catch (err) {
        if (err instanceof PendingApprovalError) {
          setStatus({
            kind: "pending-approval",
            approveUrl: err.approveUrl,
          });
          return;
        }
        setStatus({ kind: "error", message: (err as Error).message });
      }
    })();
  }, [params, navigate, addVault]);

  if (status.kind === "working") {
    return (
      <Shell>
        <ParachuteMark size={72} className="mx-auto mb-4 animate-pulse" />
        <p className="eyebrow mb-3">One moment</p>
        <h1 className="hero-title mb-2" style={{ fontSize: "clamp(1.8rem, 4vw, 2.3rem)" }}>
          Connecting<span className="accent-word">…</span>
        </h1>
        <output aria-live="polite" className="font-round text-sm text-fg-muted">
          Exchanging the authorization code with your vault.
        </output>
      </Shell>
    );
  }

  if (status.kind === "pending-approval") {
    const host = hostFromUrl(status.approveUrl);
    return (
      <Shell>
        <ParachuteMark size={60} className="mx-auto mb-6" />
        <p className="eyebrow mb-3">Redirected</p>
        <h1 className="hero-title mb-4" style={{ fontSize: "clamp(1.6rem, 3.5vw, 2.1rem)" }}>
          Approving Parachute on <span className="accent-word">{host}</span>
        </h1>
        <p className="mx-auto mb-8 max-w-sm text-fg-muted">
          Your hub admin needs to approve this app before sign-in can complete. Open the approval
          page in your hub, approve, then try again.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <a
            href={status.approveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary btn-lg justify-center rounded-full px-6 shadow-soft"
          >
            Open approval page →
          </a>
          <button
            type="button"
            // NAVIGATION.md: not a named row — this retry re-enters the
            // connect ceremony (the callback's one-shot code/state are
            // already spent), so it's the same "re-entering a transient
            // screen" shape as the dispatcher-fallback row — replace.
            onClick={() => navigate("/add", { replace: true })}
            className="font-round text-sm font-semibold text-fg-dim hover:text-accent"
          >
            Retry now
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <ParachuteMark size={60} className="mx-auto mb-6" />
      <p className="eyebrow mb-3">Connection failed</p>
      <h1 className="hero-title mb-4" style={{ fontSize: "clamp(1.6rem, 3.5vw, 2.1rem)" }}>
        Something went <span className="accent-word">sideways.</span>
      </h1>
      <p className="mx-auto mb-8 max-w-sm text-fg-muted">{status.message}</p>
      <button
        type="button"
        // NAVIGATION.md: same reasoning as the "Retry now" case above —
        // re-entering a transient ceremony step, replace.
        onClick={() => navigate("/add", { replace: true })}
        className="btn btn-primary btn-lg justify-center rounded-full px-6 shadow-soft"
      >
        Try again →
      </button>
    </Shell>
  );
}
