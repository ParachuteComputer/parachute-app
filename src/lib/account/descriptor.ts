/**
 * The door descriptor — `GET /.well-known/parachute-account` — the ONE thing
 * the app reads to tell which kind of door it's being served by (SYNTHESIS
 * "PORTABILITY", HUB-PARITY P0/P4). The app does NOT import `door-contract`
 * from anywhere — per the app's contract-of-record convention (see
 * `types.ts:1-16`), these shapes are PINNED LOCALLY, verified against the P0
 * design. Same-origin, public (no session/cookie needed): whoever serves the
 * app also serves this file.
 *
 * Fallback rule (pin it here, it's load-bearing): `null` (fetch failed,
 * network error, non-200, unparsable body) OR a descriptor with no `auth`
 * block ⇒ the app behaves EXACTLY as it does today — the magic-link door.
 * Cloud is the only currently-shipped door and it has no `auth` block yet, so
 * this is the safe, ship-today default; a hub descriptor adds `auth` to
 * switch the front door to the password-ceremony-hop branch (Landing.tsx).
 */

import type { DoorPlan } from "./types";

/** One door's advertised sign-in surface. `methods` may list more than one;
 *  the app only distinguishes "has magic_link" vs "password-only" today. */
export interface DoorAuthDescriptor {
  methods: ("magic_link" | "password")[];
  /** Origin-rooted path on the DOOR itself (never mount-prefixed — it's not
   *  an app route). E.g. a hub's own `/login`. */
  signin_path: string;
}

export interface DoorDescriptor {
  door?: "hub" | "cloud";
  auth?: DoorAuthDescriptor;
  /** Origin-rooted path on the door for account creation, when the door
   *  supports self-serve signup (a password door without this ⇒ accounts are
   *  operator-provisioned only). */
  signup_path?: string;
  /** `{name}`-templated preview of a vault's eventual address — preview-only,
   *  never the source of truth for a URL after creation (Welcome.tsx). */
  vault_url_template?: string;
  capabilities?: { vault_create?: boolean; vault_delete?: boolean };
  /** The upgrade-tier ladder for the Account surface's Billing section (see
   *  `Account.tsx`'s plan cards) — omitted on a door with no billing. */
  plans?: DoorPlan[];
}

type Fetch = typeof fetch;

const STORAGE_KEY = "parachute:door-descriptor";

// In-module memo so a single tab pays at most one fetch across the whole app
// lifetime, regardless of how many components call getDoorDescriptor() during
// boot. `undefined` = not yet resolved this module lifetime; `null` is itself
// a valid resolved value (no door / no descriptor).
let cache: DoorDescriptor | null | undefined;
let inflight: Promise<DoorDescriptor | null> | null = null;

/**
 * Coerce an untrusted parsed descriptor into a safe shape. A door we don't
 * control (a self-hosted hub, a future door) could serve a well-formed JSON
 * body with a MALFORMED `auth` block — `methods` not an array, `signin_path`
 * not a string, or `auth: {}`. The front door does `auth.methods.includes(...)`
 * and hops to `signin_path`, so a bad shape would throw (white screen — the app
 * has no ErrorBoundary) or hop to `"undefined?next=…"`. The fallback rule is
 * "anything we can't trust ⇒ behave as the magic-link door", so we DROP a
 * malformed `auth` (leaving the descriptor otherwise intact) rather than trust
 * it. A non-object body coerces to `null` (pure magic-link fallback). A
 * malformed `plans` (the Billing section's ladder) is dropped the same way.
 */
function normalizeDescriptor(raw: unknown): DoorDescriptor | null {
  // Arrays are `typeof === "object"` too — a JSON array body is not a descriptor.
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as DoorDescriptor;
  const auth = src.auth as Partial<DoorAuthDescriptor> | undefined;
  // Crash-safety only, NOT a value allowlist: `methods` must be a non-empty
  // array of strings (so `methods.includes(...)` and any downstream string op is
  // safe) and `signin_path` an absolute path (so the ceremony hop can't become
  // `"undefined?next=…"`). We deliberately do NOT require the method values to be
  // `magic_link`/`password`: a door advertising a method we don't recognize
  // (e.g. `passkey`) should still hop to its own sign-in page, not fall back to
  // an email form posting to an `/auth/magic` it may not serve.
  const authOk =
    !!auth &&
    Array.isArray(auth.methods) &&
    auth.methods.length > 0 &&
    auth.methods.every((m) => typeof m === "string") &&
    typeof auth.signin_path === "string" &&
    auth.signin_path.startsWith("/");
  // `plans` (the Billing section's upgrade ladder) is consumed by `UpgradePlans`
  // as `plans.length` then `plans.map((p) => p.id …)`. A door we don't control
  // serving `plans: "x"` (truthy `.length`, no `.map`) or `plans: [null]`
  // (`.id` on `null`) would throw during render → a white screen (no
  // ErrorBoundary). So `plans` is KEPT only when it's a clean array of objects;
  // otherwise DROPPED, exactly like a malformed `auth`. An absent `plans` is
  // fine (the section just shows no cards).
  const plansOk =
    src.plans === undefined ||
    (Array.isArray(src.plans) && src.plans.every((p) => !!p && typeof p === "object"));
  if (authOk && plansOk) return src;
  // Drop whichever block is malformed; keep the rest of the descriptor intact.
  const { auth: _auth, plans: _plans, ...rest } = src;
  const out: DoorDescriptor = { ...rest };
  if (authOk) out.auth = src.auth;
  if (plansOk && src.plans !== undefined) out.plans = src.plans;
  return out;
}

async function fetchDescriptor(fetchImpl: Fetch): Promise<DoorDescriptor | null> {
  try {
    // Same-origin, public: no credentials, no CSRF — this is a static/cheap
    // file the door publishes, not a session-gated endpoint.
    const res = await fetchImpl("/.well-known/parachute-account");
    if (!res.ok) return null;
    return normalizeDescriptor(await res.json());
  } catch {
    // Network failure, CORS, or a garbage (non-JSON) body — degrade to the
    // fallback rule above rather than throwing into the boot path.
    return null;
  }
}

function persist(value: DoorDescriptor | null): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, value === null ? "null" : JSON.stringify(value));
  } catch {
    // best-effort (private mode / storage full) — the in-module memo still
    // holds for the rest of this tab's lifetime.
  }
}

/**
 * Resolve the door descriptor, memoized in-module + sessionStorage (key
 * `parachute:door-descriptor`) so a boot with several consumers (the front
 * door, Welcome's naming echo, the boot dispatcher) pays exactly one fetch.
 * Returns `null` on any non-200 / network / parse failure (see the fallback
 * rule above) — callers never need to distinguish "no door" from "old door".
 */
export async function getDoorDescriptor(
  fetchImpl: Fetch = fetch.bind(globalThis),
): Promise<DoorDescriptor | null> {
  if (cache !== undefined) return cache;
  if (inflight) return inflight;

  // sessionStorage survives a hard reload within the same tab (the in-module
  // memo doesn't — a fresh module instance loses it), so a returning tab
  // still skips the network round-trip.
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw != null) {
      try {
        cache = raw === "null" ? null : normalizeDescriptor(JSON.parse(raw));
        return cache;
      } catch {
        // corrupted cache entry — fall through and fetch fresh
      }
    }
  } catch {
    // sessionStorage unavailable (private mode / SSR) — fetch fresh below;
    // the in-module memo still dedupes concurrent callers this tab.
  }

  inflight = fetchDescriptor(fetchImpl)
    .then((result) => {
      cache = result;
      persist(result);
      return result;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Test-only: clear the in-module memo (sessionStorage is cleared by the
 *  test's own `sessionStorage.clear()` in `beforeEach`). */
export function __resetDoorDescriptorCacheForTests(): void {
  cache = undefined;
  inflight = null;
}
