import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDoorDescriptorCacheForTests, getDoorDescriptor } from "./descriptor";

// HUB-PARITY P4 — the door descriptor is the ONE fetch that tells the app
// which kind of door it's being served by. Fallback rule under test: ANY
// failure (404 / network error / garbage body) degrades to `null`, which
// callers (Landing's FrontDoor, Welcome's address echo) treat identically to
// "no descriptor / no auth block" — today's magic-link behavior.

const STORAGE_KEY = "parachute:door-descriptor";

function res(body: unknown, status = 200): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  sessionStorage.clear();
  __resetDoorDescriptorCacheForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
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

  it("absent auth block → still a valid (magic-link-fallback) descriptor", async () => {
    const descriptor = { door: "cloud" };
    const fetchImpl = vi.fn<typeof fetch>(async () => res(descriptor));
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual(descriptor);
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

  it("persists the resolved value to sessionStorage under the pinned key", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => res({ door: "hub" }));
    await getDoorDescriptor(fetchImpl);
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null")).toEqual({ door: "hub" });
  });

  it("persists a null resolution too (so a returning tab doesn't re-fetch a no-descriptor door)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => res({}, 404));
    await getDoorDescriptor(fetchImpl);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("null");
  });

  it("reuses a sessionStorage cache entry without re-fetching (a fresh module load, e.g. hard reload)", async () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ door: "cloud" }));
    const fetchImpl = vi.fn<typeof fetch>(async () => res({ door: "hub" }));
    await expect(getDoorDescriptor(fetchImpl)).resolves.toEqual({ door: "cloud" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
