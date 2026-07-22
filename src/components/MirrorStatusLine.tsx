import { relativeTime } from "@/lib/time";
import { useVaultInfo } from "@/lib/vault/queries";
import { useSync } from "@/providers/SyncProvider";

// Wave-4 durable-offline staleness UX — one quiet chrome line, never a loud
// banner. Shows at most one of:
//
//   - a one-time hydration progress line while the mirror first fills
//     ("Saving your vault for offline · {n}/{total}"), non-modal, gone the
//     moment it completes; or
//   - an offline line while we're serving the saved vault
//     ("Offline — showing your saved vault · updated {relative}").
//
// Both are flag-gated through `mirror.state`: with the mirror flag off the
// state is "off" and this renders nothing (byte-identical to before Wave 4).
// It shares the offline affordance's quiet voice (see OfflineRibbon) rather
// than competing with the red VaultStatusBanner stack above it.
//
// COPY IS A DRAFT pending Aaron's sign-off.
export function MirrorStatusLine() {
  const { mirror } = useSync();

  if (mirror.state === "hydrating") return <HydrationLine done={mirror.progress?.done ?? 0} />;
  if (mirror.state === "offline" && mirror.lastSyncedAt !== null) {
    return (
      <StatusStrip>
        Offline — showing your saved vault · updated {stamp(mirror.lastSyncedAt)}
      </StatusStrip>
    );
  }
  return null;
}

function HydrationLine({ done }: { done: number }) {
  // The denominator is the vault's own point-in-time note count when known. It
  // rides the ALREADY-fetched vault-info query (`?include_stats=true`, keyed
  // ["vaultInfo", activeVaultId], staleTime 30s) so this costs ZERO extra
  // traffic; until it resolves we show just the running count rather than a
  // misleading "/0".
  //
  // The real wire field is `totalNotes` — both the self-host daemon
  // (getVaultStats) and cloud emit it. The surface-client `VaultInfo` type only
  // declares a stale `noteCount` the wire never sends (which is why the earlier
  // denominator was always undefined), so we read `totalNotes` through a local
  // type until the SDK's VaultInfo catches up. Read-only augmentation, no
  // runtime effect.
  const stats = useVaultInfo().data?.stats as { totalNotes?: number } | undefined;
  const total = stats?.totalNotes;
  // "~T" (tilde): T is point-in-time while N accumulates across the walk, so N
  // may briefly exceed T if notes are added mid-sync — the tilde keeps it honest
  // rather than showing an impossible "205 of 200".
  const detail = typeof total === "number" && total > 0 ? `${done} of ~${total}` : `${done}`;
  // The count ticks once per synced page during cold hydration; announcing each
  // tick spams screen readers (#77). Keep the line VISIBLE but silence its live
  // region — the count isn't worth announcing. The offline/synced STATE
  // transition below still announces (implicit polite `status` role).
  return <StatusStrip live="off">Saving your vault for offline · {detail}</StatusStrip>;
}

// A thin, calm full-width strip in the muted offline voice — not the red
// alert bar the failure banners use. `<output>` carries an implicit ARIA
// `status` role, so it's announced politely (same pattern as OfflineRibbon).
// `live="off"` opts a strip out of that announcement (the chatty hydration
// progress) while leaving the DOM node reusable — when the strip's next render
// omits `live`, React drops the attribute and the implicit polite role returns.
function StatusStrip({ children, live }: { children: React.ReactNode; live?: "off" }) {
  return (
    <output
      aria-live={live}
      className="block border-b border-border bg-bg-soft px-4 py-1.5 text-center text-xs text-fg-muted md:px-6"
    >
      {children}
    </output>
  );
}

function stamp(ms: number): string {
  return relativeTime(new Date(ms).toISOString());
}
