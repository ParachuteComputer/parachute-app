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
 */
export function loadAccountToken(): string | null {
  try {
    return sessionStorage.getItem(ACCOUNT_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveAccountToken(token: string): void {
  try {
    sessionStorage.setItem(ACCOUNT_TOKEN_KEY, token);
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
 * Reactive hosted-session state for the app-wide, NON-BLOCKING "your sign-in
 * ended" banner (SYNTHESIS weather #12). Set when a hosted call 401s; reading
 * notes is never blocked — the banner just invites re-signing to keep syncing.
 */
interface AccountSessionState {
  expired: boolean;
  markExpired: () => void;
  clearExpired: () => void;
}

export const useAccountSessionStore = create<AccountSessionState>((set) => ({
  expired: false,
  markExpired: () => set({ expired: true }),
  clearExpired: () => set({ expired: false }),
}));
