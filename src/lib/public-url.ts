/**
 * The host a client used to reach us. Behind a reverse proxy that does not
 * preserve `Host` (nginx's `proxy_pass` rewrites it to the upstream by
 * default), `Host` is something like `localhost:3000` while the browser's
 * `Origin` is the real domain.
 *
 * `X-Forwarded-Host` is proxy-set. A browser cannot add it to a cross-origin
 * request without a CORS preflight we never approve, so the origin check in
 * middleware can trust it; a direct API client that sets it only changes the
 * links in its own responses.
 */
export function publicHost(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) return forwardedHost.split(",")[0].trim();
  return request.headers.get("host") ?? new URL(request.url).host;
}

/** The scheme the client used: the proxy's first hop, else the request's own. */
function publicProtocol(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase();
  if (forwarded === "http" || forwarded === "https") return forwarded;
  return new URL(request.url).protocol.replace(/:$/, "");
}

/**
 * This server's public origin as the caller sees it, e.g.
 * `https://board.example.com`. A host header that can't form a URL falls back
 * to the address the request arrived on rather than failing the response.
 */
export function publicOrigin(request: Request): string {
  try {
    const origin = new URL(`${publicProtocol(request)}://${publicHost(request)}`).origin;
    if (origin !== "null") return origin;
  } catch {
    // fall through
  }
  return new URL(request.url).origin;
}

/**
 * A card's permanent link, `<origin>/c/<id>`. The id never changes, while a
 * readable key changes when the card moves product (old keys still resolve,
 * but the id is the one every CLI command and API route also takes).
 */
export function cardUrl(origin: string, id: number | string): string {
  return `${origin}/c/${encodeURIComponent(String(id))}`;
}

type CardRow = { id: number | string } & Record<string, unknown>;

/**
 * Add `url` to a card or a list of cards in an API response. Anything that
 * isn't a card (null, an error body) is returned unchanged.
 */
export function withCardUrl<T>(request: Request, data: T): T {
  const origin = publicOrigin(request);
  const add = (row: unknown) =>
    row && typeof row === "object" && "id" in row
      ? { ...(row as CardRow), url: cardUrl(origin, (row as CardRow).id) }
      : row;
  return (Array.isArray(data) ? data.map(add) : add(data)) as T;
}
