import { type LensDB, openLensDB } from "@/lib/sync/db";
import { recordIdMap } from "@/lib/sync/id-map";
import { enqueue } from "@/lib/sync/queue";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectProtectedIds, diffMirror, makeIsProtected, referencedNoteId } from "./reconcile";

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
}

describe("referencedNoteId", () => {
  it("maps each note-bearing mutation to its id and the rest to null", () => {
    expect(
      referencedNoteId({ kind: "create-note", localId: "local-a", payload: { content: "" } }),
    ).toBe("local-a");
    expect(referencedNoteId({ kind: "update-note", targetId: "srv-1", payload: {} })).toBe("srv-1");
    expect(referencedNoteId({ kind: "delete-note", targetId: "srv-2" })).toBe("srv-2");
    expect(
      referencedNoteId({ kind: "link-attachment", noteId: "srv-3", pathRef: "p", mimeType: "m" }),
    ).toBe("srv-3");
    expect(
      referencedNoteId({ kind: "delete-attachment", noteId: "srv-4", attachmentId: "a" }),
    ).toBe("srv-4");
    // No note reference — blob-keyed / path-keyed.
    expect(
      referencedNoteId({
        kind: "upload-attachment",
        blobId: "b",
        filename: "f",
        mimeType: "m",
      }),
    ).toBeNull();
    expect(
      referencedNoteId({
        kind: "update-settings",
        notePath: "x",
        patch: {},
        baselineUpdatedAt: null,
      }),
    ).toBeNull();
  });
});

describe("collectProtectedIds", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => db.close());

  it("is empty with no pending rows", async () => {
    expect((await collectProtectedIds(db, "v1")).size).toBe(0);
  });

  it("collects the id every pending mutation references", async () => {
    await enqueue(db, { kind: "update-note", targetId: "srv-1", payload: {} }, { vaultId: "v1" });
    await enqueue(db, { kind: "delete-note", targetId: "srv-2" }, { vaultId: "v1" });
    const ids = await collectProtectedIds(db, "v1");
    expect(ids.has("srv-1")).toBe(true);
    expect(ids.has("srv-2")).toBe(true);
  });

  it("protects BOTH ends of a local id that has drained to a server id", async () => {
    // A pending update still names the local id; the create already drained, so
    // the mirror row now lives under the server id. Both must be protected.
    await enqueue(db, { kind: "update-note", targetId: "local-x", payload: {} }, { vaultId: "v1" });
    await recordIdMap(db, "local-x", "srv-real", "v1");
    const ids = await collectProtectedIds(db, "v1");
    expect(ids.has("local-x")).toBe(true);
    expect(ids.has("srv-real")).toBe(true);
  });

  it("scopes to the vault (another vault's pending rows don't leak)", async () => {
    await enqueue(db, { kind: "delete-note", targetId: "srv-other" }, { vaultId: "v2" });
    expect((await collectProtectedIds(db, "v1")).has("srv-other")).toBe(false);
  });
});

describe("diffMirror", () => {
  const never = () => false;

  it("prunes mirror-has / server-lacks rows that are not protected", () => {
    const diff = diffMirror(
      [
        { id: "keep", updatedAt: "t" },
        { id: "gone", updatedAt: "t" },
      ],
      new Map([["keep", "t"]]),
      never,
    );
    expect(diff.toDelete).toEqual(["gone"]);
    expect(diff.toBackfill).toEqual([]);
    expect(diff.toRefetch).toEqual([]);
  });

  it("NEVER prunes a protected id even when server lacks it", () => {
    const diff = diffMirror(
      [{ id: "srv-pending", updatedAt: "t" }],
      new Map([["srv-elsewhere", "t"]]),
      (id) => id === "srv-pending",
    );
    expect(diff.toDelete).toEqual([]);
  });

  it("flags server-has / mirror-lacks as backfill", () => {
    const diff = diffMirror(
      [{ id: "have", updatedAt: "t" }],
      new Map([
        ["have", "t"],
        ["missing", "t"],
      ]),
      never,
    );
    expect(diff.toBackfill).toEqual(["missing"]);
    expect(diff.toDelete).toEqual([]);
  });

  it("flags a row whose server updatedAt is newer as refetch (not equal)", () => {
    const diff = diffMirror(
      [
        { id: "stale", updatedAt: "2026-07-20T00:00:00Z" },
        { id: "current", updatedAt: "2026-07-20T05:00:00Z" },
      ],
      new Map([
        ["stale", "2026-07-20T09:00:00Z"],
        ["current", "2026-07-20T05:00:00Z"],
      ]),
      never,
    );
    expect(diff.toRefetch).toEqual(["stale"]);
  });

  it("refetches a mirror row missing updatedAt (can't prove it's current)", () => {
    const diff = diffMirror([{ id: "x" }], new Map([["x", "t"]]), never);
    expect(diff.toRefetch).toEqual(["x"]);
  });
});

describe("makeIsProtected", () => {
  it("protects local ids and pending-set ids, nothing else", () => {
    const isProtected = makeIsProtected(new Set(["srv-pending"]));
    expect(isProtected("local-anything")).toBe(true);
    expect(isProtected("srv-pending")).toBe(true);
    expect(isProtected("srv-ordinary")).toBe(false);
  });
});
