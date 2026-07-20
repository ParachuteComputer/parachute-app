import { type LensDB, openLensDB } from "@/lib/sync/db";
import type { Note } from "@/lib/vault/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MirrorClient, MirrorEngine } from "./engine";
import { getMirrorNote, setMirrorLastSweepAt, upsertMirrorNote } from "./store";
import type { MirrorPhase } from "./types";

const VAULT = "v1";

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
}

type Page = { items: unknown[]; nextCursor?: string };

// A client that returns `pages` in order (last one repeats as the terminus).
function pagedClient(pages: Page[]): MirrorClient {
  let call = 0;
  return {
    queryNotesCursor: vi.fn(async (): Promise<Page> => {
      const page = pages[Math.min(call, pages.length - 1)];
      call += 1;
      return page;
    }),
  } as unknown as MirrorClient;
}

function note(id: string, updatedAt: string): Note {
  return { id, createdAt: updatedAt, updatedAt, content: `# ${id}\n\nbody` };
}

describe("MirrorEngine — storage-ceiling eviction via syncOnce", () => {
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

  it("evicts the oldest bodies after a drain when over the ceiling", async () => {
    // Pre-seed an over-ceiling mirror; suppress the sweep so only eviction acts.
    await upsertMirrorNote(db, VAULT, {
      id: "old",
      createdAt: "2026-07-20T00:00:00Z",
      updatedAt: "2026-07-20T00:00:00Z",
      content: "# old\n\nbody",
      byteSize: 100,
    });
    await upsertMirrorNote(db, VAULT, {
      id: "new",
      createdAt: "2026-07-20T02:00:00Z",
      updatedAt: "2026-07-20T02:00:00Z",
      content: "# new\n\nbody",
      byteSize: 100,
    });
    await setMirrorLastSweepAt(db, VAULT, Date.now());

    const engine = new MirrorEngine({
      db,
      resolveContext: () => ({
        client: pagedClient([{ items: [], nextCursor: "c" }]),
        vaultId: VAULT,
      }),
      tickIntervalMs: 10 * 60_000,
      sweepIntervalMs: 6 * 60 * 60 * 1000,
      ceilingBytes: 150,
    });

    await engine.syncOnce();

    expect((await getMirrorNote(db, VAULT, "old"))?.contentEvicted).toBe(true);
    expect((await getMirrorNote(db, VAULT, "new"))?.contentEvicted).toBeFalsy();
  });

  it("evictIfOverCeiling is a no-op under the ceiling", async () => {
    await upsertMirrorNote(db, VAULT, {
      id: "a",
      createdAt: "2026-07-20T00:00:00Z",
      updatedAt: "2026-07-20T00:00:00Z",
      content: "# a\n\nbody",
      byteSize: 100,
    });
    const engine = new MirrorEngine({
      db,
      resolveContext: () => ({ client: pagedClient([{ items: [] }]), vaultId: VAULT }),
      ceilingBytes: 1_000_000,
    });
    const res = await engine.evictIfOverCeiling();
    expect(res.evicted).toBe(0);
    expect((await getMirrorNote(db, VAULT, "a"))?.content).toBeDefined();
  });
});

describe("MirrorEngine — mirror-state transitions (hydrating → synced)", () => {
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

  it("emits hydrating + progress on a COLD hydration, then synced (live)", async () => {
    const phases: MirrorPhase[] = [];
    const progress: number[] = [];
    // One page of two notes, then the empty terminus.
    const engine = new MirrorEngine({
      db,
      resolveContext: () => ({
        client: pagedClient([
          {
            items: [note("a", "2026-07-20T00:00:00Z"), note("b", "2026-07-20T01:00:00Z")],
            nextCursor: "c1",
          },
          { items: [], nextCursor: "c1" },
        ]),
        vaultId: VAULT,
      }),
      tickIntervalMs: 10 * 60_000,
      sweepIntervalMs: 6 * 60 * 60 * 1000,
      ceilingBytes: 1_000_000,
      onStateChange: (_v, state) => phases.push(state.phase),
      onProgress: (_v, done) => progress.push(done),
    });
    await setMirrorLastSweepAt(db, VAULT, Date.now()); // suppress sweep noise

    await engine.syncOnce();

    // Cold: hydrating announced first, synced (live) last.
    expect(phases[0]).toBe("hydrating");
    expect(phases[phases.length - 1]).toBe("live");
    // Progress ticked to the notes applied.
    expect(progress).toContain(0);
    expect(progress[progress.length - 1]).toBe(2);
  });

  it("does NOT re-announce hydrating on a WARM poll", async () => {
    const engineFor = (onStateChange: (v: string, s: { phase: MirrorPhase }) => void) =>
      new MirrorEngine({
        db,
        resolveContext: () => ({
          client: pagedClient([
            { items: [note("a", "2026-07-20T00:00:00Z")], nextCursor: "c1" },
            { items: [], nextCursor: "c1" },
          ]),
          vaultId: VAULT,
        }),
        tickIntervalMs: 10 * 60_000,
        sweepIntervalMs: 6 * 60 * 60 * 1000,
        ceilingBytes: 1_000_000,
        onStateChange,
      });

    // First (cold) run seeds the cursor + lastSyncedAt.
    await engineFor(() => {}).syncOnce();

    // Second (warm) run: lastSyncedAt now exists → no hydrating emit.
    const phases: MirrorPhase[] = [];
    await engineFor((_v, s) => phases.push(s.phase)).syncOnce();
    expect(phases).not.toContain("hydrating");
    expect(phases).toContain("live");
  });
});
