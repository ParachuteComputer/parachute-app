import { describe, expect, it } from "vitest";
import { safeInternalRedirect, withReturnTo } from "./url";

// notes#63 — `safeInternalRedirect` guards the post-connect redirect target
// that the hub `/account` "Import notes" deep-link rides through `/add` into
// the OAuth flow. It must only ever pass through an in-app, same-origin path
// so the value can never round-trip into react-router `navigate()` as an
// open redirect.
describe("safeInternalRedirect", () => {
  it("passes through a plain in-app absolute path", () => {
    expect(safeInternalRedirect("/import")).toBe("/import");
    expect(safeInternalRedirect("/notes/n/abc")).toBe("/notes/n/abc");
  });

  it("preserves an in-app path with its own query string", () => {
    expect(safeInternalRedirect("/import?foo=bar")).toBe("/import?foo=bar");
  });

  it("rejects an absolute URL (off-origin)", () => {
    expect(safeInternalRedirect("https://evil.example/phish")).toBeUndefined();
    expect(safeInternalRedirect("http://evil.example")).toBeUndefined();
  });

  it("rejects a protocol-relative URL", () => {
    // `//evil.example` would navigate off-origin even though it has no scheme.
    expect(safeInternalRedirect("//evil.example")).toBeUndefined();
  });

  it("rejects a tab (WHATWG URL strips it, turning `/\\t/evil.com` into `https://evil.com/`)", () => {
    expect(safeInternalRedirect("/\t/evil.com")).toBeUndefined();
    // Confirm the premise this guards against: a bare URL parse strips the
    // tab and reads the rest as an authority.
    expect(new URL("/\t/evil.com", "https://example.test").href).toBe("https://evil.com/");
  });

  it("rejects embedded newline and carriage return", () => {
    expect(safeInternalRedirect("/\n/evil.com")).toBeUndefined();
    expect(safeInternalRedirect("/\r/evil.com")).toBeUndefined();
    expect(safeInternalRedirect("/import\n")).toBeUndefined();
  });

  it("rejects a NUL byte", () => {
    expect(safeInternalRedirect("/import\x00")).toBeUndefined();
  });

  it("rejects a backslash-authority form (`/\\` open-redirect bypass)", () => {
    // The WHATWG URL parser normalizes a backslash to a forward slash, so
    // `new URL('/\\evil.com', base)` resolves to `http://evil.com/`. A naive
    // `//`-only guard would let this through — pin it as rejected.
    expect(safeInternalRedirect("/\\evil.com")).toBeUndefined();
    expect(safeInternalRedirect("/\\evil.com/path")).toBeUndefined();
  });

  it("blocks the encoded `//` form after searchParams decoding", () => {
    // The redirect arrives as a URLSearchParams value, which is
    // percent-decoded before it reaches this guard. `%2F%2Fevil.com` decodes
    // to `//evil.com` — document that the decoded value is what's checked, so
    // a future change can't regress into checking the raw encoded string.
    const decoded = new URLSearchParams("redirect=%2F%2Fevil.com").get("redirect");
    expect(decoded).toBe("//evil.com");
    expect(safeInternalRedirect(decoded)).toBeUndefined();
  });

  it("rejects a non-http(s) scheme", () => {
    expect(safeInternalRedirect("javascript:alert(1)")).toBeUndefined();
  });

  it("rejects a relative (non-leading-slash) path", () => {
    // navigate() would resolve this relative to the current route — not the
    // intended absolute in-app target — so it's not a valid carrier here.
    expect(safeInternalRedirect("import")).toBeUndefined();
  });

  it("returns undefined for empty / nullish input", () => {
    expect(safeInternalRedirect(null)).toBeUndefined();
    expect(safeInternalRedirect(undefined)).toBeUndefined();
    expect(safeInternalRedirect("")).toBeUndefined();
  });
});

// app B/6 — `withReturnTo` writes the SAME `?redirect=` param the sanitizer
// above guards, at the one hop that used to drop it: a route guard turning a
// logged-out reader away from a note deep link.
describe("withReturnTo", () => {
  it("appends the return target, encoded, to a base with no query", () => {
    expect(withReturnTo("/", "/n/abc123")).toBe("/?redirect=%2Fn%2Fabc123");
    expect(withReturnTo("/add", "/v/beta/n/abc123")).toBe("/add?redirect=%2Fv%2Fbeta%2Fn%2Fabc123");
  });

  it("appends with `&` when the base already carries a query", () => {
    expect(withReturnTo("/add?url=https%3A%2F%2Fv.example", "/n/abc")).toBe(
      "/add?url=https%3A%2F%2Fv.example&redirect=%2Fn%2Fabc",
    );
  });

  it("encodes a target that carries its own query string", () => {
    // The whole target is one param value — its `?` and `=` must not leak into
    // the outer query and become separate params.
    const out = withReturnTo("/", "/n/abc?view=raw");
    expect(out).toBe("/?redirect=%2Fn%2Fabc%3Fview%3Draw");
    expect(new URLSearchParams(out.slice(2)).get("redirect")).toBe("/n/abc?view=raw");
  });

  it("DROPS an off-origin target — the base comes back untouched", () => {
    // The open-redirect case: a guard must degrade to the plain landing, never
    // carry a value that could steer navigate() off-origin later.
    expect(withReturnTo("/", "https://evil.example/phish")).toBe("/");
    expect(withReturnTo("/", "//evil.example")).toBe("/");
    expect(withReturnTo("/", "/\\evil.com")).toBe("/");
    expect(withReturnTo("/add", "javascript:alert(1)")).toBe("/add");
  });

  it("returns the base unchanged for an empty / nullish target", () => {
    expect(withReturnTo("/", null)).toBe("/");
    expect(withReturnTo("/", undefined)).toBe("/");
    expect(withReturnTo("/add", "")).toBe("/add");
  });
});
