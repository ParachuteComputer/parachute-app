import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DoorDescriptor,
  __resetDoorDescriptorCacheForTests,
  getDoorDescriptor,
  peekDoorDescriptor,
  retryDoorDescriptorIfCold,
} from "./descriptor";

// HUB-PARITY P4 — the door descriptor is the ONE fetch that tells the app
// which kind of door it's being served by. Fallback rule under test: ANY
// failure (404 / network error / garbage body) resolves to `null`, which
// callers (Landing's FrontDoor, Welcome's address echo) treat as "no door
// known" ⇒ the door-NEUTRAL shell (see descriptor.ts's header rule), never a
// defaulted door.

// Durable cache is per-origin localStorage now (Fix 2). Key derived exactly as
// descriptor.ts does, so a test can seed / assert the persisted entry.
const STORAGE_KEY = `parachute:door-descriptor:${window.location.origin}`;

function res(body: unknown, status = 200): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "content-type": "application/json" } });
}

// Let the fire-and-forget background revalidation settle (a macrotask drains
// the fetch → adopt/persist → notify microtask chain).
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  __resetDoorDescriptorCacheForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  __resetDoorDescriptorCacheForTests();
});

describe("getDoorDescriptor", () => {
  it("200 with a full shape → returns it verbatim", async () => {
    const descriptor = {
      door: "hub",
      auth: { methods: ["password"], signin_path: "/login" },
      signup_path: "/signup",
      vault_url_template: "https://hub.example/vault/{name}",
    };
    const fetchImpl = vi.fn<typeof fetch>(async () => res(descriptor));
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual(descriptor);
    expect(fetchImpl).toHaveBeenCalledWith("/.well-known/parachute-account");
  });

  it("404 → null", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => res({ error: "not found" }, 404));
    await expect(getDoorDescriptor(fetchImpl)).resolves.toBeNull();
  });

  it("network failure (rejected fetch) → null", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("network error");
    });
    await expect(getDoorDescriptor(fetchImpl)).resolves.toBeNull();
  });

  it("garbage (non-JSON) body → null", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response("<html>not json</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    await expect(getDoorDescriptor(fetchImpl)).resolves.toBeNull();
  });

  it("absent auth block → descriptor passes through verbatim (auth is optional)", async () => {
    const descriptor = { door: "cloud" };
    const fetchImpl = vi.fn<typeof fetch>(async () => res(descriptor));
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual(descriptor);
  });

  // A door we don't control could serve a well-formed body with a MALFORMED
  // `auth` — the front door would then throw (white screen, no ErrorBoundary)
  // or hop to "undefined?next=…". The guard DROPS a bad `auth` (keeping the rest
  // of the descriptor) so the front door classifies on what's left (⇒ neutral
  // when nothing usable remains) rather than crashing.
  it("malformed auth (methods not an array) → auth dropped, rest kept", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      res({ door: "hub", auth: { methods: 5, signin_path: "/login" }, signup_path: "/s" }),
    );
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({ door: "hub", signup_path: "/s" });
  });

  it("empty auth object ({}) → auth dropped (no undefined signin_path hop)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => res({ door: "hub", auth: {} }));
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({ door: "hub" });
  });

  it("auth.signin_path not an absolute path → auth dropped", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      res({ door: "hub", auth: { methods: ["password"], signin_path: "login" } }),
    );
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({ door: "hub" });
  });

  it("auth with an UNRECOGNIZED method (but valid shape) → kept (forward-compat: hop, don't fall back)", async () => {
    // A door advertising a method we don't know (passkey) is still crash-safe
    // (string methods + absolute signin_path), so we keep it — the front door
    // hops to the door's own sign-in page rather than falling back to neutral.
    const descriptor = { door: "hub", auth: { methods: ["passkey"], signin_path: "/login" } };
    const fetchImpl = vi.fn<typeof fetch>(async () => res(descriptor));
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual(descriptor);
  });

  it("auth.methods containing a non-string → auth dropped", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      res({ door: "hub", auth: { methods: ["password", 7], signin_path: "/login" } }),
    );
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({ door: "hub" });
  });

  it("a non-object body (e.g. a JSON array) → null", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => res([1, 2, 3]));
    await expect(getDoorDescriptor(fetchImpl)).resolves.toBeNull();
  });

  // The Billing section renders `plans.map((p) => p.id …)`. A door we don't
  // control serving a non-array `plans` (`.map` throws) or an array with a
  // null/primitive element (`.id` throws) would white-screen the app (no
  // ErrorBoundary). The guard DROPS a malformed `plans` the same way it drops
  // a malformed `auth`, keeping the rest of the descriptor intact.
  it("malformed plans (not an array) → plans dropped, rest kept", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => res({ door: "cloud", plans: "nope" }));
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({ door: "cloud" });
  });

  it("malformed plans (array containing null) → plans dropped, rest kept", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      res({ door: "cloud", plans: [{ id: "entry", name: "Entry" }, null] }),
    );
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({ door: "cloud" });
  });

  it("malformed plans (array of primitives) → plans dropped, rest kept", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => res({ door: "cloud", plans: [1, 2, 3] }));
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({ door: "cloud" });
  });

  it("a clean plans array of objects → kept verbatim", async () => {
    const descriptor = {
      door: "cloud",
      plans: [
        { id: "entry", name: "Entry", vaults: 1, price_month: 0 },
        { id: "standard", name: "Standard", vaults: 3, price_month: 5 },
      ],
    };
    const fetchImpl = vi.fn<typeof fetch>(async () => res(descriptor));
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual(descriptor);
  });

  it("drops a malformed plans even when auth is valid (both blocks guarded independently)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      res({
        door: "hub",
        auth: { methods: ["password"], signin_path: "/login" },
        plans: "nope",
      }),
    );
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({
      door: "hub",
      auth: { methods: ["password"], signin_path: "/login" },
    });
  });

  it("memoizes in-module — one fetch across concurrent + sequential callers", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => res({ door: "hub" }));
    const [a, b] = await Promise.all([getDoorDescriptor(fetchImpl), getDoorDescriptor(fetchImpl)]);
    expect(a).toEqual({ door: "hub" });
    expect(b).toEqual({ door: "hub" });
    const c = await getDoorDescriptor(fetchImpl);
    expect(c).toEqual({ door: "hub" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("persists the resolved (non-null) door to localStorage under the per-origin key", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => res({ door: "hub" }));
    await getDoorDescriptor(fetchImpl);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual({ door: "hub" });
  });

  it("NEVER persists a null (fetch failure / no-door) to localStorage", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => res({}, 404));
    await getDoorDescriptor(fetchImpl);
    await flush();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  // Stale-while-revalidate: a known door from localStorage paints IMMEDIATELY,
  // and the background refetch (which found a DIFFERENT door here) notifies via
  // onRevalidate.
  it("paints a known door from localStorage immediately, then revalidates on change", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ door: "cloud" }));
    const seen: (unknown | null)[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      res({ door: "hub", auth: { methods: ["password"], signin_path: "/login" } }),
    );
    const first = await getDoorDescriptor(fetchImpl, (d) => seen.push(d));
    // Painted the cached (stale) door without waiting on the network.
    expect(first).toEqual({ door: "cloud" });
    // Background revalidation swapped in the changed door.
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ door: "hub", auth: { methods: ["password"], signin_path: "/login" } }]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual({
      door: "hub",
      auth: { methods: ["password"], signin_path: "/login" },
    });
  });

  it("does NOT notify onRevalidate when the refetch confirms the same door", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ door: "cloud" }));
    const seen: (unknown | null)[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async () => res({ door: "cloud" }));
    const first = await getDoorDescriptor(fetchImpl, (d) => seen.push(d));
    expect(first).toEqual({ door: "cloud" });
    await flush();
    expect(seen).toEqual([]);
  });

  // The offline self-heal: a known hub door SURVIVES a subsequent fetch failure
  // — never overwritten, never cleared, never downgraded to null.
  it("a known door survives a fetch FAILURE (not overwritten, cache + localStorage intact)", async () => {
    const hub = { door: "hub", auth: { methods: ["password"], signin_path: "/login" } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hub));
    const seen: (unknown | null)[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("offline");
    });
    const first = await getDoorDescriptor(fetchImpl, (d) => seen.push(d));
    expect(first).toEqual(hub);
    await flush();
    // Failure ignored: no notify, storage unchanged.
    expect(seen).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual(hub);
    // A subsequent read still returns the known door.
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual(hub);
  });

  // Offline COLD-launch: descriptor unfetchable but a previously-known hub is in
  // localStorage → still hub (no cloud flash).
  it("offline cold-launch → paints the previously-known hub from localStorage (no null flash)", async () => {
    const hub = { door: "hub", auth: { methods: ["password"], signin_path: "/login" } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hub));
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("offline");
    });
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual(hub);
  });

  // #81 item (c): a cold-boot MISS otherwise pins NEUTRAL for the SPA lifetime
  // (the revalidation runs once). `retryDoorDescriptorIfCold` re-arms it so a
  // later front-door mount refetches and the door self-heals without a reload.
  describe("retryDoorDescriptorIfCold (cold-miss self-heal)", () => {
    it("re-arms after a cold MISS so the next resolve refetches + heals the door via onRevalidate", async () => {
      const hub = { door: "hub", auth: { methods: ["password"], signin_path: "/login" } };
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(res({ error: "down" }, 503))
        .mockResolvedValueOnce(res(hub));

      // Cold boot: the fetch fails → door resolves NEUTRAL (null), pass finishes.
      await expect(getDoorDescriptor(fetchImpl)).resolves.toBeNull();
      await flush();
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      // A fresh front-door mount re-arms the once-per-lifetime revalidation, so
      // the next resolve kicks a new fetch; the found door arrives via onRevalidate.
      retryDoorDescriptorIfCold();
      const seen: (DoorDescriptor | null)[] = [];
      await getDoorDescriptor(fetchImpl, (d) => seen.push(d));
      await flush();
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(seen).toEqual([hub]);

      // Once a door is KNOWN the retry is inert — no re-fetch, stable per-origin.
      retryDoorDescriptorIfCold();
      await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual(hub);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("is a no-op while a door is already known (does not re-fetch a stable door)", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => res({ door: "cloud" }));
      await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({ door: "cloud" });
      await flush();
      retryDoorDescriptorIfCold();
      await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({ door: "cloud" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  // Per-origin keying: a door cached for origin A must not leak into origin B.
  it("per-origin keying — a hub cached at one origin does not contaminate another", async () => {
    const otherOrigin = "https://cloud.example.com";
    const hub = { door: "hub", auth: { methods: ["password"], signin_path: "/login" } };
    // Seed origin A (the OTHER origin's key), then read as origin B (the test's
    // live origin) — the two keys must not collide.
    localStorage.setItem(`parachute:door-descriptor:${otherOrigin}`, JSON.stringify(hub));
    const fetchImpl = vi.fn<typeof fetch>(async () => res({ door: "cloud" }));
    // Live-origin read sees NO seed → fetches cloud.
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({ door: "cloud" });
    await flush();
    // The other origin's entry is untouched.
    expect(
      JSON.parse(localStorage.getItem(`parachute:door-descriptor:${otherOrigin}`) ?? "null"),
    ).toEqual(hub);
  });

  describe("peekDoorDescriptor (synchronous warm-cache read)", () => {
    it("returns the localStorage door synchronously (no fetch)", () => {
      const hub = { door: "hub", auth: { methods: ["password"], signin_path: "/login" } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hub));
      expect(peekDoorDescriptor()).toEqual(hub);
    });

    it("returns null on a cold first visit (nothing known)", () => {
      expect(peekDoorDescriptor()).toBeNull();
    });
  });

  // F1/F3/F5 — cloud now publishes per-interval pricing on each plan row.
  // `UpgradePlans` reads `plan.intervals[cycle].available/.price/.label`, so a
  // malformed sub-block is guarded the same way `auth`/`plans` are: dropped
  // rather than trusted, but scoped to the ONE plan/cycle it's bad on.
  describe("per-plan `intervals` (F1/F3/F5)", () => {
    it("a plan with no `intervals` field at all → kept verbatim (the degrade-gracefully case)", async () => {
      const descriptor = {
        door: "cloud",
        plans: [{ id: "entry", name: "Entry", vaults: 1, price_month: 1 }],
      };
      const fetchImpl = vi.fn<typeof fetch>(async () => res(descriptor));
      await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual(descriptor);
    });

    it("a well-formed `intervals` block (mixed available/unavailable) → kept verbatim", async () => {
      const descriptor = {
        door: "cloud",
        plans: [
          {
            id: "entry",
            name: "Entry",
            vaults: 1,
            price_month: 1,
            intervals: {
              monthly: { available: false },
              quarterly: { available: true, price: 3, label: "$3/quarter" },
              yearly: { available: true, price: 10, label: "$10/yr" },
            },
          },
        ],
      };
      const fetchImpl = vi.fn<typeof fetch>(async () => res(descriptor));
      await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual(descriptor);
    });

    it("malformed `intervals` (not an object) → dropped, rest of the plan kept", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        res({
          door: "cloud",
          plans: [{ id: "entry", name: "Entry", vaults: 1, price_month: 1, intervals: "nope" }],
        }),
      );
      await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({
        door: "cloud",
        plans: [{ id: "entry", name: "Entry", vaults: 1, price_month: 1 }],
      });
    });

    it("malformed `intervals` (an array) → dropped, rest of the plan kept", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        res({
          door: "cloud",
          plans: [{ id: "entry", name: "Entry", intervals: [{ available: true }] }],
        }),
      );
      await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({
        door: "cloud",
        plans: [{ id: "entry", name: "Entry" }],
      });
    });

    it("one malformed cycle entry (bad `available` type) is dropped without losing sibling cycles", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        res({
          door: "cloud",
          plans: [
            {
              id: "entry",
              name: "Entry",
              intervals: {
                monthly: { available: "yes" }, // malformed — dropped
                quarterly: { available: true, price: 3, label: "$3/quarter" }, // kept
              },
            },
          ],
        }),
      );
      await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({
        door: "cloud",
        plans: [
          {
            id: "entry",
            name: "Entry",
            intervals: { quarterly: { available: true, price: 3, label: "$3/quarter" } },
          },
        ],
      });
    });

    it("a non-numeric `price` on an otherwise-valid cycle entry → that cycle dropped", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        res({
          door: "cloud",
          plans: [
            {
              id: "entry",
              name: "Entry",
              intervals: { quarterly: { available: true, price: "3" } },
            },
          ],
        }),
      );
      await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({
        door: "cloud",
        plans: [{ id: "entry", name: "Entry" }],
      });
    });

    it("every cycle entry malformed → `intervals` drops entirely, plan otherwise intact", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        res({
          door: "cloud",
          plans: [
            {
              id: "entry",
              name: "Entry",
              price_month: 1,
              intervals: { monthly: "nope", quarterly: 5 },
            },
          ],
        }),
      );
      await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({
        door: "cloud",
        plans: [{ id: "entry", name: "Entry", price_month: 1 }],
      });
    });

    it("sanitizes `intervals` independently per plan in a multi-plan ladder", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        res({
          door: "cloud",
          plans: [
            { id: "entry", name: "Entry", intervals: "nope" },
            {
              id: "standard",
              name: "Standard",
              intervals: { monthly: { available: true, price: 5, label: "$5/mo" } },
            },
          ],
        }),
      );
      await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({
        door: "cloud",
        plans: [
          { id: "entry", name: "Entry" },
          {
            id: "standard",
            name: "Standard",
            intervals: { monthly: { available: true, price: 5, label: "$5/mo" } },
          },
        ],
      });
    });
  });
});
