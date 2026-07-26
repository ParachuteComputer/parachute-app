/**
 * The bounded first-note probe (app#110 Finding B, piece 1).
 *
 * The load-bearing case is the second one: the app's own settings note
 * (`.parachute/notes/settings`) is NOT a `#guide` note and is recently
 * touched on exactly the vaults that aren't onboarded yet — so a naive
 * `limit=1` probe would take it as proof of onboarding. These tests pin the
 * page-walk: system rows never answer true, a short page answers false, and
 * a full page of nothing-but-system rows pages forward instead of guessing.
 */

import type { VaultClient } from "@/lib/vault";
import type { Note } from "@/lib/vault/types";
import { describe, expect, it, vi } from "vitest";
import { HAS_USER_NOTE_PAGE, probeHasUserAuthoredNote } from "./use-has-user-note";

const at = new Date(Date.UTC(2026, 6, 26)).toISOString();
const note = (id: string, path: string, tags: string[] = []): Note =>
  ({ id, path, preview: id, tags, createdAt: at, updatedAt: at }) as Note;

const settingsNote = note("sys", ".parachute/notes/settings");
const userNote = note("mine", "Journal/first.md");

/** Stub client answering `queryNotes` from a fixed page sequence. */
function clientOf(...pages: Note[][]) {
  const queryNotes = vi.fn(async (_params: URLSearchParams) => pages.shift() ?? []);
  return { client: { queryNotes } as unknown as VaultClient, queryNotes };
}

describe("probeHasUserAuthoredNote", () => {
  it("asks the server the tag half: exclude_tag=guide, bounded limit, newest first", async () => {
    const { client, queryNotes } = clientOf([userNote]);
    await probeHasUserAuthoredNote(client);
    const params = queryNotes.mock.calls[0]?.[0];
    if (!params) throw new Error("queryNotes was never called");
    expect(params.get("exclude_tag")).toBe("guide");
    expect(params.get("limit")).toBe(String(HAS_USER_NOTE_PAGE));
    expect(params.get("sort")).toBe("desc");
    expect(params.get("include_content")).toBe("false");
  });

  it("a fresh vault whose only non-guide note is the settings note answers FALSE (the limit=1 trap)", async () => {
    // This is the page a naive `limit=1` would have trusted: the settings
    // note is the most recent non-guide note on a vault the user never
    // wrote in. One short page, correctly filtered → false, one fetch.
    const { client, queryNotes } = clientOf([settingsNote]);
    await expect(probeHasUserAuthoredNote(client)).resolves.toBe(false);
    expect(queryNotes).toHaveBeenCalledTimes(1);
  });

  it("a user note behind the settings note answers TRUE on page 1", async () => {
    const { client, queryNotes } = clientOf([settingsNote, userNote]);
    await expect(probeHasUserAuthoredNote(client)).resolves.toBe(true);
    expect(queryNotes).toHaveBeenCalledTimes(1);
  });

  it("a FULL page of system rows pages forward with an offset instead of guessing", async () => {
    const systemPage = Array.from({ length: HAS_USER_NOTE_PAGE }, (_, i) =>
      note(`sys${i}`, `.parachute/rows/${i}`),
    );
    const { client, queryNotes } = clientOf(systemPage, [userNote]);
    await expect(probeHasUserAuthoredNote(client)).resolves.toBe(true);
    expect(queryNotes).toHaveBeenCalledTimes(2);
    const second = queryNotes.mock.calls[1]?.[0];
    if (!second) throw new Error("the walk never fetched a second page");
    expect(second.get("offset")).toBe(String(HAS_USER_NOTE_PAGE));
  });

  it("the walk ends FALSE when the pages run out", async () => {
    const systemPage = Array.from({ length: HAS_USER_NOTE_PAGE }, (_, i) =>
      note(`sys${i}`, `.parachute/rows/${i}`),
    );
    const { client, queryNotes } = clientOf(systemPage, []);
    await expect(probeHasUserAuthoredNote(client)).resolves.toBe(false);
    expect(queryNotes).toHaveBeenCalledTimes(2);
  });

  it("an empty vault (guides excluded server-side) answers FALSE", async () => {
    const { client } = clientOf([]);
    await expect(probeHasUserAuthoredNote(client)).resolves.toBe(false);
  });
});
