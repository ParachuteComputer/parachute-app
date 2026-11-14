/**
 * The one gate in front of every request that carries the vault bearer for a
 * URL a note supplied, and in front of every note image the app draws. Unit
 * tests because the rules themselves are the point; each row is an input a
 * note can carry. Made-up hosts only.
 */
import { describe, expect, it } from "vitest";
import { noteMediaKind, vaultStorageTarget } from "./storage-url";

const VAULT = "https://hub.example/vault/default";
const PAGE = "https://hub.example/v/default/n/1";

describe("vaultStorageTarget", () => {
  it.each([
    [
      "/api/storage/2026-11-13/a.png",
      "https://hub.example/vault/default/api/storage/2026-11-13/a.png",
    ],
    ["api/storage/a.png", "https://hub.example/vault/default/api/storage/a.png"],
    [`${VAULT}/api/storage/a.png?v=1`, "https://hub.example/vault/default/api/storage/a.png?v=1"],
    [
      "https://HUB.example:443/vault/default/api/storage/a.png",
      "https://hub.example/vault/default/api/storage/a.png",
    ],
    // relative to an https page in a browser: the checked URL, not the raw string
    ["https:/vault/default/api/storage/x", "https://hub.example/vault/default/api/storage/x"],
    // a lone encoded dot is folded by the parser; the folded URL is what's fetched
    ["/api/storage/a/%2e/b.png", "https://hub.example/vault/default/api/storage/a/b.png"],
    // protocol-relative to this vault's own host is still this vault
    [
      "//hub.example/vault/default/api/storage/a.png",
      "https://hub.example/vault/default/api/storage/a.png",
    ],
    // an encoded slash in the query isn't part of the stored path
    [
      "/api/storage/a.png?next=%2Fx",
      "https://hub.example/vault/default/api/storage/a.png?next=%2Fx",
    ],
    ["/api/storage/my photo.png", "https://hub.example/vault/default/api/storage/my%20photo.png"],
  ])("accepts %s", (url, href) => {
    expect(vaultStorageTarget(VAULT, url, PAGE)?.href).toBe(href);
  });

  it.each([
    "https:evil.example/api/storage/x",
    "https://evil.example/vault/default/api/storage/x.png",
    "//evil.example/vault/default/api/storage/x.png",
    "https://hub.example@evil.example/vault/default/api/storage/x.png",
    "https://u:p@hub.example/vault/default/api/storage/x.png",
    "https://hub.example:8443/vault/default/api/storage/x.png",
    "http://hub.example/vault/default/api/storage/x.png",
    "https://hub.example/vault/other/api/storage/x.png",
    "https://hub.example/vault/default/api/storagex/x.png",
    "https://hub.example/vault/default/api/notes/x",
    "/api/storage/",
    "/api/storage/../notes/x",
    "/api/storage/%2e%2e/notes/x",
    "/api/storage/100%.png",
    "/api/storage/a%2fb.png",
    "/api/storage/a%5Cb.png",
    "/api/storage/a\\b.png",
    "/\\evil.example/api/storage/x",
    "/\t/evil.example/api/storage/x",
    "/api/storage/a%00.png",
    "/api/storage/%09/x.png",
    "/api/storage/a%7F.png",
    "https://u@hub.example/vault/default/api/storage/x.png",
    "https://:p@hub.example/vault/default/api/storage/x.png",
    "/api/storage/a\u0000.png",
    "/api/storage/a\u007f.png",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "blob:https://hub.example/uuid",
  ])("refuses %s", (url) => {
    expect(vaultStorageTarget(VAULT, url, PAGE)).toBeNull();
  });

  it("an empty or root-relative vault URL resolves against the page", () => {
    expect(vaultStorageTarget("", "/api/storage/a.png", PAGE)?.href).toBe(
      "https://hub.example/api/storage/a.png",
    );
    expect(vaultStorageTarget("/vault/default/", "/api/storage/a.png", PAGE)?.href).toBe(
      "https://hub.example/vault/default/api/storage/a.png",
    );
    expect(vaultStorageTarget("", "https://evil.example/api/storage/a.png", PAGE)).toBeNull();
    // No page and no host: nothing to anchor to, so nothing passes.
    expect(vaultStorageTarget("", "/api/storage/a.png")).toBeNull();
  });

  it("a stray query or hash on the stored vault URL can't bend the storage prefix", () => {
    expect(vaultStorageTarget(`${VAULT}?x=1`, "/api/storage/a.png", PAGE)?.href).toBe(
      "https://hub.example/vault/default/api/storage/a.png",
    );
    expect(
      vaultStorageTarget(`${VAULT}#h`, "https://hub.example/vault/defaultapi/storage/a.png", PAGE),
    ).toBeNull();
  });
});

describe("noteMediaKind", () => {
  it.each([
    ["/api/storage/a.png", "storage"],
    ["https://tracker.example/x.png", "remote"],
    // an encoded slash is fine in a link that is never loaded
    ["https://bucket.example/o/dir%2Flogo.png?alt=media", "remote"],
    ["https://evil.example/api/storage/x.png", "remote"],
    ["data:image/png;base64,AAAA", "inline"],
    ["blob:https://hub.example/uuid", "inline"],
    ["data:image/svg+xml,<svg/>", "blocked"],
    ["data:text/html,<b>x</b>", "blocked"],
    ["//cdn.example/x.png", "blocked"],
    ["javascript:alert(1)", "blocked"],
    ["https://evil.example\\@hub.example/x.png", "blocked"],
    ["/static/x.png", "blocked"],
  ])("%s is %s", (src, kind) => {
    expect(noteMediaKind(src, VAULT, PAGE)).toBe(kind);
  });

  it("with no vault connected nothing counts as storage", () => {
    expect(noteMediaKind("/api/storage/a.png", null, PAGE)).toBe("blocked");
  });
});
