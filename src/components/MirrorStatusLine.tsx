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
  // The denominator is the vault's own note count when known (a cached read —
  // no new traffic in practice); until it resolves we show just the running
  // count rather than a misleading "/0".
  const total = useVaultInfo().data?.stats?.noteCount;
  const detail = typeof total === "number" && total > 0 ? `${done}/${total}` : `${done}`;
  return <StatusStrip>Saving your vault for offline · {detail}</StatusStrip>;
}

// A thin, calm full-width strip in the muted offline voice — not the red
// alert bar the failure banners use. `<output>` carries an implicit ARIA
// `status` role, so it's announced politely (same pattern as OfflineRibbon).
function StatusStrip({ children }: { children: React.ReactNode }) {
  return (
    <output className="block border-b border-border bg-bg-soft px-4 py-1.5 text-center text-xs text-fg-muted md:px-6">
      {children}
    </output>
  );
}

function stamp(ms: number): string {
  return relativeTime(new Date(ms).toISOString());
}
