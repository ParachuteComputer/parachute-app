import { ParachuteMark, Wordmark } from "@/components/ParachuteMark";
import { loadLastSigninEmail } from "@/lib/account/store";
import { useVaultStore } from "@/lib/vault/store";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";

// The in-app "add a vault" chooser (SYNTHESIS #10) — the second and only
// other naming home besides the first-vault onboarding form. Reached from
// the picker's quiet footer link and (later) a dedicated entry point. Three
// explicit verbs, one meaning each: Open (an existing account vault not on
// this device), Create (a brand-new hosted one), Connect (a self-hosted
// one) — never a fourth meaning layered onto any of them.
export function AddVaultChooser() {
  const navigate = useNavigate();
  const email = loadLastSigninEmail();
  const activeVault = useVaultStore((s) => s.getActiveVault());
  // The Create card's "N of M plan slots used" foot line needs a plan/usage
  // SUMMARY endpoint that cloud doesn't expose yet (GET /account/vaults returns
  // only the vault list). Seam it: no foot line until the account-manager plan
  // endpoint lands (PR-2). Don't fabricate slot counts.
  const slots: string | null = null;
  // F6 — a quiet way out. Reached from /vaults' "Add vault" button when a
  // vault is already active on this device (the common F2 path), so back
  // returns there; with no active vault (first-run, or reached directly) the
  // front door / boot dispatcher is the only sane fallback.
  const backTo = activeVault ? "/vaults" : "/";

  return (
    <Shell backTo={backTo}>
      <ParachuteMark size={56} className="mx-auto mb-6" />
      {email ? (
        <p className="chip mb-4 inline-flex border-grass/40 bg-grass-soft text-grass-ink">
          <span aria-hidden="true">✓</span>&nbsp;Signed in as {email}
        </p>
      ) : null}
      <p className="eyebrow mb-3">Add a vault</p>
      <h1 className="hero-title mb-8" style={{ fontSize: "clamp(1.8rem, 4vw, 2.4rem)" }}>
        Bring another <span className="accent-word">vault</span> in.
      </h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <ChooserCard
          icon="📂"
          verb="Open"
          description="One of your account's vaults not on this device."
          // `?pick=1` forces the picker even when the account has exactly one
          // vault (F13) — without it the dispatcher's welcome-back auto-open
          // (classifyVaults) silently reopens the vault you're likely already
          // in, turning "open a vault not on this device" into a no-op bounce.
          // NAVIGATION.md: "Chooser card → ... /welcome?pick=1 ..." — push.
          onClick={() => navigate("/welcome?pick=1")}
        />
        <ChooserCard
          icon="✦"
          verb="Create"
          description={
            activeVault ? (
              <>
                Brand-new and empty — separate from{" "}
                <b className="font-semibold text-fg">{activeVault.name}</b>.
              </>
            ) : (
              "Brand-new and empty — its own private space, nothing shared."
            )
          }
          foot={slots}
          // NAVIGATION.md: "Chooser card → /welcome?new=1 ..." — push.
          onClick={() => navigate("/welcome?new=1")}
        />
        <ChooserCard
          icon="⌂"
          verb="Connect"
          description="A self-hosted vault on your own server."
          // NAVIGATION.md: "Chooser card → ... /add" — push.
          onClick={() => navigate("/add")}
        />
      </div>
    </Shell>
  );
}

// The shared no-vault-yet layout — matches Landing.tsx / Welcome.tsx /
// CheckEmail.tsx / AddVault.tsx exactly. Wider than the wizard column
// (max-w-2xl, not max-w-md) so the three-card grid has room to breathe.
// `backTo` (F6) renders a quiet "← Back" beside the (now-linked) Wordmark —
// this screen otherwise has no other exit.
function Shell({ children, backTo }: { children: ReactNode; backTo?: string }) {
  return (
    <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col">
      <div className="flex items-center justify-between px-6 pt-6 sm:px-10">
        <Wordmark />
        {backTo ? (
          <Link to={backTo} className="focus-ring font-round text-sm text-fg-dim hover:text-accent">
            ← Back
          </Link>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <div className="mx-auto w-full max-w-2xl">{children}</div>
      </div>
    </div>
  );
}

// A big warm tile for one verb — icon, verb heading, description, optional
// quiet foot line (prototype .chooser-card). A real <button>, not a styled
// <div role="button">, so keyboard + AT support come for free.
function ChooserCard({
  icon,
  verb,
  description,
  foot,
  onClick,
}: {
  icon: string;
  verb: string;
  description: ReactNode;
  foot?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={verb}
      className="tile flex flex-col items-center gap-2 p-6 text-center"
    >
      <span aria-hidden="true" className="text-xl">
        {icon}
      </span>
      <span aria-hidden="true" className="font-round text-base font-bold text-fg">
        {verb}
      </span>
      <span className="font-round text-xs leading-relaxed text-fg-muted">{description}</span>
      {foot ? <span className="mt-1 font-round text-xs text-fg-dim">{foot}</span> : null}
    </button>
  );
}
