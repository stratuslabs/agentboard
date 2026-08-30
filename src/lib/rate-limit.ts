/**
 * Bounded, in-memory failure throttle.
 *
 * Scope and limits, stated plainly: this is per-runtime-instance state. The
 * Edge middleware and the Node route handlers do not share memory, and a
 * serverless platform runs many instances, so this bounds naive guessing
 * rather than enforcing a global budget. A shared store (Redis, Postgres) is
 * the real fix for a deployment that needs one.
 */

const MAX_ENTRIES = 10_000;

interface Entry {
  count: number;
  resetAt: number;
}

export class FailureThrottle {
  private readonly attempts = new Map<string, Entry>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts: number, windowMs: number) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  isThrottled(key: string): boolean {
    const entry = this.attempts.get(key);
    if (!entry) return false;
    if (Date.now() > entry.resetAt) {
      this.attempts.delete(key);
      return false;
    }
    return entry.count >= this.maxAttempts;
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (entry && now <= entry.resetAt) {
      entry.count++;
      return;
    }
    // Only sweep when adding a new key, so a steady stream of failures from
    // one client does not walk the whole map on every request.
    if (this.attempts.size >= MAX_ENTRIES) this.evict(now);
    this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  /**
   * Drop expired entries; if that is not enough, drop the entries closest to
   * expiry. Without this an attacker who varies their apparent address grows
   * the map without bound on a long-running self-hosted instance.
   */
  private evict(now: number): void {
    for (const [key, entry] of this.attempts) {
      if (now > entry.resetAt) this.attempts.delete(key);
    }
    if (this.attempts.size < MAX_ENTRIES) return;

    const byExpiry = [...this.attempts.entries()].sort(
      (a, b) => a[1].resetAt - b[1].resetAt
    );
    const excess = this.attempts.size - Math.floor(MAX_ENTRIES / 2);
    for (let i = 0; i < excess; i++) {
      this.attempts.delete(byExpiry[i][0]);
    }
  }
}

/**
 * Best-effort client identity for throttling.
 *
 * `X-Forwarded-For` is a client-appendable list: its FIRST entry is whatever
 * the caller sent, so keying on it lets an attacker mint a fresh throttle
 * bucket per request. We prefer headers a proxy sets itself, and otherwise
 * take the LAST `X-Forwarded-For` entry — the one appended nearest to us.
 *
 * This still assumes a proxy that overwrites these headers. A deployment
 * exposed directly to the internet has no trustworthy client address here.
 */
export function clientKey(headers: Headers): string {
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",").pop()!.trim();

  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return "unknown";
}
