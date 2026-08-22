import { type LensDB, openLensDB } from "@/lib/sync/db";
import { recordIdMap } from "@/lib/sync/id-map";
import type { Note } from "@/lib/vault/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readNote, readNotesList } from "./read";
import { setMirrorLastSyncedAt, upsertMirrorNote, upsertMirrorNotes } from "./store";

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
}

// Mark a vault's initial cold hydration as COMPLETE (the persisted `lastSyncedAt`
// watermark the completeness gate reads). The faithful-evaluator tests below all
// assert over a COMPLETE mirror, so they mark hydration done in `beforeEach`; the
// dedicated "completeness gate" block leaves it unset to exercise the gate.
async function markHydrated(db: LensDB, vaultId: string): Promise<void> {
  await setMirrorLastSyncedAt(db, vaultId, Date.now());
}

function note(id: string, over: Partial<Note> = {}): Note {
  return {
    id,
    path: `Inbox/${id}`,
    createdAt: "2026-07-20T00:00:00Z",
    updatedAt: "2026-07-20T01:00:00Z",
    content: `# ${id}`,
    ...over,
  };
}

function params(obj: Record<string, string>): URLSearchParams {
  return new URLSearchParams(obj);
}

describe("readNotesList — faithful evaluator over the mirror", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
    // These tests assert the SHAPE of a complete mirror's answer, so the vault
    // under test (`v1`) is marked hydrated. `v2` (the scoping test) is read-only
    // via `v1`, so it needs no watermark.
    await markHydrated(db, "v1");
  });
  afterEach(() => {
    db.close();
  });

  it("returns null (network-only) for a `search` query — FTS isn't reproducible", async () => {
    await upsertMirrorNote(db, "v1", note("n1"));
    expect(await readNotesList(db, "v1", params({ search: "hello", sort: "desc" }))).toBeNull();
  });

  it("returns null for any param outside the faithful subset (e.g. expand)", async () => {
    await upsertMirrorNote(db, "v1", note("n1"));
    expect(await readNotesList(db, "v1", params({ expand: "subtypes" }))).toBeNull();
    expect(await readNotesList(db, "v1", params({ order_by: "updated_at" }))).toBeNull();
  });

  it("reproduces exclude_tag and bracket date filters offline", async () => {
    await upsertMirrorNotes(db, "v1", [
      note("old", {
        tags: ["active"],
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-08-10T12:00:00Z",
      }),
      note("archived", {
        tags: ["archived"],
        createdAt: "2026-08-09T00:00:00Z",
        updatedAt: "2026-08-11T12:00:00Z",
      }),
      note("stale", {
        tags: ["active"],
        createdAt: "2026-08-08T00:00:00Z",
        updatedAt: "2026-07-20T12:00:00Z",
      }),
    ]);
    const rows = await readNotesList(
      db,
      "v1",
      params({
        "meta[updated_at][gte]": "2026-08-01T00:00:00Z",
        "meta[updated_at][lt]": "2026-09-01T00:00:00Z",
        exclude_tag: "archived",
        sort: "desc",
        limit: "5000",
      }),
    );
    expect(rows?.map((row) => row.id)).toEqual(["old"]);
  });

  it("refuses malformed or cross-column bracket date filters", async () => {
    await upsertMirrorNote(db, "v1", note("n1"));
    expect(
      await readNotesList(db, "v1", params({ "meta[updated_at][gte]": "not-a-date" })),
    ).toBeNull();
    expect(
      await readNotesList(
        db,
        "v1",
        params({
          "meta[created_at][gte]": "2026-08-01T00:00:00Z",
          "meta[updated_at][lt]": "2026-09-01T00:00:00Z",
        }),
      ),
    ).toBeNull();
  });

  it("ignores include_content (shape-only) and serves the full row anyway", async () => {
    await upsertMirrorNote(db, "v1", note("n1", { content: "# body" }));
    const rows = await readNotesList(db, "v1", params({ include_content: "false", sort: "desc" }));
    expect(rows).not.toBeNull();
    expect(rows?.[0].content).toBe("# body");
  });

  it("sorts by created_at DESC with id as the same-timestamp tiebreaker (vault default path)", async () => {
    await upsertMirrorNotes(db, "v1", [
      note("b", { createdAt: "2026-07-10T00:00:00Z" }),
      note("a", { createdAt: "2026-07-20T00:00:00Z" }),
      // Two share a created_at → id DESC tiebreak means "y" before "x".
      note("x", { createdAt: "2026-07-15T00:00:00Z" }),
      note("y", { createdAt: "2026-07-15T00:00:00Z" }),
    ]);
    const rows = await readNotesList(db, "v1", params({ sort: "desc", limit: "50" }));
    expect(rows?.map((r) => r.id)).toEqual(["a", "y", "x", "b"]);
  });

  it("sorts created_at ASC with id ASC tiebreak when sort=asc (or absent)", async () => {
    await upsertMirrorNotes(db, "v1", [
      note("a", { createdAt: "2026-07-20T00:00:00Z" }),
      note("b", { createdAt: "2026-07-10T00:00:00Z" }),
      note("y", { createdAt: "2026-07-15T00:00:00Z" }),
      note("x", { createdAt: "2026-07-15T00:00:00Z" }),
    ]);
    expect(
      (await readNotesList(db, "v1", params({ sort: "asc", limit: "50" })))?.map((r) => r.id),
    ).toEqual(["b", "x", "y", "a"]);
    // sort absent → vault default is ASC.
    expect((await readNotesList(db, "v1", params({ limit: "50" })))?.map((r) => r.id)).toEqual([
      "b",
      "x",
      "y",
      "a",
    ]);
  });

  it("applies limit + offset over the sorted window", async () => {
    await upsertMirrorNotes(db, "v1", [
      note("a", { createdAt: "2026-07-20T00:00:00Z" }),
      note("b", { createdAt: "2026-07-19T00:00:00Z" }),
      note("c", { createdAt: "2026-07-18T00:00:00Z" }),
      note("d", { createdAt: "2026-07-17T00:00:00Z" }),
    ]);
    const page = await readNotesList(db, "v1", params({ sort: "desc", limit: "2", offset: "1" }));
    expect(page?.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("filters by a single tag (exact match)", async () => {
    await upsertMirrorNotes(db, "v1", [
      note("t1", { tags: ["#idea"], createdAt: "2026-07-20T00:00:00Z" }),
      note("t2", { tags: ["#other"], createdAt: "2026-07-19T00:00:00Z" }),
      note("t3", { tags: ["#idea", "#other"], createdAt: "2026-07-18T00:00:00Z" }),
    ]);
    const rows = await readNotesList(db, "v1", params({ tag: "#idea", sort: "desc", limit: "50" }));
    expect(rows?.map((r) => r.id)).toEqual(["t1", "t3"]);
  });

  it("multi-tag: default (any/OR) and tag_match=all (AND)", async () => {
    await upsertMirrorNotes(db, "v1", [
      note("both", { tags: ["#a", "#b"], createdAt: "2026-07-20T00:00:00Z" }),
      note("onlya", { tags: ["#a"], createdAt: "2026-07-19T00:00:00Z" }),
      note("onlyb", { tags: ["#b"], createdAt: "2026-07-18T00:00:00Z" }),
      note("none", { tags: ["#c"], createdAt: "2026-07-17T00:00:00Z" }),
    ]);
    // vault's default for >1 tag is ANY (OR).
    const anyRows = await readNotesList(
      db,
      "v1",
      params({ tag: "#a,#b", tag_match: "any", sort: "desc", limit: "50" }),
    );
    expect(anyRows?.map((r) => r.id)).toEqual(["both", "onlya", "onlyb"]);
    // AND: only the note carrying both.
    const allRows = await readNotesList(
      db,
      "v1",
      params({ tag: "#a,#b", tag_match: "all", sort: "desc", limit: "50" }),
    );
    expect(allRows?.map((r) => r.id)).toEqual(["both"]);
  });

  it("filters by path_prefix", async () => {
    await upsertMirrorNotes(db, "v1", [
      note("p1", { path: "Journal/2026/a", createdAt: "2026-07-20T00:00:00Z" }),
      note("p2", { path: "Journal/2026/b", createdAt: "2026-07-19T00:00:00Z" }),
      note("p3", { path: "Inbox/c", createdAt: "2026-07-18T00:00:00Z" }),
    ]);
    const rows = await readNotesList(
      db,
      "v1",
      params({ path_prefix: "Journal/2026", sort: "desc", limit: "50" }),
    );
    expect(rows?.map((r) => r.id)).toEqual(["p1", "p2"]);
  });

  it("filters by has_tags true/false", async () => {
    await upsertMirrorNotes(db, "v1", [
      note("tagged", { tags: ["#x"], createdAt: "2026-07-20T00:00:00Z" }),
      note("bare", { tags: [], createdAt: "2026-07-19T00:00:00Z" }),
      note("undef", { tags: undefined, createdAt: "2026-07-18T00:00:00Z" }),
    ]);
    expect(
      (await readNotesList(db, "v1", params({ has_tags: "true", sort: "desc", limit: "50" })))?.map(
        (r) => r.id,
      ),
    ).toEqual(["tagged"]);
    expect(
      (
        await readNotesList(db, "v1", params({ has_tags: "false", sort: "desc", limit: "50" }))
      )?.map((r) => r.id),
    ).toEqual(["bare", "undef"]);
  });

  it("filters by has_links true/false", async () => {
    await upsertMirrorNotes(db, "v1", [
      note("linked", {
        createdAt: "2026-07-20T00:00:00Z",
        links: [{ sourceId: "linked", targetId: "x", relationship: "rel" }],
      }),
      note("unlinked", { createdAt: "2026-07-19T00:00:00Z", links: [] }),
    ]);
    expect(
      (
        await readNotesList(db, "v1", params({ has_links: "true", sort: "desc", limit: "50" }))
      )?.map((r) => r.id),
    ).toEqual(["linked"]);
    expect(
      (
        await readNotesList(db, "v1", params({ has_links: "false", sort: "desc", limit: "50" }))
      )?.map((r) => r.id),
    ).toEqual(["unlinked"]);
  });

  it("scopes to the vault (composite key) — another vault's rows never leak", async () => {
    await upsertMirrorNote(db, "v1", note("mine"));
    await upsertMirrorNote(db, "v2", note("theirs"));
    const rows = await readNotesList(db, "v1", params({ sort: "desc", limit: "50" }));
    expect(rows?.map((r) => r.id)).toEqual(["mine"]);
  });
});

describe("readNotesList — completeness gate (never serve a mid-hydration partial)", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => {
    db.close();
  });

  it("returns null while the initial cold hydration is in flight (no lastSyncedAt), even with rows present", async () => {
    // Rows are streaming in via the updated_at-ordered cursor but the walk hasn't
    // finished — the mirror holds an arbitrary, shifting SUBSET. A list read here
    // must NOT present it as complete.
    await upsertMirrorNotes(db, "v1", [
      note("a", { createdAt: "2026-07-20T00:00:00Z" }),
      note("b", { createdAt: "2026-07-19T00:00:00Z" }),
    ]);
    expect(await readNotesList(db, "v1", params({ sort: "desc", limit: "50" }))).toBeNull();
  });

  it("serves the mirror once the initial hydration completes (lastSyncedAt set)", async () => {
    await upsertMirrorNotes(db, "v1", [
      note("a", { createdAt: "2026-07-20T00:00:00Z" }),
      note("b", { createdAt: "2026-07-19T00:00:00Z" }),
    ]);
    // Same data, now flagged complete → the gate opens.
    await markHydrated(db, "v1");
    const rows = await readNotesList(db, "v1", params({ sort: "desc", limit: "50" }));
    expect(rows?.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("gates per-vault: v1 hydrated serves, v2 mid-hydration returns null", async () => {
    await upsertMirrorNote(db, "v1", note("mine"));
    await upsertMirrorNote(db, "v2", note("theirs"));
    await markHydrated(db, "v1");
    expect(
      (await readNotesList(db, "v1", params({ sort: "desc", limit: "50" })))?.map((r) => r.id),
    ).toEqual(["mine"]);
    expect(await readNotesList(db, "v2", params({ sort: "desc", limit: "50" }))).toBeNull();
  });
});

describe("readNote — full row for the view, local-id aware", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => {
    db.close();
  });

  it("returns the FULL mirror row (content/links/attachments) for a server id", async () => {
    await upsertMirrorNote(db, "v1", note("srv-1", { content: "# full body" }));
    const row = await readNote(db, "v1", "srv-1");
    expect(row?.content).toBe("# full body");
  });

  it("returns undefined for a note that isn't mirrored", async () => {
    expect(await readNote(db, "v1", "missing")).toBeUndefined();
  });

  it("resolves a drained local id through the id-map to the server row", async () => {
    await upsertMirrorNote(db, "v1", note("srv-9", { content: "# server" }));
    await recordIdMap(db, "local-abc", "srv-9", "v1");
    const row = await readNote(db, "v1", "local-abc");
    expect(row?.id).toBe("srv-9");
    expect(row?.content).toBe("# server");
  });

  it("falls back to the optimistic local-id row when the local id hasn't drained", async () => {
    // The create path mirrors the optimistic local-id row before the drain
    // lands; opening it offline must still resolve to that row.
    await upsertMirrorNote(db, "v1", note("local-opt", { content: "# optimistic" }));
    const row = await readNote(db, "v1", "local-opt");
    expect(row?.id).toBe("local-opt");
    expect(row?.content).toBe("# optimistic");
  });
});
