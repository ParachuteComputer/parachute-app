import { isLegacyVaultUrl, useVaultStore } from "@/lib/vault";
import { Link } from "react-router";

export function Vaults() {
  const vaults = useVaultStore((s) => s.vaults);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const removeVault = useVaultStore((s) => s.removeVault);
  const setActiveVault = useVaultStore((s) => s.setActiveVault);

  const list = Object.values(vaults).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="page-prose">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Vaults</h1>
          <p className="mt-2 text-fg-muted">Every vault you've connected, in one place.</p>
        </div>
        <Link to="/add" className="btn btn-primary btn-touch">
          Add vault
        </Link>
      </header>

      {list.length === 0 ? (
        <div className="card rounded-xl p-8 text-center shadow-soft">
          <p className="mb-1 font-serif text-lg text-fg">No vaults connected yet.</p>
          <p className="mb-5 text-sm text-fg-muted">
            Add one by its address to bring it into Parachute.
          </p>
          <Link to="/add" className="btn btn-primary btn-touch">
            Add vault
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((vault) => {
            const isActive = vault.id === activeVaultId;
            const isLegacy = isLegacyVaultUrl(vault.url);
            return (
              <li key={vault.id} className="card rounded-xl p-5 shadow-soft">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-serif text-lg text-fg">{vault.name}</span>
                      {isActive ? <span className="chip chip-tag-active">active</span> : null}
                      <span className="chip">{vault.scope}</span>
                      {isLegacy ? (
                        <span className="chip border-warning/40 bg-warning-soft text-warning">
                          needs reconnect
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate note-id">{vault.url}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 text-sm">
                    {!isActive ? (
                      <button
                        type="button"
                        onClick={() => setActiveVault(vault.id)}
                        className="focus-ring text-fg-muted hover:text-accent"
                      >
                        Make active
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Remove ${vault.name}? The access token will be deleted.`)) {
                          removeVault(vault.id);
                        }
                      }}
                      className="focus-ring text-danger hover:text-danger-hover"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {isLegacy ? (
                  <p className="mt-3 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
                    Vault now serves under <code className="font-mono">/vault/&lt;name&gt;/</code>.
                    This stored URL is from the older scheme and won't reach the new endpoints.
                    Remove this entry and{" "}
                    <Link to="/add" className="underline">
                      add it again
                    </Link>{" "}
                    — discovery will pick the right URL automatically.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
