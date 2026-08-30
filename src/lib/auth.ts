import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const COOKIE_NAME = "agentboard_session";

// Domain separator so the stored token can never be replayed as the password
// itself, and so the scheme can be rotated later without ambiguity.
const TOKEN_PREFIX = "agentboard.session.v1:";

/**
 * Derive the opaque session token stored in the cookie.
 *
 * The cookie deliberately does NOT hold the plaintext `APP_PASSWORD`: anything
 * that leaks the cookie (a proxy log, a browser backup, a shared machine)
 * would otherwise hand over the Bearer token for the whole API.
 *
 * Uses Web Crypto so this works unchanged in the Edge middleware runtime.
 */
export async function deriveSessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(TOKEN_PREFIX + password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compare two equal-length hex digests without leaking match position through
 * timing. Callers must pass derived tokens, never raw secrets of varying
 * length — that keeps the comparison independent of the secret's length too.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Constant-time check of a candidate secret against `APP_PASSWORD`. */
export async function verifyPassword(candidate: string): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return false;
  const [expected, actual] = await Promise.all([
    deriveSessionToken(password),
    deriveSessionToken(candidate),
  ]);
  return timingSafeEqualHex(expected, actual);
}

/** Session check for server components. */
export async function isAuthenticated(): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return true; // No password set = open access

  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME);
  if (!session?.value) return false;

  return timingSafeEqualHex(await deriveSessionToken(password), session.value);
}

/** Session check for middleware: session cookie or `Authorization: Bearer`. */
export async function isAuthenticatedFromRequest(
  request: NextRequest
): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return true;

  const expected = await deriveSessionToken(password);

  // Check cookie (holds the derived token, not the password)
  const session = request.cookies.get(COOKIE_NAME);
  if (session?.value && timingSafeEqualHex(expected, session.value)) return true;

  // Check Authorization header (Bearer token == APP_PASSWORD, for API clients)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (timingSafeEqualHex(expected, await deriveSessionToken(token))) return true;
  }

  return false;
}

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}
