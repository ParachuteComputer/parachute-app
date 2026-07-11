import { afterEach, describe, expect, it } from "vitest";
import { detectMountBase, detectMountBaseWithSlash, withMount } from "./lib/base-url";

// Guards the runtime mount detection. The bundle no longer bakes its mount
// path in at build time (Vite `base: ""` → relative asset URLs); instead the
// SPA reads its own mount from `window.location.pathname` so the same `dist/`
// can be served at `/notes/` (legacy daemon), `/surface/notes/` (parachute-surface
// default), or `/surface/<custom-slug>/` (parachute-surface with a renamed install).
//
// The detector's output feeds BrowserRouter's `basename` and the OAuth
// redirect URI; if any of those derivations changes shape this test should
// fail loudly until the contract is reconciled.
describe("detectMountBase", () => {
  describe("legacy /notes/ mount (daemon)", () => {
    it("returns /notes for the root document URL", () => {
      expect(detectMountBase("/notes/")).toBe("/notes");
    });
    it("returns /notes for a deep route URL", () => {
      expect(detectMountBase("/notes/n/abc123")).toBe("/notes");
    });
    it("returns /notes for an edit sub-route", () => {
      expect(detectMountBase("/notes/n/abc123/edit")).toBe("/notes");
    });
    it("returns /notes for the OAuth callback path", () => {
      expect(detectMountBase("/notes/oauth/callback")).toBe("/notes");
    });
    it("does NOT treat a bare /notes as the legacy mount — it's the app's canonical Notes route (W2-7)", () => {
      // The daemon's document URL is `/notes/`; a bare `/notes` is the app's
      // own Notes-list route on the root deploy, so it must fall through to the
      // root mount (else a hard load of /notes lands on Home). Only /notes/ and
      // deeper legacy routes detect the mount.
      expect(detectMountBase("/notes")).toBe("");
    });
  });

  describe("/surface/<slug>/ mount (parachute-surface)", () => {
    it("returns /surface/notes for the default app mount", () => {
      expect(detectMountBase("/surface/notes/")).toBe("/surface/notes");
    });
    it("returns /surface/notes for a deep route under the app mount", () => {
      expect(detectMountBase("/surface/notes/settings")).toBe("/surface/notes");
    });
    it("returns /surface/notes for the OAuth callback under the app mount", () => {
      expect(detectMountBase("/surface/notes/oauth/callback")).toBe("/surface/notes");
    });
    it("returns the renamed slug when the operator installs under a custom name", () => {
      expect(detectMountBase("/surface/my-notes/")).toBe("/surface/my-notes");
    });
    it("returns the renamed slug for a deep route under the custom mount", () => {
      expect(detectMountBase("/surface/my-notes/n/some-id/edit")).toBe("/surface/my-notes");
    });
    it("handles underscored slugs (PATH_PATTERN allows _ )", () => {
      expect(detectMountBase("/surface/my_personal_notes/")).toBe("/surface/my_personal_notes");
    });
    it("handles numeric-suffix slugs", () => {
      expect(detectMountBase("/surface/notes2/")).toBe("/surface/notes2");
    });
  });

  describe("fallback behaviour (root-hosted default)", () => {
    it("resolves the bare origin root to the empty (root) mount", () => {
      // parachute-app is root-hosted: the bare origin `/` is the real, common
      // case, and the router basename must be empty to match it.
      expect(detectMountBase("/")).toBe("");
    });
    it("resolves an unknown sibling route under /surface/ to root", () => {
      // `/surface/admin` is parachute-surface's admin SPA, not a UI mount. If
      // this bundle ever loaded there by accident, root is the safe default.
      // (PATH_PATTERN forbids the literal `admin` slug, so this is theoretical.)
      expect(detectMountBase("/surface/")).toBe("");
    });
    it("resolves paths the slug grammar rejects to root", () => {
      // Slug must start with [a-z0-9]; a leading hyphen fails the regex and we
      // fall through to the root default.
      expect(detectMountBase("/surface/-bad/")).toBe("");
    });
    it("resolves to root when no window is available (SSR/test)", () => {
      // Implicit when called with no arg in a non-browser env. jsdom's document
      // has no `<meta name="parachute-mount">` injected, so the canonical tier
      // returns null and we fall through to the root default.
      expect(detectMountBase(undefined as unknown as string | undefined)).toBe("");
    });
  });

  describe("meta-tag canonical contract", () => {
    // Tier 1 of detection: when parachute-surface injects
    // `<meta name="parachute-mount" content="/surface/<name>">`, notes-ui reads it
    // directly. No regex, no guessing. The host explicitly declared the mount;
    // we believe it. Injection side: parachute-app#25 (merged).
    const stubWith = (content: string | null | undefined, name = "parachute-mount") =>
      ({
        querySelector: (selector: string) => {
          if (selector === `meta[name="${name}"]`) {
            return content === null ? null : { content };
          }
          return null;
        },
      }) as unknown as Document;

    it('reads from <meta name="parachute-mount" content="/surface/notes"> when present', () => {
      const doc = stubWith("/surface/notes");
      // Pathname says /notes (would trigger regex fallback), but meta wins.
      expect(detectMountBase("/notes/anything", doc)).toBe("/surface/notes");
    });

    it("ignores meta tag when content is empty", () => {
      const doc = stubWith("");
      expect(detectMountBase("/notes/x", doc)).toBe("/notes");
    });

    it("ignores meta tag when content doesn't start with /", () => {
      const doc = stubWith("app/notes");
      expect(detectMountBase("/notes/x", doc)).toBe("/notes");
    });

    it("ignores meta tag when name is not exactly parachute-mount", () => {
      // Stub a doc where only `parachute-mount-other` matches; the real
      // selector returns null and we fall through to regex.
      const doc = stubWith("/surface/wrong", "parachute-mount-other");
      expect(detectMountBase("/notes/x", doc)).toBe("/notes");
    });

    it("strips trailing slash from meta tag content (/surface/notes/ → /surface/notes)", () => {
      const doc = stubWith("/surface/notes/");
      expect(detectMountBase("/", doc)).toBe("/surface/notes");
    });

    it("falls back to regex when meta tag is absent", () => {
      const doc = stubWith(null);
      expect(detectMountBase("/surface/my-notes/x", doc)).toBe("/surface/my-notes");
    });

    it("falls back to root when meta tag absent AND no pathname match", () => {
      const doc = stubWith(null);
      expect(detectMountBase("/", doc)).toBe("");
    });
  });

  describe("detectMountBaseWithSlash", () => {
    it("appends a slash to the detected base", () => {
      expect(detectMountBaseWithSlash("/notes/")).toBe("/notes/");
      expect(detectMountBaseWithSlash("/surface/notes/")).toBe("/surface/notes/");
    });
    it("appends a slash even when input lacks one", () => {
      // `/surface/<slug>` still detects a bare (no-trailing-slash) mount; bare
      // `/notes` no longer does (W2-7 — see the detectMountBase test above), so
      // the slash-append is demonstrated on the surface mount.
      expect(detectMountBaseWithSlash("/surface/my-notes")).toBe("/surface/my-notes/");
    });
  });

  // HUB-PARITY P4 — `withMount` reads the LIVE global document (no override
  // params, unlike `detectMountBase` above), since its callers (Landing's
  // ceremony hop, the hub-gate banner's change-password `next`) always run in
  // a real browser/jsdom context, never SSR.
  describe("withMount", () => {
    afterEach(() => {
      for (const meta of document.querySelectorAll('meta[name="parachute-mount"]')) {
        meta.remove();
      }
    });

    it("passes an app-relative path through unprefixed at the root mount (no meta tag)", () => {
      expect(withMount("/welcome")).toBe("/welcome");
    });

    it("prefixes an app-relative path with the mount read from the meta tag (e.g. a hub-mounted app at /app)", () => {
      const meta = document.createElement("meta");
      meta.setAttribute("name", "parachute-mount");
      meta.setAttribute("content", "/app");
      document.head.appendChild(meta);
      expect(withMount("/welcome")).toBe("/app/welcome");
    });
  });
});
