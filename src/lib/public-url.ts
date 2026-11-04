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
 * A card's link, `<origin>/c/<ref>`, where `ref` is its key (AB-142) or, for a
 * card without one, its id. Both stay valid: a card that moves product gets a
 * new key and still answers to the old one, and /c/ takes either.
 */
export function cardUrl(origin: string, ref: number | string): string {
  return `${origin}/c/${encodeURIComponent(String(ref))}`;
}

type CardRow = {
  id: number | string;
  key?: string | null;
  number?: number | null;
  product_key?: string | null;
} & Record<string, unknown>;

/**
 * What a card's link names: the key the server put on the row, else one built
 * from the row's product key (cross-product views) or `productKey` (the board
 * the rows came from) and its number, else the id. Mirrors `cardKey` in
 * cards.ts, which the web app's Copy link uses.
 */
function cardRef(row: CardRow, productKey?: string | null): number | string {
  if (row.key) return row.key;
  const prefix = row.product_key || productKey;
  return prefix && row.number ? `${prefix}-${row.number}` : row.id;
}

/**
 * Add `url` to a card or a list of cards in an API response. Anything that
 * isn't a card (null, an error body) is returned unchanged. Pass `productKey`
 * when the rows come from one product and don't carry its key themselves.
 */
export function withCardUrl<T>(request: Request, data: T, productKey?: string | null): T {
  const origin = publicOrigin(request);
  const add = (row: unknown) =>
    row && typeof row === "object" && "id" in row
      ? { ...(row as CardRow), url: cardUrl(origin, cardRef(row as CardRow, productKey)) }
      : row;
  return (Array.isArray(data) ? data.map(add) : add(data)) as T;
}
