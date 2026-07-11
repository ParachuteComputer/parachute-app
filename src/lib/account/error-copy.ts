/**
 * Human copy for the account-API's vault-surface errors (F12). The server
 * (`account-api.ts`'s `restError`) already sends a friendly `message`
 * alongside its machine `error` code, and `client.ts`'s `jsonOrThrow` now
 * prefers that message — so most of the time `err.message` here is ALREADY
 * prose ("That vault name is already taken."). This is the belt-and-suspenders
 * layer for what that root-cause fix doesn't cover: a bare wire code with no
 * accompanying message (an older/self-hosted response shape), or a code this
 * app doesn't recognize yet. Never renders a raw `snake_case` code to a user.
 */

const KNOWN_VAULT_ERROR_COPY: Record<string, string> = {
  vault_taken: "That name's already taken — try another.",
  vault_limit_reached:
    "You've reached your plan's vault limit. Upgrade your plan, or free one up first.",
  invalid_name: "Use 2–63 characters: lowercase letters, numbers, and hyphens.",
  reserved: "That name is reserved — pick a different one.",
  not_owner: "That vault isn't linked to this account.",
  not_found: "That vault couldn't be found.",
  invalid_scope: "Couldn't open that vault — try again.",
  not_implemented: "That isn't available yet.",
};

const GENERIC_FALLBACK = "Something went wrong. Try again.";

/** A bare wire code — snake_case, no spaces or sentence punctuation — never
 *  reads as human copy, so it's the signal that `message` needs mapping (or
 *  the generic fallback) rather than being shown verbatim. */
function looksLikeWireCode(text: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(text);
}

/**
 * Describe an account-API error as calm, human copy. Prose messages (spaces,
 * punctuation) pass through unchanged; a bare code maps to known copy or the
 * `fallback` (defaults to a generic "something went wrong").
 */
export function describeAccountError(err: unknown, fallback = GENERIC_FALLBACK): string {
  if (!(err instanceof Error)) return fallback;
  const raw = err.message.trim();
  if (!raw) return fallback;
  if (looksLikeWireCode(raw)) {
    return KNOWN_VAULT_ERROR_COPY[raw] ?? fallback;
  }
  return raw;
}
