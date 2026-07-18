import { useCallback, useEffect, useState } from "react";

// Per-vault default for the voice-capture "Transcribe" toggle — what the
// per-capture toggle STARTS at each time you open the recorder in this vault.
// Defaults to ON (transcribe): the product's baseline is "your words come back
// as text," and a user opts a single capture (or this vault's baseline) OUT.
//
// Deliberately CLIENT-LOCAL per-vault (localStorage, the `lens:path-tree:` /
// `lens:audio-retention-choice:` pattern), NOT server config. Whether to ask
// the vault to transcribe is a capture-behavior decision the client owns at
// attach time (it already sends `transcribe:` per attachment): the app is the
// policy owner here, so the DEFAULT for that per-capture choice lives with the
// app, per-device, like the other capture-surface preferences. (The cloud
// door's stored `auto_transcribe` config stays inert — its wiring/removal is a
// separate door-parity decision, W3 non-goal.)
export const DEFAULT_TRANSCRIBE_DEFAULT = true;

const STORAGE_PREFIX = "lens:transcribe-default:";

function keyFor(vaultId: string): string {
  return STORAGE_PREFIX + vaultId;
}

export function loadTranscribeDefault(vaultId: string): boolean {
  try {
    const raw = localStorage.getItem(keyFor(vaultId));
    if (!raw) return DEFAULT_TRANSCRIBE_DEFAULT;
    const parsed = JSON.parse(raw) as { transcribe?: unknown };
    return typeof parsed.transcribe === "boolean" ? parsed.transcribe : DEFAULT_TRANSCRIBE_DEFAULT;
  } catch {
    return DEFAULT_TRANSCRIBE_DEFAULT;
  }
}

export function saveTranscribeDefault(vaultId: string, transcribe: boolean): void {
  try {
    localStorage.setItem(keyFor(vaultId), JSON.stringify({ transcribe }));
  } catch {
    // storage unavailable — best-effort only
  }
}

export function deleteTranscribeDefault(vaultId: string): void {
  try {
    localStorage.removeItem(keyFor(vaultId));
  } catch {
    // storage unavailable — best-effort only
  }
}

export function useTranscribeDefault(vaultId: string | null): {
  transcribeDefault: boolean;
  setTranscribeDefault: (next: boolean) => void;
} {
  const [transcribeDefault, setState] = useState<boolean>(() =>
    vaultId ? loadTranscribeDefault(vaultId) : DEFAULT_TRANSCRIBE_DEFAULT,
  );

  useEffect(() => {
    setState(vaultId ? loadTranscribeDefault(vaultId) : DEFAULT_TRANSCRIBE_DEFAULT);
  }, [vaultId]);

  const setTranscribeDefault = useCallback(
    (next: boolean) => {
      if (!vaultId) return;
      saveTranscribeDefault(vaultId, next);
      setState(next);
    },
    [vaultId],
  );

  return { transcribeDefault, setTranscribeDefault };
}
