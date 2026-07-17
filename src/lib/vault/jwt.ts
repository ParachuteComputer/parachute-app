// A minimal, DISPLAY-ONLY JWT payload decode — no signature verification,
// because none is needed: the only consumer (views' save-sheet ownership
// default, VIEWS-RENDER-SPEC §5) reads the access token's own `sub` claim to
// answer "is this the same person who's about to click Save," never a
// security decision. The vault is still the authority on every actual write.
export function decodeJwtSub(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    const decoded: unknown = JSON.parse(json);
    const sub = (decoded as { sub?: unknown } | null)?.sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}
