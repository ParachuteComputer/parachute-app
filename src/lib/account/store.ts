import { create } from "zustand";

// Local persistence for the hosted account flow. Storage keys stay in the
// frozen `lens:*` namespace (origin-isolated, shared machinery).
const LAST_EMAIL_KEY = "lens:last_signin_email";
const ACCOUNT_TOKEN_KEY = "lens:account_token";

/** The email a person last signed in with — pre-fills the front door + the
 *  expired-link resend, so a returning visitor never retypes it. */
export function loadLastSigninEmail(): string | null {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY);
  } catch {
    return null;
  }
}

export function saveLastSigninEmail(email: string): void {
  try {
    const trimmed = email.trim();
    if (trimmed) localStorage.setItem(LAST_EMAIL_KEY, trimmed);
  } catch {
    // best-effort
  }
}

/**
 * The full account token (C2, `account:<session-user>:admin`) the app holds to
 * drive account management (plan/usage/settings — PR-2). Session-scoped
 * (sessionStorage): it's re-minted from the session cookie on demand, so it
 * never needs to outlive the tab, and it isn't a long-lived secret at rest.
 *
 * AUTH-W2 move 2: cached WITH the identity (`email ?? username`) it was
 * minted for, as `{ token, identity }` — a bare-token cache can't outlive the
 * cookie's, because nothing in it says WHICH account the token belongs to.
 * `client.ts`'s `getSession()` compares this identity against every fresh
 * session read and drops the cache on a mismatch (another tab switched
 * accounts). An old bare-token entry (pre-this-shape) fails the JSON parse
 * and reads as absent — a silent one-time re-mint, no user-visible effect.
 */
interface StoredAccountToken {
  token: string;
  /** `null` when the door named neither `email` nor `username` (shouldn't
   *  happen server-side, but tolerated rather than refusing to cache). */
  identity: string | null;
}

function loadStoredAccountToken(): StoredAccountToken | null {
  try {
    const raw = sessionStorage.getItem(ACCOUNT_TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { token?: unknown }).token === "string"
    ) {
      const identity = (parsed as { identity?: unknown }).identity;
      return {
        token: (parsed as { token: string }).token,
        identity: typeof identity === "string" ? identity : null,
      };
    }
    return null; // a shape we don't recognize — treat as absent, re-mint
  } catch {
    return null; // pre-migration bare-token string (not JSON) — absent
  }
}

export function loadAccountToken(): string | null {
  return loadStoredAccountToken()?.token ?? null;
}

/** The identity the cached token was minted for, or `null` if nothing (or a
 *  pre-migration bare token) is cached. `client.ts` reconciles this against
 *  every fresh `GET /account/session` read. */
export function loadAccountIdentity(): string | null {
  return loadStoredAccountToken()?.identity ?? null;
}

export function saveAccountToken(token: string, identity: string | null = null): void {
  try {
    sessionStorage.setItem(ACCOUNT_TOKEN_KEY, JSON.stringify({ token, identity }));
  } catch {
    // best-effort
  }
}

export function clearAccountToken(): void {
  try {
    sessionStorage.removeItem(ACCOUNT_TOKEN_KEY);
  } catch {
    // best-effort
  }
}

/**
 * HUB-PARITY P4 — the hub's two extra, non-blocking gates (design §2 row 4):
 * `force_change_password` (an operator-provisioned account still on its
 * initial password) and `admin_locked` (the admin screen is locked). Cloud
 * never triggers either. Both are weather, never a wall — reading local notes
 * is never gated on them.
 */
export type HubGate = "force_change_password" | "admin_locked";

/**
 * Reactive hosted-session state for the app-wide, NON-BLOCKING "your sign-in
 * ended" banner (SYNTHESIS weather #12). Set when a hosted call 401s; reading
 * notes is never blocked — the banner just invites re-signing to keep syncing.
 */
interface AccountSessionState {
  expired: boolean;
  markExpired: () => void;
  clearExpired: () => void;
  /** See `HubGate` — set by the boot dispatcher / Account surface. */
  gate: HubGate | null;
  markGate: (gate: HubGate) => void;
  clearGate: () => void;
  /**
   * AUTH-W2 move 2: bumped whenever `client.ts`'s `getSession()` finds the
   * session cookie now naming a DIFFERENT identity than the cached account
   * bearer (another tab signed out/in as someone else) — the moment the
   * bearer + its cache get dropped. Ambient vault/summary reads
   * (`use-summary.ts`, `VaultSwitcher.tsx`) fold this into their query key so
   * a stale identity's cached rows can't linger past the switch; `Account.tsx`
   * re-resolves its own "Signed in as" + vault list off it too.
   */
  identityEpoch: number;
  bumpIdentityEpoch: () => void;
}

export const useAccountSessionStore = create<AccountSessionState>((set) => ({
  expired: false,
  markExpired: () => set({ expired: true }),
  clearExpired: () => set({ expired: false }),
  gate: null,
  markGate: (gate) => set({ gate }),
  clearGate: () => set({ gate: null }),
  identityEpoch: 0,
  bumpIdentityEpoch: () => set((s) => ({ identityEpoch: s.identityEpoch + 1 })),
}));
