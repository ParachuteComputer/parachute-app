import type { TranscriptionCapability } from "@/lib/vault/types";

// Rendered where a voice affordance would otherwise sit when the vault
// EXPLICITLY declared transcription disabled (launch-audit P0-3). One quiet
// line — honest, not salesy. The copy differentiates the two doors by the
// capability's shape: a metered capability (`minutes_remaining` present) is
// the cloud plan gate, so name the Voice plan; otherwise it's a self-host
// vault without a configured transcription provider, where plan language
// would be wrong. Shared by NoteNew (the recorder's slot) and Home's
// composer mic (W2-10) so the two surfaces tell the same truth.
export function VoiceUnavailableNote({
  capability,
  className = "mb-4 text-xs text-fg-dim",
}: {
  capability: TranscriptionCapability | undefined;
  className?: string;
}) {
  const metered = typeof capability?.minutes_remaining === "number";
  return (
    <p className={className} data-testid="voice-unavailable">
      {metered
        ? "Voice transcription comes with the Voice plan."
        : "Voice transcription isn't enabled on this vault."}
    </p>
  );
}
