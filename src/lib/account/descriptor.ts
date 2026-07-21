/**
 * The door descriptor — `GET /.well-known/parachute-account` — the ONE thing
 * the app reads to tell which kind of door it's being served by (SYNTHESIS
 * "PORTABILITY", HUB-PARITY P0/P4). The app does NOT import `door-contract`
 * from anywhere — per the app's contract-of-record convention (see
 * `types.ts:1-16`), these shapes are PINNED LOCALLY, verified against the P0
 * design. Same-origin, public (no session/cookie needed): whoever serves the
 * app also serves this file. The door is a property of the SERVING ORIGIN's
 * runtime — no hostname assumptions, and account endpoints stay
 * serving-origin-relative (the my.-canonical intersection).
 *
 * Classification rule (pin it here — it's load-bearing). This resolver is the
 * data side; the front door (`Landing.tsx`) forks on it into THREE states:
 *   - a CONFIRMED cloud/magic-link descriptor → the cloud email form,
 *   - a CONFIRMED hub/password descriptor (`auth`, no `magic_link`) → the hub
 *     hybrid card,
 *   - anything UNRESOLVED — `null` (fetch failed / non-200 / unparsable), or a
 *     descriptor we can't classify — → a door-NEUTRAL shell.
 * The old rule ("null ⇒ magic-link, cloud is the only shipped door") was the
 * bug: a hub's descriptor going unfetched/stale would DEFAULT the app to cloud
 * onboarding. Cloud copy is now gated on a confirmed cloud shape, never the
 * absence of a signal.
 *
 * Durable cache (Fix 2): the resolved door is memoized per-origin in
 * localStorage with stale-while-revalidate — a box that once identified as a
 * hub keeps painting hub across reloads and OFFLINE, because a fetch FAILURE
 * never overwrites a known door and `null` is NEVER persisted.
 */

import type { BillingInterval, DoorPlan, DoorPlanInterval } from "./types";

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

// Per-origin localStorage key. The door is a serving-origin runtime property,
// so keying by origin means a cloud origin and a hub origin sharing one browser
// never cross-contaminate each other's cached door.
const STORAGE_PREFIX = "parachute:door-descriptor";

function storageKey(): string {
  const origin = typeof window !== "undefined" && window.location ? window.location.origin : "";
  return `${STORAGE_PREFIX}:${origin}`;
}

// In-module memo so a single tab pays at most one fetch across the whole app
// lifetime, regardless of how many components call getDoorDescriptor() during
// boot.
//   `undefined` = nothing known yet (no localStorage seed, no resolved fetch)
//   `null`      = resolved to "no door" via a fetch MISS (never from storage —
//                 we never persist null)
//   descriptor  = a known door (seeded from localStorage or a fresh fetch)
let cache: DoorDescriptor | null | undefined;
let inflight: Promise<DoorDescriptor | null> | null = null;
// The background revalidation runs at most ONCE per module lifetime — a door is
// a stable per-origin property, so one stale-while-revalidate pass is enough
// (this also keeps the "one fetch across all consumers" memo guarantee).
let revalidationStarted = false;
let revalidationDone = false;
// Consumers that asked to be told when the background revalidation CHANGES the
// painted door (stale-while-revalidate "update on change"). Fired at most once,
// only when the fresh door differs from the one already painted.
const revalidateListeners = new Set<(d: DoorDescriptor | null) => void>();

const INTERVAL_KEYS: readonly BillingInterval[] = ["monthly", "quarterly", "yearly"];

/**
 * Validate one `intervals[cycle]` entry. Crash-safety only, mirroring the
 * `auth`/`plans` guards above: `UpgradePlans` reads `.available` (a boolean
 * branch) and `.price`/`.label` (rendered as-is), so a door serving
 * `{available: "yes"}` or `{available: true, price: "3"}` would render
 * garbage rather than throw — still worth dropping so a bad entry can't be
 * mistaken for a real, checkout-safe price.
 */
function sanitizeIntervalEntry(raw: unknown): DoorPlanInterval | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Partial<DoorPlanInterval>;
  if (typeof src.available !== "boolean") return null;
  if (src.price !== undefined && typeof src.price !== "number") return null;
  if (src.label !== undefined && typeof src.label !== "string") return null;
  const out: DoorPlanInterval = { available: src.available };
  if (typeof src.price === "number") out.price = src.price;
  if (typeof src.label === "string") out.label = src.label;
  return out;
}

/**
 * Validate one plan's `intervals` block. `undefined` (the field is simply
 * absent — an older door / a hub) passes through as `undefined`, the
 * degrade-gracefully case `UpgradePlans` renders as the legacy `price_month`
 * line. Anything else that isn't a plain object is dropped entirely
 * (`undefined`). Individual malformed CYCLE entries are dropped one at a
 * time — a bad `monthly` entry shouldn't cost the door its valid `quarterly`
 * one — and if nothing in the block survives, the whole thing drops.
 */
function sanitizeIntervals(
  raw: unknown,
): Partial<Record<BillingInterval, DoorPlanInterval>> | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: Partial<Record<BillingInterval, DoorPlanInterval>> = {};
  let sawValid = false;
  for (const key of INTERVAL_KEYS) {
    if (!(key in src)) continue;
    const entry = sanitizeIntervalEntry(src[key]);
    if (entry) {
      out[key] = entry;
      sawValid = true;
    }
    // A malformed entry for this one cycle is silently dropped — not trusted,
    // but not fatal to the rest of the plan's intervals either.
  }
  return sawValid ? out : undefined;
}

/**
 * Sanitize one plan row: keep everything except `intervals`, which is
 * re-validated via `sanitizeIntervals` (dropped per-plan when malformed,
 * never trusted verbatim). Called only on rows `normalizeDescriptor` has
 * already confirmed are non-null objects.
 */
function sanitizePlan(raw: object): DoorPlan {
  const src = raw as DoorPlan;
  const { intervals, ...rest } = src;
  const clean = sanitizeIntervals(intervals);
  return clean !== undefined ? { ...rest, intervals: clean } : rest;
}

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
 * malformed `plans` (the Billing section's ladder) is dropped the same way,
 * and each surviving plan's `intervals` sub-block (F1/F3/F5) is independently
 * sanitized via `sanitizePlan`.
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
  // Every surviving plan's `intervals` sub-block gets its own pass through
  // `sanitizePlan` regardless of which branch below returns it — a plan can be
  // shape-valid (an object, so `plansOk` above is happy) while its `intervals`
  // field is garbage (F1/F3/F5: per-cycle price/availability is untrusted
  // input from the same door). A plan with no `intervals` field at all is
  // untouched by `sanitizePlan` (stays `undefined` — the degrade path).
  const sanitizedPlans =
    plansOk && Array.isArray(src.plans)
      ? src.plans.map((p) => sanitizePlan(p as object))
      : undefined;
  if (authOk && plansOk) {
    return sanitizedPlans ? { ...src, plans: sanitizedPlans } : src;
  }
  // Drop whichever block is malformed; keep the rest of the descriptor intact.
  const { auth: _auth, plans: _plans, ...rest } = src;
  const out: DoorDescriptor = { ...rest };
  if (authOk) out.auth = src.auth;
  if (plansOk && sanitizedPlans) out.plans = sanitizedPlans;
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

/**
 * Read the durable per-origin door from localStorage. Returns `undefined` for
 * "nothing known" (absent / unparsable / a value that normalizes to null) so
 * the caller falls through to a fresh fetch — we never persist null, but a
 * legacy/tampered entry is treated as no-knowledge rather than trusted.
 */
function readPersisted(): DoorDescriptor | undefined {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw == null) return undefined;
    const parsed = normalizeDescriptor(JSON.parse(raw));
    return parsed === null ? undefined : parsed;
  } catch {
    return undefined;
  }
}

/** Persist a KNOWN door (never null) to the per-origin localStorage key. */
function persist(value: DoorDescriptor): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(value));
  } catch {
    // best-effort (private mode / storage full) — the in-module memo still
    // holds for the rest of this tab's lifetime.
  }
}

/** Kick the single background revalidation for this module lifetime. */
function startRevalidate(fetchImpl: Fetch): void {
  if (revalidationStarted) return;
  revalidationStarted = true;
  inflight = fetchDescriptor(fetchImpl)
    .then((fresh) => {
      if (fresh !== null) {
        // A real door — adopt + persist. Tell listeners only when the painted
        // door actually CHANGED (a returning tab whose door is unchanged must
        // not trigger a spurious re-render).
        const changed = JSON.stringify(cache) !== JSON.stringify(fresh);
        cache = fresh;
        persist(fresh);
        if (changed) for (const cb of revalidateListeners) cb(fresh);
      } else if (cache === undefined) {
        // A cold MISS (no cached door AND the fetch failed / found nothing) —
        // record it in-memo so callers resolve to `null`, but DON'T persist
        // null and DON'T clobber (there's nothing to clobber).
        cache = null;
        for (const cb of revalidateListeners) cb(null);
      }
      // else: `fresh === null` but a door is already KNOWN — keep it. A fetch
      // failure must NEVER downgrade a known door (the offline self-heal).
      revalidationDone = true;
      revalidateListeners.clear();
      return cache ?? null;
    })
    .finally(() => {
      inflight = null;
    });
}

/**
 * Resolve the door descriptor, memoized in-module + a durable per-origin
 * localStorage cache so a boot with several consumers (the front door,
 * Welcome's naming echo, the boot dispatcher) pays exactly one fetch and a
 * returning/OFFLINE tab paints its last-known door immediately.
 *
 * Stale-while-revalidate: a known door (from localStorage) is returned
 * synchronously while a single background refetch runs; pass `onRevalidate` to
 * be notified if that refetch CHANGES the door. Returns `null` only when
 * there's no cached door AND the fetch resolves to nothing — a failure never
 * downgrades a door already known for this origin.
 */
export async function getDoorDescriptor(
  fetchImpl: Fetch = fetch.bind(globalThis),
  onRevalidate?: (d: DoorDescriptor | null) => void,
): Promise<DoorDescriptor | null> {
  // Seed the memo from the durable per-origin cache on first call (survives a
  // hard reload / fresh module instance — the in-module memo alone doesn't).
  if (cache === undefined) {
    const persisted = readPersisted();
    if (persisted !== undefined) cache = persisted;
  }

  // Register the change listener only while the revalidation can still fire —
  // once it's done, this caller already has the freshest value via the return.
  if (onRevalidate && !revalidationDone) revalidateListeners.add(onRevalidate);

  startRevalidate(fetchImpl);

  // Paint the last-known door immediately when we have one; otherwise (cold,
  // nothing cached) wait for the in-flight fetch.
  if (cache !== undefined) return cache;
  return inflight ?? null;
}

/**
 * Synchronous best-known door for THIS origin — the durable per-origin cache
 * (in-module memo, else localStorage), WITHOUT triggering a fetch. Lets the
 * front door paint the RIGHT door on first render (no neutral flash) when the
 * door is already known for this origin; returns `null` for a genuine cold
 * first visit, where the caller shows the neutral state until
 * `getDoorDescriptor` resolves.
 */
export function peekDoorDescriptor(): DoorDescriptor | null {
  if (cache === undefined) {
    const persisted = readPersisted();
    if (persisted !== undefined) cache = persisted;
  }
  return cache ?? null;
}

/** Test-only: clear the in-module memo + revalidation state (localStorage is
 *  cleared by the test's own `localStorage.clear()` in `beforeEach`). */
export function __resetDoorDescriptorCacheForTests(): void {
  cache = undefined;
  inflight = null;
  revalidationStarted = false;
  revalidationDone = false;
  revalidateListeners.clear();
}
