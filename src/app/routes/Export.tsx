import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault";
import { VaultNotFoundError } from "@/lib/vault/client";
import { useActiveVaultClient } from "@/lib/vault/queries";
import { useCallback, useState } from "react";
import { Link, Navigate } from "react-router";

type Stage =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "error"; message: string }
  // The self-hosted bun vault has no HTTP export route today (CLI-only) —
  // this is a distinct, honest outcome from a network/server failure, not
  // something a retry will fix.
  | { kind: "unsupported" };

/**
 * The browser-based export surface (Wave-3 — "Open format. Export anytime."
 * finally has a door on this app; Import already had one). Mirrors Import's
 * shell: a short honest explainer, one primary action, no fake progress.
 *
 * The vault backend already streams a portable-markdown `.tar` at
 * `GET /api/export` (read-scoped) — this route surfaces existing plumbing,
 * it adds none. See `exportVault` in `@/lib/vault/client` for the
 * door-specific honesty this page renders: cloud vaults answer with a
 * complete export (notes + tags/schemas + attachment binaries); self-hosted
 * vaults 404 (export there is CLI-only, `parachute-vault export <dir>`) —
 * this page catches that specifically and points at the CLI rather than
 * showing a generic "couldn't reach your vault" for a door gap.
 */
export function Export() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const client = useActiveVaultClient();
  const pushToast = useToastStore((s) => s.push);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  if (!activeVault) {
    // NAVIGATION.md: route guard, no active vault — replace (this route was
    // never really shown, a shim in spirit).
    return <Navigate to="/" replace />;
  }

  const onExport = useCallback(async () => {
    if (!client) {
      pushToast("Vault session unavailable — reconnect first", "error");
      return;
    }
    setStage({ kind: "preparing" });
    try {
      const blob = await client.exportVault();
      // Derived at click time — a real download, not something a test needs
      // to pin byte-for-byte (the vault name + calendar date is enough to
      // tell two exports apart in a Downloads folder).
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `${activeVault.name}-export-${date}.tar`);
      setStage({ kind: "idle" });
      pushToast("Export downloaded.", "success");
    } catch (err) {
      if (err instanceof VaultNotFoundError) {
        setStage({ kind: "unsupported" });
        return;
      }
      setStage({ kind: "error", message: "Couldn't reach your vault — try again." });
    }
  }, [client, activeVault.name, pushToast]);

  const preparing = stage.kind === "preparing";

  return (
    <div className="page-prose">
      <nav className="mb-4 text-sm text-fg-dim">
        <Link to="/notes" className="focus-ring hover:text-accent">
          ← All notes
        </Link>
      </nav>

      <header className="mb-8">
        <h1 className="page-title">
          Export notes from <span className="text-accent">{activeVault.name}</span>
        </h1>
        <p className="mt-3 text-fg-muted">
          A portable folder of your notes — plain Markdown, with your tags, links, and attachments
          included. Yours to keep, no matter what happens to Parachute.
        </p>
      </header>

      <section className="card space-y-5 rounded-xl p-6 shadow-soft">
        <div>
          <h2 className="font-serif text-lg text-fg">What's in the download</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted">
            <li>One markdown file per note, with tags, metadata, and links as frontmatter.</li>
            <li>Your tag definitions, so an import elsewhere keeps their structure.</li>
            <li>
              Attachment files — images, audio, PDF, video — alongside the notes that use them.
            </li>
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onExport}
            disabled={preparing}
            className="btn btn-primary btn-touch"
          >
            {preparing ? "Preparing your export…" : "Export my vault"}
          </button>
          {preparing ? <span className="text-sm text-fg-dim">This can take a moment.</span> : null}
        </div>

        {stage.kind === "error" ? (
          <p className="rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
            {stage.message}
          </p>
        ) : null}

        {stage.kind === "unsupported" ? (
          <div className="rounded-lg border border-border bg-bg-soft px-3 py-2 text-sm text-fg-muted">
            <p>
              Export over the web isn't available on this vault yet — self-hosted vaults don't carry
              this door today.
            </p>
            <p className="mt-1">
              From the vault's command line, run{" "}
              <code className="rounded bg-card px-1 font-mono text-fg">
                parachute-vault export &lt;dir&gt;
              </code>{" "}
              to get the same portable folder.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

// Trigger a browser download from an in-memory Blob — the object-URL +
// anchor-click trick, with the anchor briefly attached to the DOM (needed
// for reliable `.click()` handling in Safari, not just Chrome/Firefox).
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
