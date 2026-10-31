import { useVaultStore } from "@/lib/vault/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type DraftBody,
  bodyEquals,
  clearDraft,
  clearSavedDraft,
  clearVaultDrafts,
  draftKey,
  loadDraft,
  saveDraft,
} from "./store";

const body = (over: Partial<DraftBody> = {}): DraftBody => ({
  content: "hello",
  path: "Notes/one",
  tags: ["a", "b"],
  ...over,
});

describe("draft store", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("keys per vault and scope", () => {
    expect(draftKey("v1", "new")).toBe("notes:draft:v1:new");
    expect(draftKey("v2", "note-9")).toBe("notes:draft:v2:note-9");
  });

  it("round-trips a body with a savedAt stamp", () => {
    saveDraft("v1", "new", body());
    const loaded = loadDraft("v1", "new");
    expect(loaded?.body).toEqual(body());
    expect(typeof loaded?.savedAt).toBe("string");
    expect(Number.isNaN(Date.parse(loaded?.savedAt ?? ""))).toBe(false);
  });

  it("returns null when nothing is stored", () => {
    expect(loadDraft("v1", "new")).toBeNull();
  });

  it("isolates drafts per vault and per scope", () => {
    saveDraft("v1", "new", body({ content: "v1-new" }));
    saveDraft("v1", "note-1", body({ content: "v1-note" }));
    expect(loadDraft("v2", "new")).toBeNull();
    expect(loadDraft("v1", "note-1")?.body.content).toBe("v1-note");
    expect(loadDraft("v1", "new")?.body.content).toBe("v1-new");
  });

  it("clears a draft", () => {
    saveDraft("v1", "new", body());
    clearDraft("v1", "new");
    expect(loadDraft("v1", "new")).toBeNull();
  });

  it("clearVaultDrafts removes every scope for a vault, leaving others intact", () => {
    saveDraft("v1", "new", body({ content: "a" }));
    saveDraft("v1", "note-7", body({ content: "b" }));
    saveDraft("v2", "new", body({ content: "keep" }));
    clearVaultDrafts("v1");
    expect(loadDraft("v1", "new")).toBeNull();
    expect(loadDraft("v1", "note-7")).toBeNull();
    expect(loadDraft("v2", "new")?.body.content).toBe("keep");
  });

  it("removeVault() clears that vault's drafts (disconnect leaves no plaintext)", () => {
    useVaultStore.setState({
      vaults: {
        gone: {
          id: "gone",
          url: "http://localhost:1940",
          name: "gone",
          issuer: "http://localhost:1940",
          clientId: "c",
          scope: "full",
          addedAt: "2026-07-01T00:00:00.000Z",
          lastUsedAt: "2026-07-01T00:00:00.000Z",
        },
      },
      activeVaultId: "gone",
    });
    saveDraft("gone", "new", body({ content: "secret" }));
    saveDraft("gone", "note-1", body({ content: "more secret" }));
    useVaultStore.getState().removeVault("gone");
    expect(loadDraft("gone", "new")).toBeNull();
    expect(loadDraft("gone", "note-1")).toBeNull();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("clearSavedDraft drops what the save consumed and keeps newer work", () => {
    const store = (b: DraftBody, savedAt: string) =>
      localStorage.setItem(draftKey("v1", "new"), JSON.stringify({ body: b, savedAt }));
    const startedAt = "2026-10-30T12:00:00.000Z";

    // Written before the save was sent (an older prefix of the note): consumed.
    store(body({ content: "hel" }), "2026-10-30T11:59:59.000Z");
    clearSavedDraft("v1", "new", body(), startedAt);
    expect(loadDraft("v1", "new")).toBeNull();

    // Written after, but it IS the saved text (an unmount flush): consumed.
    store(body(), "2026-10-30T12:00:01.000Z");
    clearSavedDraft("v1", "new", body(), startedAt);
    expect(loadDraft("v1", "new")).toBeNull();

    // Written after with other text (the next note, begun on the other
    // surface while this save was in flight): kept.
    store(body({ content: "the next note" }), "2026-10-30T12:00:01.000Z");
    clearSavedDraft("v1", "new", body(), startedAt);
    expect(loadDraft("v1", "new")?.body.content).toBe("the next note");
  });

  it("survives a corrupt blob or a wrong-shape body", () => {
    localStorage.setItem(draftKey("v1", "new"), "{not json");
    expect(loadDraft("v1", "new")).toBeNull();
    localStorage.setItem(draftKey("v1", "new"), JSON.stringify({ body: { content: 5 } }));
    expect(loadDraft("v1", "new")).toBeNull();
  });

  describe("bodyEquals", () => {
    it("is true for identical bodies and tag-order-insensitive", () => {
      expect(bodyEquals(body(), body())).toBe(true);
      expect(bodyEquals(body({ tags: ["a", "b"] }), body({ tags: ["b", "a"] }))).toBe(true);
    });
    it("is false when content, path, or tag set differs", () => {
      expect(bodyEquals(body(), body({ content: "x" }))).toBe(false);
      expect(bodyEquals(body(), body({ path: "x" }))).toBe(false);
      expect(bodyEquals(body(), body({ tags: ["a"] }))).toBe(false);
    });
  });
});
