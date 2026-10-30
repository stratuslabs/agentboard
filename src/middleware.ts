import { NextRequest, NextResponse } from "next/server";
import { getSessionCookieName, isAuthenticatedFromRequest } from "./lib/auth";
import { clientKey, FailureThrottle } from "./lib/rate-limit";
import { publicHost } from "./lib/public-url";
import { loginPath } from "./lib/login-next";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Every route behind this middleware accepts `Authorization: Bearer <password>`,
// so the auth boundary — not just the login form — is where guesses have to be
// counted. Throttling only the login route would leave `GET /api/orgs` as an
// unmetered password oracle.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;
const throttle = new FailureThrottle(MAX_ATTEMPTS, WINDOW_MS);

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

/**
 * Brand images the login screen shows before anyone has signed in. Everything
 * else in public/ stays behind the password like the rest of the app.
 */
const PUBLIC_ASSETS = new Set([
  "/logo.png",
  "/brand-art.webp",
  "/icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
]);

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
    pathname === "/favicon.ico" ||
    PUBLIC_ASSETS.has(pathname)
  ) {
    return NextResponse.next();
  }

  // Open mode: no password configured, nothing to guess or throttle.
  if (!process.env.APP_PASSWORD) return NextResponse.next();

  // The bare /api root is an API path too: it gets the JSON 401, not a redirect.
  const isApi = pathname === "/api" || pathname.startsWith("/api/");
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
    : NextResponse.redirect(new URL(loginRedirect(request), request.url));

  // Drop a cookie we just rejected. Without this a browser holding a stale
  // session (after a password rotation, or the v1 cookie format) would replay
  // it on every request on the page and throttle itself out of logging back in.
  if (request.cookies.has(getSessionCookieName())) {
    response.cookies.delete(getSessionCookieName());
  }
  return response;
}

/**
 * /login, carrying the page a signed-out browser asked for in ?next= so the
 * login page can send it back there. Only page loads (GET/HEAD) carry it.
 */
function loginRedirect(request: NextRequest): string {
  if (request.method !== "GET" && request.method !== "HEAD") return "/login";
  return loginPath(request.nextUrl.pathname, request.nextUrl.search);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
