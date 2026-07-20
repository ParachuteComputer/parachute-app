import { type LensDB, openLensDB } from "@/lib/sync/db";
import type { VaultClient } from "@/lib/vault/client";
import type { Note } from "@/lib/vault/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MirrorEngine, isCursorRejection } from "./engine";
import {
  countMirrorNotes,
  getMirrorCursor,
  getMirrorLastSyncedAt,
  getMirrorNote,
  getMirrorState,
  setMirrorCursor,
} from "./store";

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
}

function note(id: string): Note {
  return {
    id,
    path: `Inbox/${id}`,
    createdAt: "2026-07-20T00:00:00Z",
    updatedAt: `2026-07-20T0${id.length}:00:00Z`,
    content: `# ${id}`,
  };
}

type Page = { items: Note[]; nextCursor?: string };

// A cursor client whose page responses come from a handler keyed on the cursor
// the engine sends. Records every cursor for order/resume assertions.
function cursorClient(handler: (cursor: string) => Page) {
  const calls: string[] = [];
  const client = {
    queryNotesCursor: vi.fn(async (_params: unknown, cursor?: string): Promise<Page> => {
      const c = cursor ?? "";
      calls.push(c);
      return handler(c);
    }),
  } as unknown as Pick<VaultClient, "queryNotesCursor">;
  return { client, calls };
}

function engineFor(
  db: LensDB,
  client: Pick<VaultClient, "queryNotesCursor">,
  vaultId = "v1",
): MirrorEngine {
  return new MirrorEngine({
    db,
    resolveContext: () => ({ client, vaultId }),
    // Large tick so the interval never fires mid-test; we call syncOnce directly.
    tickIntervalMs: 10 * 60_000,
    pageLimit: 50,
  });
}

describe("MirrorEngine — hydration loop", () => {
  let db: LensDB;
  let restoreOnline: () => void;

  beforeEach(async () => {
    db = await freshDb();
    // fake-indexeddb runs under jsdom where navigator.onLine defaults true, but
    // pin it so an environment default can't flip the drain to a skip.
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

  it("walks pages, upserts each, persists the cursor per page, and stops on an empty page", async () => {
    // The cursor the engine had PERSISTED at the moment it requested each page.
    // Proves the watermark is committed per page (before the next request), so
    // a killed app resumes exactly where it stopped.
    const persistedAtCall: Record<string, string | undefined> = {};
    const { client, calls } = cursorClient((cursor) => {
      if (cursor === "") return { items: [note("a"), note("bb")], nextCursor: "c1" };
      if (cursor === "c1") return { items: [note("ccc")], nextCursor: "c2" };
      return { items: [], nextCursor: "c2" }; // empty page → terminate
    });
    client.queryNotesCursor = vi.fn(async (_p: unknown, cursor?: string): Promise<Page> => {
      const c = cursor ?? "";
      calls.push(c);
      persistedAtCall[c] = await getMirrorCursor(db, "v1");
      if (c === "") return { items: [note("a"), note("bb")], nextCursor: "c1" };
      if (c === "c1") return { items: [note("ccc")], nextCursor: "c2" };
      return { items: [], nextCursor: "c2" };
    }) as unknown as VaultClient["queryNotesCursor"];

    const engine = engineFor(db, client);
    const result = await engine.syncOnce();

    expect(result.notesApplied).toBe(3);
    expect(result.pagesApplied).toBe(3);
    expect(calls).toEqual(["", "c1", "c2"]);
    // Bootstrap call saw no stored cursor; each later call saw the prior page's
    // watermark already persisted.
    expect(persistedAtCall[""]).toBeUndefined();
    expect(persistedAtCall.c1).toBe("c1");
    expect(persistedAtCall.c2).toBe("c2");
    expect(await countMirrorNotes(db, "v1")).toBe(3);
    expect(await getMirrorNote(db, "v1", "a")).toBeDefined();
    expect(await getMirrorNote(db, "v1", "ccc")).toBeDefined();
    // Final watermark persisted; sync state + timestamp recorded.
    expect(await getMirrorCursor(db, "v1")).toBe("c2");
    expect(await getMirrorState(db, "v1")).toEqual({ phase: "live" });
    expect(await getMirrorLastSyncedAt(db, "v1")).toBeGreaterThan(0);
  });

  it("resumes from the persisted cursor rather than re-walking from empty", async () => {
    await setMirrorCursor(db, "v1", "resume-here");
    const { client, calls } = cursorClient((cursor) => {
      if (cursor === "resume-here") return { items: [note("z")], nextCursor: "next" };
      return { items: [], nextCursor: "next" };
    });
    const engine = engineFor(db, client);
    await engine.syncOnce();
    expect(calls[0]).toBe("resume-here"); // did NOT start at ""
    expect(await getMirrorNote(db, "v1", "z")).toBeDefined();
  });

  it("drops a rejected cursor and re-walks from empty (idempotent recovery)", async () => {
    await setMirrorCursor(db, "v1", "stale-cursor");
    const { client, calls } = cursorClient((cursor) => {
      if (cursor === "stale-cursor") {
        throw new Error('GET /api/notes failed (400): {"error_type":"cursor_invalid"}');
      }
      if (cursor === "") return { items: [note("fresh")], nextCursor: "c1" };
      return { items: [], nextCursor: "c1" };
    });
    const engine = engineFor(db, client);
    const result = await engine.syncOnce();

    expect(result.reWalked).toBe(true);
    expect(calls[0]).toBe("stale-cursor");
    expect(calls[1]).toBe(""); // re-walk restarted from the bootstrap cursor
    expect(await getMirrorNote(db, "v1", "fresh")).toBeDefined();
    expect(await getMirrorCursor(db, "v1")).toBe("c1");
  });

  it("marks state error and reports the message on a non-cursor failure", async () => {
    const { client } = cursorClient(() => {
      throw new Error("network exploded");
    });
    const engine = engineFor(db, client);
    const result = await engine.syncOnce();
    expect(result.error).toContain("network exploded");
    expect(await getMirrorState(db, "v1")).toMatchObject({ phase: "error" });
  });
});

describe("MirrorEngine — guards", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => {
    db.close();
  });

  it("skips when offline", async () => {
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    try {
      const { client } = cursorClient(() => ({ items: [] }));
      const engine = engineFor(db, client);
      const result = await engine.syncOnce();
      expect(result.skipped).toBe("offline");
      expect(client.queryNotesCursor).not.toHaveBeenCalled();
    } finally {
      if (desc) Object.defineProperty(navigator, "onLine", desc);
    }
  });

  it("skips when there is no active vault context", async () => {
    const engine = new MirrorEngine({ db, resolveContext: () => null });
    const result = await engine.syncOnce();
    expect(result.skipped).toBe("no-context");
  });

  it("start() runs an immediate sync, then stop() tears down cleanly", async () => {
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    try {
      const { client } = cursorClient((cursor) =>
        cursor === "" ? { items: [note("k")], nextCursor: "c1" } : { items: [], nextCursor: "c1" },
      );
      const engine = engineFor(db, client);
      engine.start();
      await engine.lastRun;
      expect(await getMirrorNote(db, "v1", "k")).toBeDefined();
      engine.stop();
    } finally {
      if (desc) Object.defineProperty(navigator, "onLine", desc);
    }
  });
});

describe("isCursorRejection", () => {
  it("matches the structured cursor 400s and nothing else", () => {
    expect(isCursorRejection(new Error("... cursor_invalid ..."))).toBe(true);
    expect(isCursorRejection(new Error("... cursor_query_mismatch ..."))).toBe(true);
    expect(isCursorRejection(new Error("network exploded"))).toBe(false);
    expect(isCursorRejection("not an error")).toBe(false);
  });
});
