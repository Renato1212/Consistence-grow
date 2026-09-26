/**
 * Same-origin redirect with a relative Location header. Avoids rebuilding an
 * absolute URL from the request host, which can differ behind proxies
 * (e.g. localhost vs 127.0.0.1) and trip CSP `form-action`.
 */
export function relativeRedirect(path: string, status: 302 | 303 = 303): Response {
  return new Response(null, { status, headers: { Location: path } });
}
