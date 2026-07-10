import { ParachuteMark } from "@/components/ParachuteMark";
import { useVaultStore } from "@/lib/vault";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router";

// A vault name that reads as a machine default rather than something the user
// chose — a host, a URL, or an issuer origin (the fallbacks OAuthCallback uses
// when a token omits a friendly `vault` claim). We start the field empty for
// these so a brand-new account gets the naming delight, and pre-fill it for a
// vault that already carries a chosen name (a returning user just confirms).
function looksLikeDefaultName(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  return n.includes("://") || n.includes(".") || n.includes("/");
}

// The first-run moment — "What should we call your vault?" — RELOCATED here from
// the arrival (Aaron: ask the name AFTER the account exists, not before). The
// hosted sign-in flow lands here via OAuthCallback's `redirect` (see
// hosted-door.ts); a returning user whose vault is already named simply confirms.
//
// Naming sets the vault's DISPLAY name today (it threads through the rail, the
// home masthead, the document title, the map's center). SEAM: the canonical
// server-side vault name lands when the hosted account/vault API is live
// (`/.well-known/parachute-account` + `PATCH /account/vaults`, C4/C5) — see
// `renameVault` in the vault store.
export function Welcome() {
  const vault = useVaultStore((s) => s.getActiveVault());
  const renameVault = useVaultStore((s) => s.renameVault);
  const navigate = useNavigate();

  // Someone hit /welcome with no connected vault — nothing to name. The index
  // dispatcher sends them to the arrival.
  const initial = vault && !looksLikeDefaultName(vault.name) ? vault.name : "";
  const [name, setName] = useState(initial);

  if (!vault) return <Navigate to="/" replace />;

  const trimmed = name.trim();

  function finish() {
    if (vault && trimmed) renameVault(vault.id, trimmed);
    navigate("/", { replace: true });
  }

  return (
    <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mx-auto w-full max-w-xl">
        <ParachuteMark size={64} className="mx-auto mb-6 drop-in" />

        <p className="eyebrow mb-3">You're in — name your vault</p>
        <h1 className="hero-title mb-4">
          What should we call your <span className="accent-word">vault?</span>
        </h1>
        <p className="mx-auto mb-8 max-w-md text-lg leading-relaxed text-fg-muted">
          A word for the place your thinking lives — it becomes the title, the switcher, the map's
          center, everywhere. You can change it later.
        </p>

        <input
          // biome-ignore lint/a11y/noAutofocus: this screen's single purpose is this field.
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") finish();
          }}
          placeholder="gardening"
          autoComplete="off"
          spellCheck={false}
          aria-label="Vault name"
          className="mx-auto mb-2 block w-full max-w-sm border-0 border-b-2 border-border bg-transparent pb-2 text-center font-serif text-3xl text-fg outline-none transition-colors focus:border-accent-light"
        />
        <p className="mb-8 min-h-6 font-round text-sm text-fg-muted">
          {trimmed ? (
            <span>
              Your vault:{" "}
              <b className="rounded-md bg-grass-soft px-2 py-0.5 text-grass-ink">{trimmed}</b>
            </span>
          ) : (
            "Type a name — watch it thread through everything after."
          )}
        </p>

        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={finish}
            disabled={!trimmed}
            className="btn btn-primary btn-lg justify-center rounded-full px-6 shadow-soft"
          >
            Open my vault →
          </button>
          <button
            type="button"
            onClick={() => navigate("/", { replace: true })}
            className="font-round text-sm font-semibold text-fg-dim hover:text-accent"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
