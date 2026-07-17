import { useToastStore } from "@/lib/toast/store";
import { useCreateNote, useVaultStore } from "@/lib/vault";
import { VaultTargetExistsError } from "@/lib/vault/client";
import { useTagRoles } from "@/lib/vault/settings";
import { viewPathForName } from "@/lib/views/defaults";
import { useCallback, useState } from "react";
import { Navigate, useNavigate } from "react-router";

// The human creation path (VIEWS-RENDER-SPEC §6): "New view" creates a
// `#view` note at `Views/<name>` — kind list, empty query (a problems-free
// "everything" view) — and opens it as a view; refine + Save from there.
// A dedicated route (not a click handler on the Rail item) keeps the
// Rail/NavSheet's Link-only architecture untouched — the ROW is a plain
// NavItem, the CEREMONY lives here, same pattern as `/add-vault/create`.
export function ViewNew() {
  const vault = useVaultStore((s) => s.getActiveVault());
  const { roles } = useTagRoles(vault?.id ?? null);
  const createNote = useCreateNote();
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();
  const [name, setName] = useState("New view");
  const [pending, setPending] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const create = useCallback(async () => {
    const trimmed = name.trim() || "New view";
    setPending(true);
    try {
      const note = await createNote.mutateAsync({
        content: "",
        path: viewPathForName(trimmed),
        tags: [roles.view],
        metadata: { kind: "list", query: "{}" },
      });
      setCreatedId(note.id);
    } catch (err) {
      if (err instanceof VaultTargetExistsError) {
        pushToast("A note already exists at that path — try a different name.", "error");
      } else {
        pushToast(`Could not create the view: ${(err as Error).message}`, "error");
      }
    } finally {
      setPending(false);
    }
  }, [name, createNote, roles.view, pushToast]);

  if (!vault) return <Navigate to="/" replace />;
  if (createdId) return <Navigate to={`/views/${encodeURIComponent(createdId)}`} replace />;

  return (
    <div className="page-prose">
      <h1 className="page-title mb-2">New view</h1>
      <p className="mb-6 text-fg-muted">
        A view is a note that describes a query — refine and save it from the view itself once it's
        open.
      </p>
      <label className="mb-4 block text-sm">
        <span className="mb-1 block text-fg-muted">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !pending) void create();
          }}
          // biome-ignore lint/a11y/noAutofocus: this screen's single purpose is this field.
          autoFocus
          className="w-full rounded-lg border border-border bg-bg/40 px-3 py-2 text-fg focus:border-accent focus:outline-none"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="btn btn-secondary btn-touch"
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void create()}
          disabled={pending}
          className="btn btn-primary btn-touch"
        >
          {pending ? "Creating…" : "Create view"}
        </button>
      </div>
    </div>
  );
}
