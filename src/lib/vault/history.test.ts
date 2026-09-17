import { describe, expect, it, vi } from "vitest";
import { VaultClient } from "./client";
import { type HistoryRow, historySelector, historyVersionPath } from "./history";

describe("history transport", () => {
  it("keeps imported and native indexes separate and encodes note IDs", () => {
    expect(historyVersionPath("a/b", { version_ix: 0 })).toBe("/api/notes/a%2Fb/versions/0");
    expect(historyVersionPath("a/b", { origin: "git-import", import_ix: 2 })).toBe(
      "/api/notes/a%2Fb/imports/2",
    );
    expect(() => historySelector({ version_ix: -1 } as HistoryRow)).toThrow();
    expect(() => historySelector({ origin: "git-import", import_ix: -1 } as HistoryRow)).toThrow();
  });
  it("sends the reviewed timestamp without a force override", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "note" }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const client = new VaultClient({
      vaultUrl: "https://example.test/vault/test",
      accessToken: "test",
      fetchImpl,
    });
    await client.restoreHistory("note", { origin: "git-import", import_ix: 2 }, "reviewed");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/vault/test/api/notes/note/restore");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      origin: "git-import",
      import_ix: 2,
      if_updated_at: "reviewed",
    });
  });
});
