import { getSession, listVaults, mintAccountToken } from "./client";
import { saveAccountToken, saveLastSigninEmail } from "./store";
import type { AccountVault } from "./types";

type Fetch = typeof fetch;

/**
 * The post-sign-in branch (SYNTHESIS #4): a signed-in person is dispatched by
 * their vault count. Pure — the `/welcome` dispatcher renders the matching
 * screen (first-vault naming / welcome-back beat / picker).
 */
export type PostSignInBranch =
  | { kind: "first-vault" }
  | { kind: "welcome-back"; vault: AccountVault }
  | { kind: "picker"; vaults: AccountVault[] };

/** `[]`→create your first, one→open it (welcome-back beat), many→pick. */
export function classifyVaults(vaults: AccountVault[]): PostSignInBranch {
  if (vaults.length === 0) return { kind: "first-vault" };
  if (vaults.length === 1 && vaults[0]) return { kind: "welcome-back", vault: vaults[0] };
  return { kind: "picker", vaults };
}

/**
 * The boot decision at `/` (SYNTHESIS "boot dispatcher", Aaron's confusion #2:
 * a signed-in person never gets sent to an auth screen). Precedence:
 *
 *   1. a vault is already connected on THIS device → straight to Home (no
 *      network — the notes layer owns it);
 *   2. else ask the hosted door `GET /account/session`:
 *        - signed out → the front door;
 *        - signed in → mint the account token (C2, for the manager surface) +
 *          list the account's vaults → hand both to the caller.
 *   3. network failure fetching vaults while signed in → the net-error weather
 *      ("you're signed in, we just couldn't fetch your vaults").
 *
 * A signed-out `GET /account/session` network failure degrades to the front
 * door (safe: the person can still act). `resolveBoot` performs the side
 * effects the flow needs (persist the account token + last-signin email); the
 * branch logic (`classifyVaults`) stays pure for testing.
 */
export type BootDecision =
  | { kind: "home" }
  | { kind: "front-door" }
  | { kind: "signed-in"; email?: string; vaults: AccountVault[] }
  | { kind: "net-error"; message: string };

export async function resolveBoot({
  hasLocalActiveVault,
  fetchImpl = fetch.bind(globalThis),
}: {
  hasLocalActiveVault: boolean;
  fetchImpl?: Fetch;
}): Promise<BootDecision> {
  if (hasLocalActiveVault) return { kind: "home" };

  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession(fetchImpl);
  } catch {
    // Can't reach the door — show the front door (the person can still act).
    return { kind: "front-door" };
  }

  if (!session.signed_in) return { kind: "front-door" };

  if (session.email) saveLastSigninEmail(session.email);
  // Mint the account token (C2) for the manager surface. Best-effort for the
  // dispatch itself — the vault list is cookie-authed, so a C2 hiccup shouldn't
  // strand a signed-in person.
  try {
    const account = await mintAccountToken(session.csrf, fetchImpl);
    saveAccountToken(account.access_token);
  } catch {
    // non-fatal for dispatch
  }

  try {
    const { vaults } = await listVaults(fetchImpl);
    return { kind: "signed-in", email: session.email, vaults };
  } catch (err) {
    return { kind: "net-error", message: err instanceof Error ? err.message : "Unknown error" };
  }
}
