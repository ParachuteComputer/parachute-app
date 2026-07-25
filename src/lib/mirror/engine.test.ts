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
  setMirrorLastSweepAt,
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

    // Isolate the DRAIN's paging from the post-hydration reconcile sweep (which
    // would leanly re-walk the same cursor and pad `calls`): stamp a fresh sweep
    // watermark so `syncOnce` finds no sweep due. The sweep has its own tests.
    await setMirrorLastSweepAt(db, "v1", Date.now());
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

  it("commits the completeness watermark ONLY after the full drain — not after the first page", async () => {
    // The read-side completeness gate keys on `lastSyncedAt`. Observe the mirror's
    // readiness signals MID-drain: when the engine requests page 2, page 1 is
    // already upserted but the walk isn't done, so `lastSyncedAt` and the "live"
    // phase must NOT be set yet (the gate stays closed on a partial mirror). Only
    // the terminating empty page flips them.
    let midDrain: { lastSyncedAt: number | undefined; phase: string | undefined } | null = null;
    const { client, calls } = cursorClient(() => ({ items: [] }));
    client.queryNotesCursor = vi.fn(async (_p: unknown, cursor?: string): Promise<Page> => {
      const c = cursor ?? "";
      calls.push(c);
      if (c === "") return { items: [note("a")], nextCursor: "c1" };
      if (c === "c1") {
        // Page 1 has landed; capture the readiness signals before page 2 applies.
        midDrain = {
          lastSyncedAt: await getMirrorLastSyncedAt(db, "v1"),
          phase: (await getMirrorState(db, "v1"))?.phase,
        };
        return { items: [note("bb")], nextCursor: "c2" };
      }
      return { items: [], nextCursor: "c2" };
    }) as unknown as VaultClient["queryNotesCursor"];

    await setMirrorLastSweepAt(db, "v1", Date.now());
    const engine = engineFor(db, client);
    await engine.syncOnce();

    // Mid-drain: partial mirror, watermark absent, phase still hydrating.
    expect(midDrain).not.toBeNull();
    expect(midDrain!.lastSyncedAt).toBeUndefined();
    expect(midDrain!.phase).toBe("hydrating");
    // After the full walk: watermark committed + phase live → gate opens.
    expect(await getMirrorLastSyncedAt(db, "v1")).toBeGreaterThan(0);
    expect(await getMirrorState(db, "v1")).toEqual({ phase: "live" });
  });

  it("never persists the hydrating phase on a WARM poll — mid-drain the stored state stays live", async () => {
    // The every-open "Saving your vault for offline" regression: the provider
    // re-reads the PERSISTED phase on each app open, so a warm catch-up poll
    // that stamps "hydrating" into IDB repaints the one-time hydration banner
    // on every launch of an already-synced vault (and a poll killed mid-drain
    // strands "hydrating" there until the next completed drain). Warm drains
    // must leave the stored "live" phase untouched for their whole duration.
    await setMirrorLastSweepAt(db, "v1", Date.now());
    const { client } = cursorClient((cursor) => {
      if (cursor === "") return { items: [note("a")], nextCursor: "c1" };
      return { items: [], nextCursor: "c1" };
    });
    await engineFor(db, client).syncOnce(); // cold run → persisted phase "live"

    const phasesSeenMidDrain: Array<string | undefined> = [];
    const warmClient = {
      queryNotesCursor: vi.fn(async (): Promise<Page> => {
        phasesSeenMidDrain.push((await getMirrorState(db, "v1"))?.phase);
        return { items: [], nextCursor: "c1" };
      }),
    } as unknown as Pick<VaultClient, "queryNotesCursor">;
    await engineFor(db, warmClient).syncOnce();

    expect(phasesSeenMidDrain.length).toBeGreaterThan(0);
    expect(phasesSeenMidDrain).not.toContain("hydrating");
    expect(await getMirrorState(db, "v1")).toEqual({ phase: "live" });
  });

  it("treats a RESUMED interrupted first fill (cursor present, no watermark) as cold — announces hydrating", async () => {
    // A first fill killed mid-walk left a cursor but no completion watermark.
    // The mirror is still incomplete, so the resume IS the first hydration
    // continuing: persist + announce "hydrating" and tick progress.
    await setMirrorCursor(db, "v1", "resume-here");
    await setMirrorLastSweepAt(db, "v1", Date.now());
    const { client } = cursorClient((cursor) => {
      if (cursor === "resume-here") return { items: [note("z")], nextCursor: "next" };
      return { items: [], nextCursor: "next" };
    });
    const phases: string[] = [];
    const progress: number[] = [];
    const engine = new MirrorEngine({
      db,
      resolveContext: () => ({ client, vaultId: "v1" }),
      tickIntervalMs: 10 * 60_000,
      pageLimit: 50,
      onStateChange: (_v, s) => phases.push(s.phase),
      onProgress: (_v, done) => progress.push(done),
    });
    await engine.syncOnce();

    expect(phases[0]).toBe("hydrating");
    expect(phases[phases.length - 1]).toBe("live");
    expect(progress).toContain(0);
    expect(progress).toContain(1);
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

  it("ERRORS (does not loop) on a 0.3.5-shaped page — full rows, no next_cursor", async () => {
    // The runaway Aaron hit live: surface-client 0.3.5 read next_cursor only from
    // an `X-Next-Cursor` header the self-host daemon never sends, so EVERY page
    // came back as the same first rows with `nextCursor: undefined`. Before the
    // guard the drain looped forever (+200 notes/round-trip → the 33k). Now a
    // non-empty page with no next_cursor is a hard contract violation → error
    // state, no watermark, and the walk is BOUNDED (called once, not spinning).
    let calls = 0;
    const client = {
      queryNotesCursor: vi.fn(async (): Promise<Page> => {
        calls += 1;
        // Safety net: if the guard regresses and the drain spins, fail FAST with a
        // clear message instead of hanging the suite until the vitest timeout.
        if (calls > 20) throw new Error("drain spun — no-next_cursor guard regressed");
        // 0.3.5 shape: a full page, NO nextCursor key (identical every call).
        return { items: [note("a"), note("bb")] };
      }),
    } as unknown as Pick<VaultClient, "queryNotesCursor">;

    const engine = engineFor(db, client);
    const result = await engine.syncOnce();

    // Bounded, not infinite — the drain threw on the first offending page.
    expect(client.queryNotesCursor).toHaveBeenCalledTimes(1);
    expect(result.error).toMatch(/next_cursor|contract/i);
    expect(await getMirrorState(db, "v1")).toMatchObject({ phase: "error" });
    // Crucially the completion watermark is NOT stamped, so the mirror stays
    // COLD and re-hydrates once a fixed client (0.3.6) is in place.
    expect(await getMirrorLastSyncedAt(db, "v1")).toBeUndefined();
  });

  it("caps a pathological ever-advancing walk instead of running forever", async () => {
    // Belt-and-suspenders: a daemon that keeps handing back a NEW cursor + rows
    // and never exhausts would still be an infinite walk. The hard page cap turns
    // it into a bounded error rather than a hang. Distinct from the no-advance +
    // no-next_cursor guards (both of which fire far sooner in practice).
    let n = 0;
    const client = {
      queryNotesCursor: vi.fn(async (): Promise<Page> => {
        n += 1;
        // Always non-empty, always a fresh advancing cursor → never terminates.
        return { items: [note("x")], nextCursor: `c${n}` };
      }),
    } as unknown as Pick<VaultClient, "queryNotesCursor">;

    // Small cap so the test trips it cheaply (prod default is MAX_DRAIN_PAGES).
    const engine = new MirrorEngine({
      db,
      resolveContext: () => ({ client, vaultId: "v1" }),
      tickIntervalMs: 10 * 60_000,
      pageLimit: 50,
      maxDrainPages: 5,
    });
    const result = await engine.syncOnce();

    expect(result.error).toMatch(/exceeded .* pages/i);
    expect(await getMirrorState(db, "v1")).toMatchObject({ phase: "error" });
    expect(await getMirrorLastSyncedAt(db, "v1")).toBeUndefined();
    // Bounded by the cap — not the 33k+ of the live runaway.
    expect((client.queryNotesCursor as ReturnType<typeof vi.fn>).mock.calls.length).toBe(5);
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
