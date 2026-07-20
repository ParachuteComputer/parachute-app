import { MIRROR_FLAG_KEY } from "@/lib/mirror/flag";
import {
  countMirrorNotes,
  createMirrorWriteSink,
  getMirrorNote,
  upsertMirrorNote,
} from "@/lib/mirror/store";
import type { VaultClient } from "@/lib/vault/client";
import type { Note } from "@/lib/vault/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIdbBlobStore } from "./blob-store";
import { type LensDB, openLensDB } from "./db";
import { drain, enqueue } from "./queue";

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
}

// Minimal client: the note-mutation methods the drain calls, each returning a
// server-authored Note where relevant.
function makeClient(over: Partial<Record<keyof VaultClient, unknown>> = {}): VaultClient {
  return {
    createNote: vi.fn(
      async (payload: { content?: string }): Promise<Note> => ({
        id: "srv-created",
        createdAt: "2026-07-20T00:00:00Z",
        updatedAt: "2026-07-20T00:00:00Z",
        content: payload.content ?? "",
      }),
    ),
    updateNote: vi.fn(
      async (id: string, payload: { content?: string }): Promise<Note> => ({
        id,
        createdAt: "2026-07-20T00:00:00Z",
        updatedAt: "2026-07-20T02:00:00Z",
        content: payload.content ?? "",
      }),
    ),
    deleteNote: vi.fn(async () => {}),
    getNote: vi.fn(async () => null),
    ...over,
  } as unknown as VaultClient;
}

function drainCtx(db: LensDB, client: VaultClient) {
  return {
    db,
    client,
    vaultId: "v1",
    blobStore: createIdbBlobStore(db),
    mirror: createMirrorWriteSink(db),
  };
}

describe("queue drain — mirror write-path (flag ON)", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
    localStorage.clear();
    localStorage.setItem(MIRROR_FLAG_KEY, "true");
  });
  afterEach(() => {
    db.close();
    localStorage.clear();
  });

  it("create landing swaps the optimistic local-id row for the server row", async () => {
    // The offline create path seeded this optimistic row (local id).
    await upsertMirrorNote(db, "v1", {
      id: "local-abc",
      createdAt: "2026-07-20T00:00:00Z",
      content: "# optimistic",
    });
    await enqueue(
      db,
      { kind: "create-note", localId: "local-abc", payload: { content: "# optimistic" } },
      { vaultId: "v1" },
    );

    await drain(drainCtx(db, makeClient()));

    expect(await getMirrorNote(db, "v1", "local-abc")).toBeUndefined();
    const server = await getMirrorNote(db, "v1", "srv-created");
    expect(server?.content).toBe("# optimistic");
    // id_map still recorded (queue's own logic unchanged).
    expect(await db.get("id_map", "local-abc")).toMatchObject({ realId: "srv-created" });
    expect(await countMirrorNotes(db, "v1")).toBe(1);
  });

  it("update landing upserts the server-authored note into the mirror", async () => {
    await upsertMirrorNote(db, "v1", {
      id: "srv-1",
      createdAt: "2026-07-20T00:00:00Z",
      updatedAt: "2026-07-20T00:00:00Z",
      content: "# stale",
    });
    await enqueue(
      db,
      { kind: "update-note", targetId: "srv-1", payload: { content: "# edited" } },
      { vaultId: "v1" },
    );

    await drain(drainCtx(db, makeClient()));

    const row = await getMirrorNote(db, "v1", "srv-1");
    expect(row?.content).toBe("# edited");
    expect(row?.updatedAt).toBe("2026-07-20T02:00:00Z"); // server-authored timestamp
  });

  it("delete landing removes the mirror row", async () => {
    await upsertMirrorNote(db, "v1", {
      id: "srv-2",
      createdAt: "2026-07-20T00:00:00Z",
      content: "# doomed",
    });
    await enqueue(db, { kind: "delete-note", targetId: "srv-2" }, { vaultId: "v1" });

    await drain(drainCtx(db, makeClient()));

    expect(await getMirrorNote(db, "v1", "srv-2")).toBeUndefined();
  });
});

describe("queue drain — mirror write-path (flag OFF → inert)", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
    localStorage.clear(); // flag absent → off
  });
  afterEach(() => {
    db.close();
  });

  it("leaves the mirror untouched on a create landing while the queue still drains", async () => {
    // A pre-existing optimistic row (seeded directly — the sink no-ops when off).
    await upsertMirrorNote(db, "v1", {
      id: "local-abc",
      createdAt: "2026-07-20T00:00:00Z",
      content: "# optimistic",
    });
    await enqueue(
      db,
      { kind: "create-note", localId: "local-abc", payload: { content: "# optimistic" } },
      { vaultId: "v1" },
    );

    const outcome = await drain(drainCtx(db, makeClient()));

    // Queue drained normally (id_map recorded), but the mirror is unchanged:
    // no server row added, the local row untouched.
    expect(outcome.drained).toBe(1);
    expect(await db.get("id_map", "local-abc")).toMatchObject({ realId: "srv-created" });
    expect(await getMirrorNote(db, "v1", "srv-created")).toBeUndefined();
    expect(await getMirrorNote(db, "v1", "local-abc")).toBeDefined();
  });
});
