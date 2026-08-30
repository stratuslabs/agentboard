import { NextRequest, NextResponse } from "next/server";
import { deriveSessionToken, getSessionCookieName, verifyPassword } from "@/lib/auth";

// Best-effort brute-force throttle. This is per-instance state, so on
// serverless platforms it only bounds a single warm instance rather than the
// whole deployment — enough to blunt naive password guessing, not a substitute
// for a shared rate limiter or a high-entropy APP_PASSWORD.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
}

function isThrottled(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count++;
}

export async function POST(request: NextRequest) {
  const appPassword = process.env.APP_PASSWORD;

  if (!appPassword) {
    // No password set — auto-login
    return NextResponse.json({ success: true });
  }

  const key = clientKey(request);
  if (isThrottled(key)) {
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
    recordFailure(key);
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  attempts.delete(key);

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
