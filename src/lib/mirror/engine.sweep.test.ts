import { type LensDB, openLensDB } from "@/lib/sync/db";
import { enqueue } from "@/lib/sync/queue";
import type { Note } from "@/lib/vault/types";
import type { SubscribeHandlers } from "@openparachute/surface-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MirrorClient, MirrorEngine } from "./engine";
import {
  getMirrorLastSweepAt,
  getMirrorNote,
  getMirrorTags,
  setMirrorLastSweepAt,
  upsertMirrorNote,
} from "./store";

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
}

type LeanRow = { id: string; updatedAt: string };
type Page = { items: unknown[]; nextCursor?: string };

async function seed(db: LensDB, id: string, updatedAt = "2026-07-20T00:00:00Z"): Promise<void> {
  await upsertMirrorNote(db, "v1", {
    id,
    createdAt: updatedAt,
    updatedAt,
    content: `# ${id}`,
  });
}

// A client whose enumeration walk returns `rows` as one page, then an empty
// page (the terminus). `over` layers on getNote / listTags / a custom cursor fn.
function sweepClient(rows: LeanRow[], over: Partial<MirrorClient> = {}): MirrorClient {
  return {
    queryNotesCursor: vi.fn(async (_params: unknown, cursor?: string): Promise<Page> => {
      if ((cursor ?? "") === "") return { items: rows, nextCursor: "e1" };
      return { items: [], nextCursor: "e1" };
    }),
    getNote: vi.fn(
      async (id: string): Promise<Note> => ({
        id,
        createdAt: "2026-07-20T00:00:00Z",
        updatedAt: "2026-07-20T09:00:00Z",
        content: `# fetched ${id}`,
      }),
    ),
    listTags: vi.fn(async () => [{ name: "#project", count: 3 }]),
    ...over,
  } as unknown as MirrorClient;
}

function engineFor(db: LensDB, client: MirrorClient): MirrorEngine {
  return new MirrorEngine({
    db,
    resolveContext: () => ({ client, vaultId: "v1" }),
    tickIntervalMs: 10 * 60_000,
    pageLimit: 50,
    sweepEnumLimit: 100,
  });
}

describe("MirrorEngine — reconcile sweep", () => {
  let db: LensDB;
  let restoreOnline: () => void;

  beforeEach(async () => {
    db = await freshDb();
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    restoreOnline = () => {
      if (desc) Object.defineProperty(navigator, "onLine", desc);
    };
  });
  afterEach(() => {
    restoreOnline();
    db.close();
  });

  it("deletes a server-deleted note from the mirror (mirror-has / server-lacks)", async () => {
    await seed(db, "srv-1");
    await seed(db, "srv-2");
    const engine = engineFor(db, sweepClient([{ id: "srv-1", updatedAt: "2026-07-20T00:00:00Z" }]));

    const result = await engine.reconcileSweep();

    expect(result.deleted).toBe(1);
    expect(result.enumerated).toBe(1);
    expect(await getMirrorNote(db, "v1", "srv-2")).toBeUndefined();
    expect(await getMirrorNote(db, "v1", "srv-1")).toBeDefined();
  });

  // SAFETY PROPERTY #1a — never prune an offline-created (local id) row.
  it("NEVER deletes a local-id row even though the server lacks it", async () => {
    await seed(db, "local-abc");
    await seed(db, "srv-1");
    const engine = engineFor(db, sweepClient([{ id: "srv-1", updatedAt: "2026-07-20T00:00:00Z" }]));

    const result = await engine.reconcileSweep();

    expect(result.deleted).toBe(0);
    expect(await getMirrorNote(db, "v1", "local-abc")).toBeDefined();
  });

  // SAFETY PROPERTY #1b — a stale mirror row that the server lacks BUT which has
  // a pending queue mutation must survive (deleting it would destroy the offline
  // edit's optimistic view). The exclusion must beat the prune.
  it("NEVER deletes a row with a pending mutation, even when server-absent", async () => {
    await seed(db, "srv-pending");
    await seed(db, "srv-keep");
    await enqueue(
      db,
      { kind: "update-note", targetId: "srv-pending", payload: { content: "# offline edit" } },
      { vaultId: "v1" },
    );
    // Server enumerates only srv-keep — srv-pending is absent server-side.
    const engine = engineFor(
      db,
      sweepClient([{ id: "srv-keep", updatedAt: "2026-07-20T00:00:00Z" }]),
    );

    const result = await engine.reconcileSweep();

    expect(result.deleted).toBe(0);
    expect(await getMirrorNote(db, "v1", "srv-pending")).toBeDefined();
    expect(await getMirrorNote(db, "v1", "srv-keep")).toBeDefined();
  });

  // SAFETY PROPERTY #2a — a FAILED lean walk must not mass-delete. An error mid
  // enumeration means we never saw the full server set, so absence proves nothing.
  it("ABORTS (deletes nothing) when the enumeration walk errors", async () => {
    await seed(db, "srv-1");
    await seed(db, "srv-2");
    const getNote = vi.fn(async () => null);
    const engine = engineFor(
      db,
      sweepClient([], {
        queryNotesCursor: vi.fn(async () => {
          throw new Error("enumeration exploded");
        }) as unknown as MirrorClient["queryNotesCursor"],
        getNote: getNote as unknown as MirrorClient["getNote"],
      }),
    );

    const result = await engine.reconcileSweep();

    expect(result.aborted).toBe("incomplete-enumeration");
    expect(result.deleted).toBe(0);
    expect(await getMirrorNote(db, "v1", "srv-1")).toBeDefined();
    expect(await getMirrorNote(db, "v1", "srv-2")).toBeDefined();
    expect(getNote).not.toHaveBeenCalled();
  });

  // SAFETY PROPERTY #2b — a cleanly-completed but EMPTY walk must not nuke a
  // populated mirror (negative-scan honesty: zero results ≠ everything deleted).
  it("ABORTS (deletes nothing) when the enumeration returns an empty set", async () => {
    await seed(db, "srv-1");
    const engine = engineFor(db, sweepClient([])); // first page empty → 0 ids

    const result = await engine.reconcileSweep();

    expect(result.aborted).toBe("empty-enumeration");
    expect(await getMirrorNote(db, "v1", "srv-1")).toBeDefined();
  });

  it("backfills a server-has / mirror-lacks note by fetching its full body", async () => {
    await seed(db, "srv-1");
    const client = sweepClient([
      { id: "srv-1", updatedAt: "2026-07-20T00:00:00Z" },
      { id: "srv-2", updatedAt: "2026-07-20T00:00:00Z" },
    ]);
    const engine = engineFor(db, client);

    const result = await engine.reconcileSweep();

    expect(result.backfilled).toBe(1);
    const row = await getMirrorNote(db, "v1", "srv-2");
    expect(row?.content).toBe("# fetched srv-2");
  });

  it("refetches a note whose server updatedAt is newer than the mirror row", async () => {
    await seed(db, "srv-1", "2026-07-20T00:00:00Z");
    const client = sweepClient([{ id: "srv-1", updatedAt: "2026-07-20T09:00:00Z" }]);
    const engine = engineFor(db, client);

    const result = await engine.reconcileSweep();

    expect(result.refetched).toBe(1);
    expect((await getMirrorNote(db, "v1", "srv-1"))?.content).toBe("# fetched srv-1");
  });

  // Wave-1 review follow-up (3a): a path rename → new id upserts the new-id row
  // but ORPHANS the old-id row; the sweep prunes it (server no longer has old id).
  it("prunes the orphaned old-id row after an id change", async () => {
    await seed(db, "old-id");
    await seed(db, "new-id");
    const engine = engineFor(
      db,
      sweepClient([{ id: "new-id", updatedAt: "2026-07-20T00:00:00Z" }]),
    );

    const result = await engine.reconcileSweep();

    expect(result.deleted).toBe(1);
    expect(await getMirrorNote(db, "v1", "old-id")).toBeUndefined();
    expect(await getMirrorNote(db, "v1", "new-id")).toBeDefined();
  });

  it("does NOT prune the orphaned old id if it still has a pending mutation", async () => {
    await seed(db, "old-id");
    await seed(db, "new-id");
    await enqueue(db, { kind: "update-note", targetId: "old-id", payload: {} }, { vaultId: "v1" });
    const engine = engineFor(
      db,
      sweepClient([{ id: "new-id", updatedAt: "2026-07-20T00:00:00Z" }]),
    );

    const result = await engine.reconcileSweep();

    expect(result.deleted).toBe(0);
    expect(await getMirrorNote(db, "v1", "old-id")).toBeDefined();
  });

  it("mirrors the vault tag list and stamps lastSweepAt on a clean sweep", async () => {
    await seed(db, "srv-1");
    const engine = engineFor(db, sweepClient([{ id: "srv-1", updatedAt: "2026-07-20T00:00:00Z" }]));

    await engine.reconcileSweep();

    expect(await getMirrorTags(db, "v1")).toEqual([{ name: "#project", count: 3 }]);
    expect(await getMirrorLastSweepAt(db, "v1")).toBeGreaterThan(0);
  });

  it("skips the sweep when there is no active vault context", async () => {
    const engine = new MirrorEngine({ db, resolveContext: () => null });
    expect((await engine.reconcileSweep()).aborted).toBe("no-context");
  });
});

describe("MirrorEngine — sweep triggering via syncOnce", () => {
  let db: LensDB;
  let restoreOnline: () => void;
  beforeEach(async () => {
    db = await freshDb();
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    restoreOnline = () => {
      if (desc) Object.defineProperty(navigator, "onLine", desc);
    };
  });
  afterEach(() => {
    restoreOnline();
    db.close();
  });

  it("runs a sweep after the FIRST successful drain (no prior lastSweepAt)", async () => {
    // Server has only srv-keep; the mirror also holds a stale srv-gone the drain
    // won't touch (the cursor never reports deletes) — the post-drain sweep does.
    await seed(db, "srv-gone");
    const client = sweepClient([{ id: "srv-keep", updatedAt: "2026-07-20T00:00:00Z" }]);
    const engine = engineFor(db, client);

    await engine.syncOnce();

    expect(await getMirrorNote(db, "v1", "srv-gone")).toBeUndefined();
    expect(await getMirrorLastSweepAt(db, "v1")).toBeGreaterThan(0);
  });

  it("does NOT re-sweep within the throttle window", async () => {
    await seed(db, "srv-gone");
    const enumerate = vi.fn(async (_p: unknown, cursor?: string): Promise<Page> => {
      if ((cursor ?? "") === "") return { items: [], nextCursor: "e1" };
      return { items: [], nextCursor: "e1" };
    });
    const client = sweepClient([], {
      queryNotesCursor: enumerate as unknown as MirrorClient["queryNotesCursor"],
    });
    // Fresh sweep watermark + a large interval → not due.
    await setMirrorLastSweepAt(db, "v1", Date.now());
    const engine = new MirrorEngine({
      db,
      resolveContext: () => ({ client, vaultId: "v1" }),
      tickIntervalMs: 10 * 60_000,
      sweepIntervalMs: 6 * 60 * 60 * 1000,
    });

    await engine.syncOnce();

    // The drain called the cursor; the sweep did NOT (would enumerate again).
    // Exactly the drain's calls (bootstrap "" → empty terminus) — one call.
    expect(enumerate).toHaveBeenCalledTimes(1);
    expect(await getMirrorNote(db, "v1", "srv-gone")).toBeDefined();
  });
});

describe("MirrorEngine — WS remove → mirror delete", () => {
  let db: LensDB;
  let restoreOnline: () => void;
  let captured: SubscribeHandlers | null;

  function wsClient(): MirrorClient {
    captured = null;
    return {
      // Empty drain + suppressed sweep keep the test focused on the WS path.
      queryNotesCursor: vi.fn(async (): Promise<Page> => ({ items: [], nextCursor: "" })),
      subscribe: vi.fn((_query: unknown, handlers: SubscribeHandlers) => {
        captured = handlers;
        return () => {};
      }),
    } as unknown as MirrorClient;
  }

  beforeEach(async () => {
    db = await freshDb();
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    restoreOnline = () => {
      if (desc) Object.defineProperty(navigator, "onLine", desc);
    };
  });
  afterEach(() => {
    restoreOnline();
    db.close();
  });

  it("deletes a synced note on a live remove, but spares local-id + pending rows", async () => {
    await seed(db, "srv-1");
    await seed(db, "local-x");
    await seed(db, "srv-pending");
    await enqueue(
      db,
      { kind: "update-note", targetId: "srv-pending", payload: {} },
      { vaultId: "v1" },
    );
    // Suppress the post-drain sweep so only the WS path acts.
    await setMirrorLastSweepAt(db, "v1", Date.now());

    const client = wsClient();
    const engine = new MirrorEngine({
      db,
      resolveContext: () => ({ client, vaultId: "v1" }),
      tickIntervalMs: 10 * 60_000,
      sweepIntervalMs: 6 * 60 * 60 * 1000,
    });
    await engine.syncOnce(); // opens the subscription
    expect(captured).not.toBeNull();

    // The engine's onRemove returns the prune promise (statically typed `void`);
    // await the real thing so the assertion sees the settled write.
    const fireRemove = (id: string): Promise<void> =>
      captured?.onRemove(id) as unknown as Promise<void>;

    // A synced note removed on the server → pruned from the mirror.
    await fireRemove("srv-1");
    expect(await getMirrorNote(db, "v1", "srv-1")).toBeUndefined();

    // A local-only note id and a note with a pending mutation both survive.
    await fireRemove("local-x");
    await fireRemove("srv-pending");
    expect(await getMirrorNote(db, "v1", "local-x")).toBeDefined();
    expect(await getMirrorNote(db, "v1", "srv-pending")).toBeDefined();

    engine.stop();
  });
});

describe("MirrorEngine — no-advance cursor guard", () => {
  let db: LensDB;
  let restoreOnline: () => void;
  beforeEach(async () => {
    db = await freshDb();
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    restoreOnline = () => {
      if (desc) Object.defineProperty(navigator, "onLine", desc);
    };
  });
  afterEach(() => {
    restoreOnline();
    db.close();
  });

  it("breaks the drain when a non-empty page's cursor does not advance", async () => {
    // Contract violation: a non-empty page returns the SAME cursor it was sent.
    // Without the guard this loops forever; with it the page applies once + stops.
    const query = vi.fn(async (_p: unknown, cursor?: string): Promise<Page> => {
      const c = cursor ?? "";
      return {
        items: [{ id: "stuck", updatedAt: "2026-07-20T00:00:00Z", content: "x" }],
        nextCursor: c,
      };
    });
    const client = { queryNotesCursor: query } as unknown as MirrorClient;
    // Suppress the sweep so it doesn't also spin on the same mock.
    await setMirrorLastSweepAt(db, "v1", Date.now());
    const engine = new MirrorEngine({
      db,
      resolveContext: () => ({ client, vaultId: "v1" }),
      tickIntervalMs: 10 * 60_000,
      sweepIntervalMs: 6 * 60 * 60 * 1000,
    });

    const result = await engine.syncOnce();

    expect(result.notesApplied).toBe(1);
    expect(query).toHaveBeenCalledTimes(1); // did not spin
    expect(await getMirrorNote(db, "v1", "stuck")).toBeDefined();
  });
});
