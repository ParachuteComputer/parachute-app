import { useTranscribeDefault } from "@/lib/capture/transcribe-default";
import { readStoredLivePreview, writeStoredLivePreview } from "@/lib/editor-mode";
import { MIRROR_CEILING_BYTES, measureMirrorBytes } from "@/lib/mirror/evict";
import { countMirrorNotes } from "@/lib/mirror/store";
import { PATH_TREE_MODES, type PathTreeMode, usePathTreeMode } from "@/lib/path-tree";
import { isStandalone } from "@/lib/pwa";
import {
  TEXT_SIZES,
  type TextSize,
  applyTextSize,
  readStoredTextSize,
  textSizeLabel,
  writeStoredTextSize,
} from "@/lib/text-size";
import { relativeTime } from "@/lib/time";
import { useToastStore } from "@/lib/toast/store";
import {
  DEFAULT_TAG_ROLES,
  TAG_ROLE_KEYS,
  type TagRoleKey,
  type TagRoles,
  useTagRoles,
  useTags,
  useVaultStore,
} from "@/lib/vault";
import {
  useAudioRetention,
  useRetentionChoiceMade,
  useSetAudioRetention,
} from "@/lib/vault/audio-retention";
import { useTranscriptionCapability } from "@/lib/vault/queries";
import type { AudioRetention } from "@/lib/vault/types";
import { useSync } from "@/providers/SyncProvider";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link, Navigate } from "react-router";

// Per-vault settings UI. A calm, sectioned nav-and-panels page (SYNTHESIS
// Scene 8) — not a dense form. Sections stack top-to-bottom with generous
// air between them; add more as the per-vault customization surface grows.
export function Settings() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  // NAVIGATION.md: route guard, no active vault — replace (this route was
  // never really shown, a shim in spirit).
  if (!activeVault) return <Navigate to="/" replace />;

  return (
    <div className="page-prose">
      <header className="mb-10">
        <nav className="mb-4 text-sm text-fg-dim">
          <Link to="/" className="focus-ring hover:text-accent">
            ← Home
          </Link>
        </nav>
        <p className="eyebrow mb-1">{activeVault.name}</p>
        <h1 className="page-title">Settings</h1>
        <p className="mt-2 text-fg-muted">Everything about this vault, in one calm place.</p>
      </header>

      <div className="space-y-8">
        <ManageSection />
        <ImportSection />
        <VoiceSection vaultId={activeVault.id} />
        <EditorSection />
        <TextSizeSection />
        <PathTreeSection vaultId={activeVault.id} />
        <TagRolesSection vaultId={activeVault.id} />
        <OfflineSection vaultId={activeVault.id} />
        <InstallStateSection />
      </div>
    </div>
  );
}

// The dissolved console (SYNTHESIS D5): Settings is where the console's surface
// area comes home. Account is now managed IN the app (the `/account` surface —
// plan, billing, hosted vaults, sign-in), so this links there rather than
// bouncing to the console; the one true trip out (Stripe billing) lives behind
// Account's own button. The Account row degrades gracefully on a self-host
// device (no cloud account → a "manage this device" view), so it's honest on
// both doors.
function ManageSection() {
  return (
    <section aria-label="Manage">
      <h2 className="eyebrow mb-3">Manage</h2>
      <div className="card divide-y divide-border rounded-xl shadow-soft">
        <ManageRow
          to="/account"
          title="Account"
          description="Your plan, billing, hosted vaults, and sign-in — managed in the app."
        />
        <ManageRow
          to="/connect"
          title="Connections"
          description="Connect Claude, ChatGPT, or any MCP client to this vault."
        />
        <ManageRow
          to="/vaults"
          title="Vaults"
          description="Add a vault, switch between them, or export."
        />
      </div>
    </section>
  );
}

// A calm settings row — title + muted sub + a right-aligned arrow (Scene 8's
// "quiet sectioned nav" pattern). Internal destinations use `to` (client
// route); external doors (the console) use `href` and carry a "↗" so the hop
// off the app is honest, not disguised.
function ManageRow({
  to,
  href,
  title,
  description,
}: {
  to?: string;
  href?: string;
  title: string;
  description: string;
}) {
  const body: ReactNode = (
    <>
      <span className="min-w-0">
        <span className="block font-medium text-fg">{title}</span>
        <span className="mt-0.5 block text-sm text-fg-muted">{description}</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-fg-dim">
        {href ? "↗" : "→"}
      </span>
    </>
  );
  const className =
    "focus-ring flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-bg-soft first:rounded-t-xl last:rounded-b-xl";
  if (href) {
    return (
      <a href={href} className={className}>
        {body}
      </a>
    );
  }
  return (
    <Link to={to ?? "/"} className={className}>
      {body}
    </Link>
  );
}

// One-line surfacing of the import route on Settings — the import surface
// itself is a full page (`/import`), this just hands the user a discovery
// path from the obvious place (vault settings is where "what can I do
// with this vault?" affordances belong).
function ImportSection() {
  return (
    <section className="card space-y-3 rounded-xl p-6 shadow-soft">
      <div>
        <h2 className="font-serif text-xl text-fg">Import notes</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Bring in an Obsidian vault zip or a folder of markdown files. Parsed in your browser;
          previewed before any note lands in the vault.
        </p>
      </div>
      <Link to="/import" className="btn btn-primary btn-touch">
        Open importer
      </Link>
    </section>
  );
}

// The "Vault schema" audit section that used to sit here (notes#129) was
// retired in the 2026-07 one-tag simplification: the single `capture` tag
// is now lazily ensured on first capture (schema-ensure.ts), so there is
// nothing for the operator to review or fix.

// One honest line per retention option; changing PATCHes immediately; errors
// surface as a toast and the radios stay on the server truth (controlled inputs
// off the cached /api/vault read — a failed PATCH never lies about state).
const RETENTION_OPTIONS: { value: AudioRetention; title: string; help: string }[] = [
  {
    value: "keep",
    title: "Keep",
    help: "Recordings are stored with your notes; included wherever attachments are included.",
  },
  {
    value: "until_transcribed",
    title: "Delete after transcribing",
    help: "Your words stay; the audio file is removed once the transcript lands.",
  },
  {
    value: "never",
    title: "Never store",
    help: "Audio is removed even if transcription fails — the transcript is your only copy; failed transcriptions lose the audio.",
  },
];

// Unified Voice section (voice W3): one place for how voice capture behaves in
// this vault. Two settings with deliberately different scopes, said out loud:
//   1. "Transcribe recordings by default" — the DEFAULT the per-capture toggle
//      starts at. This is a CLIENT capture-behavior preference (the app sends
//      `transcribe:` per attachment; the client owns that policy at attach
//      time), so it's stored app-local per-vault, per device — like the other
//      capture-surface preferences (path tree, text size).
//   2. "Keep recordings" (retention) — SERVER-side vault config
//      (`config.audio_retention` on GET/PATCH /api/vault, identical on both
//      doors), so it applies to the vault from every connected device.
// Whole section gated like the mic itself (#167): a vault that EXPLICITLY
// declares transcription disabled has no recorder, so neither knob is offered.
// Absent/undeclared keeps the section (absent ≠ disabled — the mic renders
// there too). Both capability + retention reads are cached queries; no new
// network.
function VoiceSection({ vaultId }: { vaultId: string }) {
  const transcription = useTranscriptionCapability();
  const retention = useAudioRetention();
  const setRetention = useSetAudioRetention();
  const { markMade } = useRetentionChoiceMade(vaultId);
  const { transcribeDefault, setTranscribeDefault } = useTranscribeDefault(vaultId);
  const pushToast = useToastStore((s) => s.push);

  if (transcription?.enabled === false) return null;

  const onChange = (value: AudioRetention) => {
    if (value === retention.value || setRetention.isPending) return;
    setRetention.mutate(value, {
      onSuccess: () => {
        // Also settles the first-capture prompt — an operator who set the
        // dial here has made their choice; don't re-ask at the recorder.
        markMade();
        pushToast("Voice recording setting saved.", "success");
      },
      onError: (err) => {
        pushToast(
          err instanceof Error && err.message
            ? `Couldn't save: ${err.message}`
            : "Couldn't save the voice recording setting.",
          "error",
        );
      },
    });
  };

  return (
    <section className="card space-y-6 rounded-xl p-6 shadow-soft">
      <div>
        <h2 className="font-serif text-xl text-fg">Voice</h2>
        <p className="mt-1 text-sm text-fg-muted">How voice capture behaves in this vault.</p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-fg">Transcribe recordings by default</h3>
          <p className="mt-1 text-sm text-fg-muted">
            New voice notes start with transcription on — your words are added to the note. Turn it
            off for a single recording right where you capture. Applies on this device.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={transcribeDefault}
          aria-label="Transcribe recordings by default"
          data-testid="transcribe-default-toggle"
          onClick={() => setTranscribeDefault(!transcribeDefault)}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
            transcribeDefault ? "bg-accent" : "bg-border"
          }`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-card shadow-sm transition-transform ${
              transcribeDefault ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <div className="space-y-4 border-t border-border pt-6">
        <div>
          <h3 className="font-medium text-fg">Keep recordings</h3>
          <p className="mt-1 text-sm text-fg-muted">
            What happens to the audio file after a voice note is transcribed. Applies to this vault,
            from every device connected to it.
          </p>
        </div>
        {retention.isLoading ? (
          <p className="text-sm text-fg-dim">Loading…</p>
        ) : retention.isError ? (
          <p className="text-sm text-fg-dim" data-testid="retention-load-error">
            Couldn't load this setting — check the vault connection.
          </p>
        ) : (
          <>
            <fieldset
              className="space-y-2"
              disabled={!retention.supported || setRetention.isPending}
            >
              <legend className="sr-only">Voice recording retention</legend>
              {RETENTION_OPTIONS.map((o) => {
                const active = retention.value === o.value;
                return (
                  <label
                    key={o.value}
                    className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${
                      active ? "border-accent bg-accent/5" : "border-border hover:border-accent/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="audio-retention"
                      value={o.value}
                      checked={active}
                      onChange={() => onChange(o.value)}
                      className="mt-1 accent-accent"
                    />
                    <span>
                      <span className="block font-medium text-fg">{o.title}</span>
                      <span className="mt-0.5 block text-sm text-fg-muted">{o.help}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {!retention.supported ? (
              <p className="text-xs text-fg-dim" data-testid="retention-unsupported">
                This vault doesn't support changing this yet — recordings are kept. Update the vault
                to choose.
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

// A4-SPEC §7: one toggle, no other options — the escape hatch (raw split-
// pane editor) exists for when live preview gets in the way, but it doesn't
// need to be one tap away from the editor chrome itself. Lazy initializer
// for the same flash-avoidance reason as TextSizeSection below.
function EditorSection() {
  const [on, setOn] = useState<boolean>(() => readStoredLivePreview());

  const onChange = (next: boolean) => {
    setOn(next);
    writeStoredLivePreview(next);
  };

  return (
    <section className="card space-y-4 rounded-xl p-6 shadow-soft">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-xl text-fg">Live preview</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Formats your writing as you type — Markdown stays underneath. Turn off for the raw
            editor with a side-by-side preview.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Live preview"
          onClick={() => onChange(!on)}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
            on ? "bg-accent" : "bg-border"
          }`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-card shadow-sm transition-transform ${
              on ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </section>
  );
}

// View-level text-size knob — per-device because eye-days vary independently
// of vault. The dropdown applies + persists in one motion via the helpers in
// lib/text-size.ts; App.tsx already applies the stored value on mount, so
// this section's job is just "change + save".
function TextSizeSection() {
  // Lazy initializer reads localStorage during the first render, not in a
  // useEffect afterward — without this the radio briefly renders "Default"
  // before the effect overwrites with the stored value, which the reviewer
  // on #123 flagged as a visible flash.
  const [size, setSize] = useState<TextSize>(() => readStoredTextSize());

  const onChange = (next: TextSize) => {
    setSize(next);
    writeStoredTextSize(next);
    applyTextSize(next);
  };

  return (
    <section className="card space-y-4 rounded-xl p-6 shadow-soft">
      <div>
        <h2 className="font-serif text-xl text-fg">Text size</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Affects the editor and rendered notes on this device. Your markdown isn't changed.
        </p>
      </div>
      <fieldset className="space-y-2">
        <legend className="sr-only">View text size</legend>
        {TEXT_SIZES.map((s) => {
          const active = size === s;
          return (
            <label
              key={s}
              className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
                active ? "border-accent bg-accent/5" : "border-border hover:border-accent/40"
              }`}
            >
              <input
                type="radio"
                name="text-size"
                value={s}
                checked={active}
                onChange={() => onChange(s)}
                className="accent-accent"
              />
              <span className="font-medium text-fg">{textSizeLabel(s)}</span>
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}

// Offline (durable mirror) — Wave 4. Only rendered when the mirror flag is on;
// with it off the whole section is absent (no offline machinery to manage).
// Shows the mirror's status + last sync + storage footprint against the 512 MB
// ceiling, and two actions: sync now, and clear the offline copy (which wipes
// only the mirror rows — never the un-synced write queue).
//
// COPY IS A DRAFT pending Aaron's sign-off.
function OfflineSection({ vaultId }: { vaultId: string }) {
  const { db, mirror } = useSync();
  const pushToast = useToastStore((s) => s.push);
  const [usage, setUsage] = useState<{ bytes: number; count: number } | null>(null);
  const [busy, setBusy] = useState<null | "sync" | "clear">(null);

  const refresh = useCallback(async () => {
    if (!db) return;
    const [bytes, count] = await Promise.all([
      measureMirrorBytes(db, vaultId),
      countMirrorNotes(db, vaultId),
    ]);
    setUsage({ bytes, count });
  }, [db, vaultId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!mirror.enabled) return null;

  const onSync = async () => {
    if (busy) return;
    setBusy("sync");
    try {
      await mirror.syncNow();
      await refresh();
      pushToast("Synced offline copy.", "success");
    } catch {
      pushToast("Couldn't sync the offline copy right now.", "error");
    } finally {
      setBusy(null);
    }
  };

  const onClear = async () => {
    if (busy) return;
    if (!confirm("Clear this vault's offline copy from this device? Un-synced changes are kept."))
      return;
    setBusy("clear");
    try {
      await mirror.clearOffline();
      await refresh();
      pushToast("Offline copy cleared.", "success");
    } catch {
      pushToast("Couldn't clear the offline copy.", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card space-y-5 rounded-xl p-6 shadow-soft" aria-label="Offline">
      <div>
        <h2 className="font-serif text-xl text-fg">Offline</h2>
        <p className="mt-1 text-sm text-fg-muted">
          A copy of this vault is kept on this device so your notes open without a connection.
        </p>
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-fg-muted">Status</dt>
          <dd className="text-fg">{describeMirrorState(mirror.state)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-fg-muted">Last synced</dt>
          <dd className="text-fg-muted">
            {mirror.lastSyncedAt
              ? relativeTime(new Date(mirror.lastSyncedAt).toISOString())
              : "never"}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-fg-muted">Saved on this device</dt>
          <dd className="text-fg-muted tabular-nums" data-testid="offline-usage">
            {usage
              ? `${usage.count} note${usage.count === 1 ? "" : "s"} · ${formatOfflineBytes(usage.bytes)} of ${formatOfflineBytes(MIRROR_CEILING_BYTES)}`
              : "—"}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          onClick={onSync}
          disabled={busy !== null}
          className="btn btn-secondary btn-touch"
        >
          {busy === "sync" ? "Syncing…" : "Sync now"}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={busy !== null}
          className="text-sm text-danger hover:underline disabled:opacity-60"
        >
          {busy === "clear" ? "Clearing…" : "Clear offline copy"}
        </button>
      </div>
    </section>
  );
}

function describeMirrorState(state: string): string {
  switch (state) {
    case "hydrating":
      return "Saving your vault…";
    case "offline":
      return "Offline — showing your saved vault";
    case "error":
      return "Sync error";
    default:
      return "Saved for offline";
  }
}

// Coarse MB/GB formatting for the offline footprint line. The mirror byte
// count is an estimate (see mirror/evict.ts), so one decimal place is honest
// enough — no false precision.
function formatOfflineBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function InstallStateSection() {
  // matchMedia is only reliable at render time on some browsers, so sample
  // once on mount.
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    setInstalled(isStandalone());
  }, []);
  if (!installed) return null;
  return (
    <section className="card rounded-xl p-6 text-sm shadow-soft">
      <p className="text-fg-muted">
        <span className="mr-2 inline-block rounded-full bg-positive-soft px-2 py-0.5 text-xs font-medium text-positive">
          Installed
        </span>
        Parachute is running as an installed app on this device.
      </p>
    </section>
  );
}

const PATH_TREE_MODE_LABELS: Record<PathTreeMode, { title: string; help: string }> = {
  auto: {
    title: "Auto",
    help: "Show the tree only when the vault has enough folders to make it worth the space.",
  },
  always: {
    title: "Always",
    help: "Always show the tree, even on a tag-flat vault.",
  },
  never: {
    title: "Never",
    help: "Hide the tree. The path-prefix text input still works.",
  },
};

function PathTreeSection({ vaultId }: { vaultId: string }) {
  const { mode, setMode } = usePathTreeMode(vaultId);
  return (
    <section className="card space-y-4 rounded-xl p-6 shadow-soft">
      <div>
        <h2 className="font-serif text-xl text-fg">Folder tree (Notes sidebar)</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Controls the collapsible folder tree on the notes list page. Auto-detect renders the tree
          when the vault has at least five top-level folders or twenty notes in folders.
        </p>
      </div>
      <fieldset className="space-y-2">
        <legend className="sr-only">Path tree visibility</legend>
        {PATH_TREE_MODES.map((m) => {
          const active = mode === m;
          return (
            <label
              key={m}
              className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${
                active ? "border-accent bg-accent/5" : "border-border hover:border-accent/40"
              }`}
            >
              <input
                type="radio"
                name="path-tree-mode"
                value={m}
                checked={active}
                onChange={() => setMode(m)}
                className="mt-1 accent-accent"
              />
              <span>
                <span className="block font-medium text-fg">{PATH_TREE_MODE_LABELS[m].title}</span>
                <span className="mt-0.5 block text-sm text-fg-muted">
                  {PATH_TREE_MODE_LABELS[m].help}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}

const ROLE_LABELS: Record<TagRoleKey, { title: string; help: string }> = {
  pinned: {
    title: "Pinned",
    help: "Tag for notes you want at the top of views.",
  },
  archived: {
    title: "Archived",
    help: "Tag for notes you've moved out of the way.",
  },
  captureVoice: {
    title: "Voice capture",
    help: "Default tag for new voice memos.",
  },
  captureText: {
    title: "Text capture",
    help: "Default tag for quick typed notes.",
  },
  view: {
    title: "Saved view",
    help: "Tag the saved-view notes carry. Used to list them in the notes sidebar.",
  },
};

function TagRolesSection({ vaultId }: { vaultId: string }) {
  const { roles, setRoles } = useTagRoles(vaultId);
  const tagsQuery = useTags();
  const pushToast = useToastStore((s) => s.push);
  const datalistId = useId();

  const [draft, setDraft] = useState<TagRoles>(roles);
  useEffect(() => setDraft(roles), [roles]);

  const tagOptions = useMemo(() => {
    const names = (tagsQuery.data ?? []).map((t) => t.name);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }, [tagsQuery.data]);

  const isDirty = TAG_ROLE_KEYS.some((k) => draft[k].trim() !== roles[k]);

  const save = () => {
    setRoles(draft);
    pushToast("Tag roles saved.", "success");
  };

  const resetDefaults = () => {
    setRoles(null);
    setDraft(DEFAULT_TAG_ROLES);
    pushToast("Tag roles reset to defaults.", "success");
  };

  return (
    <section className="card space-y-5 rounded-xl p-6 shadow-soft">
      <div>
        <h2 className="font-serif text-xl text-fg">Tag roles</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Point each role at whatever tag your vault already uses. Changes apply to future notes
          only — existing notes keep their current tags.
        </p>
      </div>

      <datalist id={datalistId}>
        {tagOptions.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <div className="space-y-4">
        {TAG_ROLE_KEYS.map((key) => (
          <label key={key} className="block text-sm">
            <span className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="font-medium text-fg">{ROLE_LABELS[key].title}</span>
              <span className="text-xs text-fg-dim">default: #{DEFAULT_TAG_ROLES[key]}</span>
            </span>
            <input
              type="text"
              value={draft[key]}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              list={datalistId}
              placeholder={DEFAULT_TAG_ROLES[key]}
              aria-label={`${ROLE_LABELS[key].title} tag role`}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              className="input input-on-bg"
            />
            <span className="mt-1.5 block text-xs text-fg-dim">{ROLE_LABELS[key].help}</span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-1">
        <button type="button" onClick={save} disabled={!isDirty} className="btn btn-primary btn-lg">
          Save
        </button>
        <button type="button" onClick={resetDefaults} className="btn btn-ghost">
          Reset to defaults
        </button>
      </div>
    </section>
  );
}
