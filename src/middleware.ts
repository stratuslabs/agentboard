import { NextRequest, NextResponse } from "next/server";
import { getSessionCookieName, isAuthenticatedFromRequest } from "@/lib/auth";
import { clientKey, FailureThrottle } from "@/lib/rate-limit";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Every route behind this middleware accepts `Authorization: Bearer <password>`,
// so the auth boundary — not just the login form — is where guesses have to be
// counted. Throttling only the login route would leave `GET /api/orgs` as an
// unmetered password oracle.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;
const throttle = new FailureThrottle(MAX_ATTEMPTS, WINDOW_MS);

/**
 * The public host as the browser sees it. Behind a reverse proxy that does not
 * preserve `Host` (nginx's `proxy_pass` rewrites it to the upstream by
 * default), `Host` is something like `localhost:3000` while the browser's
 * `Origin` is the real domain — comparing against `Host` alone would 403 every
 * write on a correctly configured self-hosted install.
 *
 * `X-Forwarded-Host` is proxy-set. A browser cannot add it to a cross-origin
 * request without a CORS preflight we never approve, so trusting it here does
 * not weaken the check it feeds.
 */
function publicHost(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) return forwardedHost.split(",")[0].trim();
  return request.headers.get("host") ?? request.nextUrl.host;
}

/**
 * Reject state-changing requests whose `Origin` does not match the host we are
 * serving. The session cookie is `SameSite=Lax`, which already keeps browsers
 * from attaching it to cross-site writes; this is the second layer that does
 * not depend on the browser getting SameSite right.
 *
 * A missing `Origin` is allowed: non-browser API clients (the CLI, curl) do not
 * send one, and they authenticate with a Bearer header that an attacker's page
 * cannot set cross-origin anyway.
 */
function hasValidOrigin(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return true;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).host === publicHost(request);
  } catch {
    return false;
  }
}

/** Did this request actually present a credential we can be wrong about? */
function presentsCredential(request: NextRequest): boolean {
  return (
    request.cookies.has(getSessionCookieName()) ||
    (request.headers.get("authorization")?.startsWith("Bearer ") ?? false)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!hasValidOrigin(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  // Allow login page and login API
  if (
    pathname === "/login" ||
    pathname === "/api/auth/login" ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Open mode: no password configured, nothing to guess or throttle.
  if (!process.env.APP_PASSWORD) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");
  const hadCredential = presentsCredential(request);
  const key = clientKey(request.headers);

  // Refuse to even check a credential once this client is over budget —
  // verifying first and throttling after would leave guesses unmetered.
  if (hadCredential && throttle.isThrottled(key)) {
    return deny(request, isApi, 429, "Too many attempts. Try again later.");
  }

  if (await isAuthenticatedFromRequest(request)) {
    if (hadCredential) throttle.reset(key);
    return NextResponse.next();
  }

  if (hadCredential) throttle.recordFailure(key);
  return deny(request, isApi, 401, "Unauthorized");
}

function deny(
  request: NextRequest,
  isApi: boolean,
  status: number,
  message: string
) {
  const response = isApi
    ? NextResponse.json({ error: message }, { status })
    : NextResponse.redirect(new URL("/login", request.url));

  // Drop a cookie we just rejected. Without this a browser holding a stale
  // session (after a password rotation, or the v1 cookie format) would replay
  // it on every request on the page and throttle itself out of logging back in.
  if (request.cookies.has(getSessionCookieName())) {
    response.cookies.delete(getSessionCookieName());
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
