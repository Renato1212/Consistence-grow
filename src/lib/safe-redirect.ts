/**
 * Only allow same-origin relative paths as post-login destinations
 * (blocks open redirects such as `//evil.com` or `https://…`).
 */
export function safeNextPath(next: string | null | undefined, fallback = "/today"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
