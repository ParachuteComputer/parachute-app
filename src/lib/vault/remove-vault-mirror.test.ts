import { readNote, readNotesList } from "@/lib/mirror/read";
import { countMirrorNotes, setMirrorLastSyncedAt, upsertMirrorNote } from "@/lib/mirror/store";
import { type LensDB, openLensDB } from "@/lib/sync/db";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// T-318 review 3. Deleting a vault (DeleteVault) or the account
// (DeleteAccount's forgetAccountVaults) ends in removeVault. The SPA's durable
// offline mirror is ON by default and holds every note of the vault in
// IndexedDB; removeVault clears the token and the localStorage drafts but not
// the mirror. The browser keeps the "permanently deleted" vault's notes, and a
// vault re-created under the same URL (same vault id) serves them again
// local-first, since the completeness watermark is still set.

const record: VaultRecord = {
  id: "moss-id",
  url: "https://vault.example.com/vault/moss",
  name: "moss",
  issuer: "https://id.example.com",
  clientId: "c",
  scope: "vault:moss:read vault:moss:write",
  addedAt: "2026-10-01T00:00:00.000Z",
  lastUsedAt: "2026-10-01T00:00:00.000Z",
};

describe("removing a vault from this browser", () => {
  let db: LensDB;
  beforeEach(async () => {
    indexedDB.deleteDatabase("parachute-lens");
    localStorage.clear();
    db = await openLensDB();
  });
  afterEach(() => db.close());

  it("leaves none of its notes in the offline mirror", async () => {
    await upsertMirrorNote(db, record.id, {
      id: "n1",
      path: "Inbox/n1",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      content: "the words the owner deleted",
    });
    await setMirrorLastSyncedAt(db, record.id, Date.parse("2026-10-01T00:00:00Z"));
    useVaultStore.setState({ vaults: { [record.id]: record }, activeVaultId: record.id });

    useVaultStore.getState().removeVault(record.id);
    await new Promise((r) => setTimeout(r, 50));

    const list = await readNotesList(db, record.id, new URLSearchParams());
    expect({
      rows: await countMirrorNotes(db, record.id),
      note: (await readNote(db, record.id, "n1"))?.content ?? null,
      listed: list?.length ?? 0,
    }).toEqual({ rows: 0, note: null, listed: 0 });
  });
});
