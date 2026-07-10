import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOSTED_DOOR_ORIGIN, HOSTED_WELCOME_PATH, beginHostedSignin } from "./hosted-door";
import { loadPendingOAuth } from "./storage";

// A valid OAuth authorization-server document for the hosted door.
const validMetadata = {
  issuer: HOSTED_DOOR_ORIGIN,
  authorization_endpoint: `${HOSTED_DOOR_ORIGIN}/oauth/authorize`,
  token_endpoint: `${HOSTED_DOOR_ORIGIN}/oauth/token`,
  registration_endpoint: `${HOSTED_DOOR_ORIGIN}/oauth/register`,
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"],
  grant_types_supported: ["authorization_code"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: ["vault:read", "vault:write"],
};

const clientReg = {
  client_id: "hosted-client-1",
  redirect_uris: ["http://localhost:3000/oauth/callback"],
};

function mockFetch(responses: Array<{ json?: unknown }>) {
  const queue = [...responses];
  return vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected fetch call");
    return { ok: true, status: 200, json: async () => next.json, text: async () => "" } as Response;
  });
}

describe("beginHostedSignin", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, "", "http://localhost:3000/");
  });

  it("begins OAuth against the hosted door with the email hint + /welcome redirect", async () => {
    const fetchImpl = mockFetch([{ json: validMetadata }, { json: clientReg }]);
    const assign = vi.fn();

    await beginHostedSignin("moss@example.com", fetchImpl, assign);

    expect(assign).toHaveBeenCalledTimes(1);
    const url = new URL(assign.mock.calls[0]?.[0] as string);
    // Reuses the app's OAuth/PKCE machinery, pointed at the hosted door.
    expect(url.origin + url.pathname).toBe(`${HOSTED_DOOR_ORIGIN}/oauth/authorize`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_type")).toBe("code");
    // The email rides as a login_hint so the ceremony can pre-fill it.
    expect(url.searchParams.get("login_hint")).toBe("moss@example.com");

    // The completed sign-in lands on the first-run naming onboarding.
    const pending = loadPendingOAuth();
    expect(pending?.redirect).toBe(HOSTED_WELCOME_PATH);
    expect(pending?.issuer).toBe(HOSTED_DOOR_ORIGIN);
  });

  it("omits login_hint when the email is blank", async () => {
    const fetchImpl = mockFetch([{ json: validMetadata }, { json: clientReg }]);
    const assign = vi.fn();

    await beginHostedSignin("   ", fetchImpl, assign);

    const url = new URL(assign.mock.calls[0]?.[0] as string);
    expect(url.searchParams.has("login_hint")).toBe(false);
    expect(loadPendingOAuth()?.redirect).toBe(HOSTED_WELCOME_PATH);
  });
});
