import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const COOKIE_NAME = "agentboard_session";

export async function isAuthenticated(): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return true; // No password set = open access

  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME);
  return session?.value === password;
}

export function isAuthenticatedFromRequest(request: NextRequest): boolean {
  const password = process.env.APP_PASSWORD;
  if (!password) return true;

  // Check cookie
  const session = request.cookies.get(COOKIE_NAME);
  if (session?.value === password) return true;

  // Check Authorization header (Bearer token)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (token === password) return true;
  }

  return false;
}

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}
