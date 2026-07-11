import { ParachuteMark, Wordmark } from "@/components/ParachuteMark";
import { listVaults } from "@/lib/account/client";
import { loadLastSigninEmail } from "@/lib/account/store";
import type { AccountPlan } from "@/lib/account/types";
import { useVaultStore } from "@/lib/vault/store";
import { type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router";

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
  const [plan, setPlan] = useState<AccountPlan | null>(null);

  // Best-effort plan-slot fetch for the Create card's quiet foot line
  // ("2 of 3 plan slots used"). Purely decorative — a failure (offline,
  // signed-out edge case) just omits the foot line; it never blocks or
  // errors the chooser itself.
  useEffect(() => {
    let cancelled = false;
    listVaults()
      .then((res) => {
        if (!cancelled) setPlan(res.plan ?? null);
      })
      .catch(() => {
        // best-effort — see comment above.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const slots =
    plan?.vault_limit != null && plan?.vaults_used != null
      ? `${plan.vaults_used} of ${plan.vault_limit} plan slots used`
      : null;

  return (
    <Shell>
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
          onClick={() => navigate("/welcome")}
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
          onClick={() => navigate("/welcome?new=1")}
        />
        <ChooserCard
          icon="⌂"
          verb="Connect"
          description="A self-hosted vault on your own server."
          onClick={() => navigate("/add")}
        />
      </div>
    </Shell>
  );
}

// The shared no-vault-yet layout — matches Landing.tsx / Welcome.tsx /
// CheckEmail.tsx / AddVault.tsx exactly. Wider than the wizard column
// (max-w-2xl, not max-w-md) so the three-card grid has room to breathe.
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col">
      <div className="flex items-center px-6 pt-6 sm:px-10">
        <Wordmark />
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
