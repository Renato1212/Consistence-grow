/**
 * Personal API tokens for integrations (e.g. the daily Macro Desk brief).
 * Generated in the browser, shown once, stored only as a SHA-256 hash.
 */
export const TOKEN_PREFIX = "cg_";

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return TOKEN_PREFIX + base64url(bytes);
}

/** Lowercase hex SHA-256 — identical to `encode(sha256(convert_to(t,'UTF8')),'hex')` in Postgres. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Shown in the token list so tokens can be told apart ("cg_AbC1…"). */
export function tokenPrefix(token: string): string {
  return `${token.slice(0, 7)}…`;
}
