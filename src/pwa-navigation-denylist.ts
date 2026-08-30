// The service worker's navigation fallback (workbox `navigateFallback`) serves
// the cached SPA shell (`index.html`) for any in-scope navigation that isn't a
// precached asset. That behaviour is exactly WRONG for the auth/account
// *ceremonies* — server-rendered pages the identity worker owns. Today the
// ceremonies live on a different origin (`cloud.parachute.computer`) so the SW
// never sees them; once the SPA is served same-origin with them (the Parachute
// App campaign — `app.parachute.computer`, parachute-cloud#116) an un-denied
// ceremony navigation would be swallowed by the installed SW and painted as the
// SPA shell instead of the real server page. Each entry below forces its
// navigation past the SW to the origin.
//
// The prefix set mirrors the identity worker's route table
// (`parachute-cloud/workers/identity/src/index.ts`). Every entry is a real
// server-owned prefix; none collides with a route the SPA owns — the one hazard,
// `/oauth/callback`, is the SPA's PKCE redirect target and is deliberately
// EXCLUDED (negative lookahead). `pwa-navigation-denylist.test.ts` asserts both
// directions: ceremonies are denied, SPA routes are not.
//
// Harmless on `notes.parachute.computer` today (these prefixes 404 there
// anyway); load-bearing at one origin.
export const navigationDenylist: readonly RegExp[] = [
  // Vault REST + the legacy notes-daemon API proxy — never the SPA shell.
  /^\/api\//,

  // OAuth ceremony endpoints (authorize / token / register / revoke) belong to
  // the identity worker. EXCEPTION: `/oauth/callback` is the SPA's OWN route
  // (`App.tsx`) — the PKCE redirect target that must boot the SPA (even offline
  // / cache-first). The negative lookahead denies the worker's `/oauth/*` while
  // letting the callback fall through to the cached shell.
  /^\/oauth\/(?!callback)/,

  // OAuth/OIDC discovery + JWKS — served by the worker.
  /^\/\.well-known\//,

  // Session-cookie account ceremonies (server-rendered pages).
  /^\/signup/, // signup GET/POST
  /^\/login/, // login GET/POST + /login/2fa second factor
  /^\/logout/, // logout POST
  /^\/auth\//, // magic-link request + verify
  /^\/console/, // account console + /console/* (security, vaults, checklist, promo…)
  /^\/admin/, // operator admin console + /admin/*
  // Phase-2 account contract (parachute-cloud#116). Forward-looking: the route
  // does not exist yet, and the SPA's account UI lives under `/settings`, not
  // here — so denying it now cannot collide, only pre-empt the hazard.
  /^\/account\//,
  /^\/billing/, // Stripe checkout / portal / webhook + /billing/*
  /^\/unsubscribe/, // onboarding-drip one-click unsubscribe (GET/POST)
  /^\/health/, // liveness JSON

  // my. Phase A2 (one-origin door, URL-TOPOLOGY.md §2.3 cost #1): once this
  // app is served on my.parachute.computer, `/vault/*` is a Cloudflare zone
  // route that dispatches straight to the vault worker — ABOVE this worker's
  // Static Assets, before the SW's fetch handler ever runs. The route should
  // always win, but this entry is the belt to that platform-layer suspenders:
  // if the route is ever misconfigured, an installed PWA must still refuse to
  // paint the cached SPA shell over a `/vault/<name>/...` navigation. `/u/*`
  // is Phase B's per-account vault namespace (`/u/<handle>/vault/<name>`),
  // reserved now so it never becomes an app route in the meantime. Neither
  // prefix requires a bare form (`/vault`, `/u` alone) — there's no
  // server-owned page at exactly that path, so a note literally named
  // "vault" or "u" keeps resolving as it does today.
  /^\/vault\//,
  /^\/u\//,
];

// NOT denied, and that is the point: `/v/<vault>/n/<id>` (app#186's vault-scoped
// deep link) is an SPA route, so it must fall THROUGH to the cached shell exactly
// like `/n/<id>` does — an installed PWA has to open a shared note link offline.
// No entry above can match it (`/^\/vault\//` needs the full word `vault`; every
// other prefix is anchored on a different first segment), so this needed no code
// change — only the guard: `pwa-navigation-denylist.test.ts` pins `/v/...` in the
// SPA-owned list, INCLUDING the ceremony-word cases (`/v/login/n/x`,
// `/v/aaron/n/login`). Those are the shapes that would break if anyone ever
// relaxed an entry's anchor to a bare substring test.

// True when `pathname` matches some server-owned ceremony prefix above. This is
// the exact predicate workbox applies for `navigateFallbackDenylist` (tested
// against `url.pathname + url.search`), exported so the SPA route table can ask
// the SAME question the service worker asks — the one source of truth. Its
// second consumer is App.tsx's legacy bare-path note shim (`/:id`), which must
// NOT redirect a ceremony-shaped path (`/login`, `/admin`, …) to a `/n/<id>`
// note: once the app is served same-origin with the ceremonies (Phase 1,
// parachute-cloud#116) the SW forwards such a path past the SPA to the real
// server page, and the route table has to agree. Pass an origin-absolute path
// (e.g. `window.location.pathname`); the check is mount-aware for free, since a
// note literally named `login` served under a `/notes` or `/surface/<slug>`
// mount sits at `/notes/login`, which matches nothing here.
export function matchesNavigationDenylist(pathname: string): boolean {
  return navigationDenylist.some((re) => re.test(pathname));
}
