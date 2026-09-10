import { describe, expect, it } from "vitest";
import { matchesNavigationDenylist } from "./pwa-navigation-denylist";

// The exported predicate is exactly what workbox applies for
// `navigateFallbackDenylist` (each RegExp tested against `url.pathname +
// url.search`; the request escapes the SPA nav-fallback iff SOME entry
// matches). Testing it directly keeps the SW gate and App.tsx's bare-path note
// shim on one implementation.
const isDenied = matchesNavigationDenylist;

describe("PWA navigation denylist", () => {
  // Every server-owned ceremony (identity worker route table,
  // parachute-cloud/workers/identity/src/index.ts) MUST be denied the SPA
  // shell — otherwise the installed SW paints the cached index.html over the
  // real server page once the app is served same-origin.
  const ceremonies = [
    "/api/vault/x",
    "/oauth/authorize?client_id=x&response_type=code",
    "/oauth/token",
    "/oauth/register",
    "/oauth/revoke",
    "/.well-known/oauth-authorization-server",
    "/.well-known/jwks.json",
    "/signup",
    "/login",
    "/login/2fa",
    "/logout",
    "/auth/magic",
    "/auth/verify?token=abc",
    "/console",
    "/console/security",
    "/console/vaults/export",
    "/admin",
    "/admin/users",
    "/account/token",
    "/billing",
    "/billing/checkout",
    "/unsubscribe?token=abc",
    "/health",
    // my. Phase A2: the vault worker's data-plane address (zone-routed,
    // URL-TOPOLOGY.md §2.3) and Phase B's per-account namespace prefix.
    "/vault/aaron",
    "/vault/aaron/mcp",
    "/u/aaron",
    "/u/aaron/vault/aaron",
  ];
  it.each(ceremonies)("denies the server ceremony %s", (path) => {
    expect(isDenied(path)).toBe(true);
  });

  // The inverse guard — the regression that actually bites: NEVER deny a route
  // the SPA owns, or the installed app breaks. Mirrors App.tsx.
  const spaRoutes = [
    "/",
    "/notes",
    "/notes?view=pinned",
    // W2-7: /all and /graph are pre-rename addresses now served as shims
    // (→ /notes, /map) — still SPA-owned routes the SW must never deny.
    "/all",
    "/all?view=pinned",
    "/tags",
    "/new",
    "/capture",
    "/import",
    "/connect",
    "/map",
    "/graph",
    "/today",
    "/calendar",
    "/activity",
    "/n/abc123",
    "/n/abc123/edit",
    "/add?add=https://u.parachute.computer/vault/x",
    "/vaults",
    "/settings",
    // The SPA's OWN OAuth redirect target — must boot the shell (even offline).
    "/oauth/callback?code=xyz&state=abc",
    // Canonical note ids live under /n/, so even ids that spell a ceremony word
    // never collide with a ceremony prefix.
    "/n/login",
    "/n/admin",
    "/n/billing",
    // my. Phase A2: the bare forms have no server-owned page at exactly that
    // path (only `/vault/<name>` and `/u/<handle>` are real addresses), so a
    // note literally named "vault" or "u" keeps resolving as it does today —
    // unlike /admin, /billing, etc. above, which ARE ceremonies bare.
    "/vault",
    "/u",
    // app#186: vault-scoped deep links are SPA routes — an installed PWA must
    // serve the cached shell for them (offline included), exactly as it does
    // for the canonical `/n/<id>` pair above. The `/v` prefix is deliberately
    // NOT `/vault` (which IS denied, two entries up) precisely so these can be
    // SPA-owned without touching the reserved data-plane namespace.
    "/v/aaron/n/abc123",
    "/v/aaron/n/abc123/edit",
    "/v/aaron/n/abc123?highlight=x",
    // The ceremony-word cases, both positions: a vault named `login` and a note
    // named `login`. Neither may be swallowed by `/^\/login/` — the prefixes are
    // anchored at the start of the pathname, and these pin that they stay so.
    "/v/login/n/abc123",
    "/v/aaron/n/login",
    "/v/admin/n/billing",
    // Under a sub-mount the whole thing shifts below the mount prefix and is
    // still SPA-owned.
    "/notes/v/aaron/n/abc123",
    "/surface/parachute/v/aaron/n/abc123",
    // app#194: the note reference may be a PATH, spread across segments — the
    // deepest shape this app asks the service worker to shell. Including one
    // whose path segments are ceremony words, and the bare vault address.
    "/v/aaron/n/Projects/2026/Roadmap",
    "/v/aaron/n/Projects/2026/Roadmap/edit",
    "/v/aaron/n/admin/billing/login",
    "/notes/v/aaron/n/Projects/2026/Roadmap",
    "/v/aaron",
    "/v/v-aaron-id",
  ];
  it.each(spaRoutes)("serves the SPA shell for %s", (path) => {
    expect(isDenied(path)).toBe(false);
  });

  // The one genuine collision, pinned explicitly: /oauth/callback stays
  // SPA-owned while its /oauth siblings are denied.
  it("keeps /oauth/callback SPA-owned while denying sibling /oauth ceremonies", () => {
    expect(isDenied("/oauth/callback")).toBe(false);
    expect(isDenied("/oauth/authorize")).toBe(true);
  });

  // Second consumer: App.tsx's legacy bare-path note shim (`/:id`) feeds the
  // origin-absolute pathname through this same predicate to decide whether a
  // bare path is a note or a server ceremony. Because the check is against the
  // ORIGIN-ABSOLUTE path, it is mount-aware — a note literally named `login`
  // collides with the ceremony ONLY at the root mount (Phase 1's same-origin
  // app), never under a `/notes` or `/surface/<slug>` mount where it lives at
  // `/notes/login`. Guards against a mount-blind guard that would wrongly stop
  // resolving such notes on the self-hosted surfaces.
  describe("bare-path note shim: origin-absolute mount-awareness", () => {
    it("denies a ceremony-word bare path at the root mount (Phase 1 collision)", () => {
      // `/login` served same-origin with the ceremony IS the ceremony — the
      // SPA must not claim it as a note.
      expect(isDenied("/login")).toBe(true);
      expect(isDenied("/admin")).toBe(true);
      expect(isDenied("/billing")).toBe(true);
      expect(isDenied("/health")).toBe(true);
    });

    it("does NOT deny the same note under a /notes or /surface/<slug> mount", () => {
      // A note named `login` bookmarked bare on a mounted host sits below the
      // mount prefix — no ceremony collision, keep redirecting it to /n/login.
      expect(isDenied("/notes/login")).toBe(false);
      expect(isDenied("/notes/admin/edit")).toBe(false);
      expect(isDenied("/surface/notes/login")).toBe(false);
      expect(isDenied("/surface/my-notes/billing")).toBe(false);
    });

    it("does NOT deny an ordinary bare-path note that spells nothing special", () => {
      expect(isDenied("/MyNote")).toBe(false);
      expect(isDenied("/2026-07-10")).toBe(false);
    });
  });
});
