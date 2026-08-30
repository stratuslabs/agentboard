import { NextRequest, NextResponse } from "next/server";
import { deriveSessionToken, getSessionCookieName, verifyPassword } from "@/lib/auth";
import { clientKey, FailureThrottle } from "@/lib/rate-limit";

// The middleware keeps its own counter for Bearer/cookie guesses at the auth
// boundary. Route handlers run in a different runtime than Edge middleware and
// cannot share memory with it, so this is a second instance of the same policy
// covering the login form.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;
const throttle = new FailureThrottle(MAX_ATTEMPTS, WINDOW_MS);

export async function POST(request: NextRequest) {
  const appPassword = process.env.APP_PASSWORD;

  if (!appPassword) {
    // No password set — auto-login
    return NextResponse.json({ success: true });
  }

  const key = clientKey(request.headers);
  if (throttle.isThrottled(key)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }

  let password: unknown;
  try {
    ({ password } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof password !== "string" || !(await verifyPassword(password))) {
    throttle.recordFailure(key);
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  throttle.reset(key);

  const response = NextResponse.json({ success: true });
  // Store a derived token, never the password itself.
  response.cookies.set(getSessionCookieName(), await deriveSessionToken(appPassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return response;
}
