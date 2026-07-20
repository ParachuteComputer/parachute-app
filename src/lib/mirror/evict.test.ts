import { type LensDB, openLensDB } from "@/lib/sync/db";
import { newLocalId } from "@/lib/sync/id-map";
import { enqueue } from "@/lib/sync/queue";
import type { MirrorNoteRow } from "@/lib/sync/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  derivePreview,
  evictOverCeiling,
  evictedShell,
  measureMirrorBytes,
  mirrorRowBytes,
  planEviction,
} from "./evict";
import { clearMirrorForVault, getMirrorNote, upsertMirrorNote } from "./store";

const VAULT = "v1";

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
}

// A row with a definite body + byteSize so the ceiling math is deterministic.
function row(id: string, updatedAt: string, over: Partial<MirrorNoteRow> = {}): MirrorNoteRow {
  return {
    id,
    vaultId: VAULT,
    path: `Inbox/${id}`,
    createdAt: updatedAt,
    updatedAt,
    content: `# ${id}\n\nbody of ${id}`,
    byteSize: 100,
    ...over,
  };
}

async function seed(db: LensDB, r: MirrorNoteRow): Promise<void> {
  await upsertMirrorNote(db, VAULT, r);
}

describe("mirrorRowBytes", () => {
  it("prefers the vault's byteSize for a full row", () => {
    expect(mirrorRowBytes(row("a", "2026-07-20T00:00:00Z", { byteSize: 4242 }))).toBe(4242);
  });

  it("estimates from content when byteSize is absent", () => {
    const r = row("a", "2026-07-20T00:00:00Z", { byteSize: undefined, content: "abcde" });
    expect(mirrorRowBytes(r)).toBe(5);
  });

  it("counts an already-evicted row as zero (its body is gone)", () => {
    const r = row("a", "2026-07-20T00:00:00Z", { contentEvicted: true, byteSize: 999 });
    expect(mirrorRowBytes(r)).toBe(0);
  });
});

describe("evictedShell", () => {
  it("drops body fields, sets contentEvicted, and snapshots preview + title", () => {
    const r = row("a", "2026-07-20T00:00:00Z", {
      content: "# Groceries\n\nmilk and eggs",
      links: [{ sourceId: "a", targetId: "b", relationship: "link" }],
      attachments: [{ id: "att1" }],
    });
    const shell = evictedShell(r);
    expect(shell.contentEvicted).toBe(true);
    expect(shell.content).toBeUndefined();
    expect(shell.links).toBeUndefined();
    expect(shell.attachments).toBeUndefined();
    // Stays listable: title + preview retained.
    expect(shell.displayTitle).toBe("Groceries");
    expect(shell.preview).toBe("milk and eggs");
    // Index identity preserved.
    expect(shell.id).toBe("a");
    expect(shell.path).toBe("Inbox/a");
  });
});

describe("derivePreview", () => {
  it("strips the leading title and truncates", () => {
    expect(derivePreview("# Title\n\nthe body text")).toBe("the body text");
    expect(derivePreview("")).toBeUndefined();
    expect(derivePreview(undefined)).toBeUndefined();
    const long = `# T\n\n${"x".repeat(500)}`;
    expect(derivePreview(long)?.endsWith("…")).toBe(true);
  });
});

describe("planEviction (pure)", () => {
  const never = () => false;

  it("is a no-op under the ceiling", () => {
    const rows = [row("a", "2026-07-20T00:00:00Z"), row("b", "2026-07-20T01:00:00Z")];
    const plan = planEviction(rows, 1000, never);
    expect(plan.toEvict).toEqual([]);
    expect(plan.totalAfter).toBe(200);
  });

  it("evicts OLDEST updatedAt first, stopping once under the ceiling", () => {
    // Three 100-byte rows, ceiling 150 → must free 150 (evict 2 oldest).
    const rows = [
      row("old", "2026-07-20T00:00:00Z"),
      row("mid", "2026-07-20T01:00:00Z"),
      row("new", "2026-07-20T02:00:00Z"),
    ];
    const plan = planEviction(rows, 150, never);
    expect(plan.toEvict.map((r) => r.id)).toEqual(["old", "mid"]);
    expect(plan.totalAfter).toBe(100);
    expect(plan.freedBytes).toBe(200);
  });

  it("NEVER evicts a protected row, even though it is the oldest", () => {
    const rows = [
      row("srv-pending", "2026-07-20T00:00:00Z"),
      row("srv-new", "2026-07-20T02:00:00Z"),
    ];
    const isProtected = (id: string) => id === "srv-pending";
    const plan = planEviction(rows, 50, isProtected);
    // Only the unprotected row is evictable; the protected one is spared even
    // though we stay over the ceiling.
    expect(plan.toEvict.map((r) => r.id)).toEqual(["srv-new"]);
  });

  it("skips already-evicted and bodyless rows", () => {
    const rows = [
      row("gone", "2026-07-20T00:00:00Z", { contentEvicted: true }),
      row("empty", "2026-07-20T00:30:00Z", { content: undefined, byteSize: 0 }),
      row("real", "2026-07-20T01:00:00Z"),
    ];
    const plan = planEviction(rows, 0, never);
    expect(plan.toEvict.map((r) => r.id)).toEqual(["real"]);
  });
});

describe("evictOverCeiling (db)", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => db.close());

  it("keeps the index row + sets contentEvicted, oldest-updatedAt first", async () => {
    await seed(db, row("old", "2026-07-20T00:00:00Z"));
    await seed(db, row("mid", "2026-07-20T01:00:00Z"));
    await seed(db, row("new", "2026-07-20T02:00:00Z"));

    const res = await evictOverCeiling(db, VAULT, 150);
    expect(res.evicted).toBe(2);

    const old = await getMirrorNote(db, VAULT, "old");
    const neu = await getMirrorNote(db, VAULT, "new");
    // Index rows survive; the oldest lost its body, the newest kept it.
    expect(old).toBeDefined();
    expect(old?.contentEvicted).toBe(true);
    expect(old?.content).toBeUndefined();
    expect(old?.preview).toBeDefined();
    expect(neu?.contentEvicted).toBeFalsy();
    expect(neu?.content).toContain("body of new");
  });

  // SACRED-WORK GUARD — the property that matters most: eviction never drops
  // un-synced work. A bare local-id row and a row with a pending queue mutation
  // both survive with their bodies intact, even when they are the oldest and we
  // stay over the ceiling because of it.
  it("NEVER evicts a local-id row or a row with a pending mutation", async () => {
    const localId = newLocalId();
    await seed(db, row(localId, "2026-07-20T00:00:00Z")); // oldest, local
    await seed(db, row("srv-pending", "2026-07-20T00:30:00Z"));
    await seed(db, row("srv-plain", "2026-07-20T02:00:00Z"));
    await enqueue(
      db,
      { kind: "update-note", targetId: "srv-pending", payload: { content: "# edit" } },
      { vaultId: VAULT },
    );

    // Ceiling below the protected rows' combined size → eviction can only touch
    // srv-plain, and must leave the two protected rows fully intact.
    await evictOverCeiling(db, VAULT, 50);

    const local = await getMirrorNote(db, VAULT, localId);
    const pending = await getMirrorNote(db, VAULT, "srv-pending");
    const plain = await getMirrorNote(db, VAULT, "srv-plain");
    expect(local?.contentEvicted).toBeFalsy();
    expect(local?.content).toBeDefined();
    expect(pending?.contentEvicted).toBeFalsy();
    expect(pending?.content).toBeDefined();
    expect(plain?.contentEvicted).toBe(true);
  });

  it("is a no-op under the ceiling", async () => {
    await seed(db, row("a", "2026-07-20T00:00:00Z"));
    const res = await evictOverCeiling(db, VAULT, 1_000_000);
    expect(res.evicted).toBe(0);
    expect((await getMirrorNote(db, VAULT, "a"))?.content).toBeDefined();
  });

  it("measureMirrorBytes sums the vault's row footprint", async () => {
    await seed(db, row("a", "2026-07-20T00:00:00Z", { byteSize: 100 }));
    await seed(db, row("b", "2026-07-20T01:00:00Z", { byteSize: 250 }));
    expect(await measureMirrorBytes(db, VAULT)).toBe(350);
  });

  // "Clear offline copy" (Settings) is `clearMirrorForVault` — it wipes the
  // mirror rows but MUST leave the write queue (un-synced user work) untouched,
  // mirroring Wave 1's preserve-queue property.
  it("clearing the mirror leaves the write queue intact", async () => {
    await seed(db, row("srv-1", "2026-07-20T00:00:00Z"));
    await enqueue(
      db,
      { kind: "update-note", targetId: "srv-1", payload: { content: "# offline edit" } },
      { vaultId: VAULT },
    );

    const removed = await clearMirrorForVault(db, VAULT);

    expect(removed).toBe(1);
    expect(await getMirrorNote(db, VAULT, "srv-1")).toBeUndefined();
    // The pending write survives the clear.
    const pending = await db.getAllFromIndex("pending", "by-vault", VAULT);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.mutation.kind).toBe("update-note");
  });
});
