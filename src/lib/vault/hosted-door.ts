import { beginOAuth } from "./oauth";

/**
 * The hosted door — the cloud account issuer.
 *
 * Sign-in / account-creation for the hosted product runs against this origin's
 * OAuth ceremony (magic-link), so a visitor never has to type a URL. It's a
 * live OAuth 2.1 authorization server today (`/.well-known/oauth-authorization-server`
 * advertises authorize/token/register + PKCE S256 + DCR). Overridable via
 * `VITE_HOSTED_DOOR_ORIGIN` for staging/dev.
 */
export const HOSTED_DOOR_ORIGIN = (
  (import.meta.env as { VITE_HOSTED_DOOR_ORIGIN?: string } | undefined)?.VITE_HOSTED_DOOR_ORIGIN ??
  "https://cloud.parachute.computer"
).replace(/\/$/, "");

/** Where a completed hosted sign-in lands: the first-run naming onboarding. */
export const HOSTED_WELCOME_PATH = "/welcome";

/**
 * Begin hosted sign-in / account creation against the hosted door.
 *
 * Reuses the app's OAuth 2.1 + PKCE + DCR machinery (`beginOAuth`): the door
 * presents its magic-link ceremony, which naturally unifies **new** (a fresh
 * email creates the account) and **returning** (an existing email signs in).
 * The email rides as an OAuth `login_hint` so the ceremony can pre-fill it —
 * the ceremony remains authoritative. On return, `OAuthCallback` honors the
 * `redirect` we stash and lands the user on `/welcome` (first-run naming).
 *
 * Redirects the browser to the authorize URL (does not return on success).
 */
export async function beginHostedSignin(
  email: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
  assign: (url: string) => void = (url) => window.location.assign(url),
): Promise<void> {
  const hint = email.trim();
  const { authorizeUrl } = await beginOAuth(HOSTED_DOOR_ORIGIN, undefined, fetchImpl, {
    params: hint ? { login_hint: hint } : {},
    redirect: HOSTED_WELCOME_PATH,
  });
  assign(authorizeUrl);
}
