import { clearVaultDrafts } from "@/lib/drafts/store";
import { create } from "zustand";
import {
  deleteServicesCatalog,
  deleteToken,
  loadActiveVaultId,
  loadToken,
  loadVaults,
  saveActiveVaultId,
  saveToken,
  saveVaults,
} from "./storage";
import type { StoredToken, VaultRecord } from "./types";
import { vaultIdFromUrl } from "./url";

export interface VaultStoreState {
  vaults: Record<string, VaultRecord>;
  activeVaultId: string | null;
  addVault: (
    input: Omit<VaultRecord, "id" | "addedAt" | "lastUsedAt">,
    token: StoredToken,
  ) => string;
  removeVault: (id: string) => void;
  setActiveVault: (id: string | null) => void;
  /**
   * Set a vault's display name — the identity threaded through the rail, the
   * home masthead, the document title, and the map's center. Used by the
   * first-run naming onboarding (`/welcome`).
   *
   * Display-only today: it renames the local `VaultRecord`, not the canonical
   * server-side vault. SEAM: once the hosted account/vault API is live (the
   * door descriptor at `/.well-known/parachute-account` + `PATCH /account/vaults`,
   * C4/C5), also persist the chosen name to the cloud vault so the MCP URL and
   * every device agree. Self-hosted vaults keep their hub-owned name.
   */
  renameVault: (id: string, name: string) => void;
  touchActive: (id: string) => void;
  getToken: (id: string) => StoredToken | null;
  getActiveVault: () => VaultRecord | null;
  getActiveToken: () => StoredToken | null;
}

export const useVaultStore = create<VaultStoreState>((set, get) => ({
  vaults: loadVaults(),
  activeVaultId: loadActiveVaultId(),

  addVault(input, token) {
    const id = vaultIdFromUrl(input.url);
    const now = new Date().toISOString();
    const record: VaultRecord = { ...input, id, addedAt: now, lastUsedAt: now };

    const nextVaults = { ...get().vaults, [id]: record };
    saveVaults(nextVaults);
    saveToken(id, token);
    saveActiveVaultId(id);
    set({ vaults: nextVaults, activeVaultId: id });
    return id;
  },

  removeVault(id) {
    const { [id]: _removed, ...rest } = get().vaults;
    saveVaults(rest);
    deleteToken(id);
    deleteServicesCatalog(id);
    // Disconnecting a vault must not leave its plaintext note drafts behind.
    clearVaultDrafts(id);
    const nextActive =
      get().activeVaultId === id ? (Object.keys(rest)[0] ?? null) : get().activeVaultId;
    saveActiveVaultId(nextActive);
    set({ vaults: rest, activeVaultId: nextActive });
  },

  setActiveVault(id) {
    saveActiveVaultId(id);
    set({ activeVaultId: id });
  },

  renameVault(id, name) {
    const existing = get().vaults[id];
    const trimmed = name.trim();
    if (!existing || !trimmed || existing.name === trimmed) return;
    const updated = { ...existing, name: trimmed };
    const nextVaults = { ...get().vaults, [id]: updated };
    saveVaults(nextVaults);
    set({ vaults: nextVaults });
  },

  touchActive(id) {
    const existing = get().vaults[id];
    if (!existing) return;
    const updated = { ...existing, lastUsedAt: new Date().toISOString() };
    const nextVaults = { ...get().vaults, [id]: updated };
    saveVaults(nextVaults);
    set({ vaults: nextVaults });
  },

  getToken(id) {
    return loadToken(id);
  },

  getActiveVault() {
    const { vaults, activeVaultId } = get();
    return activeVaultId ? (vaults[activeVaultId] ?? null) : null;
  },

  getActiveToken() {
    const { activeVaultId } = get();
    return activeVaultId ? loadToken(activeVaultId) : null;
  },
}));
