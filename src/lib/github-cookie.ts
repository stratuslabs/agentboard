import type { NextRequest } from "next/server";
import { publicOrigin } from "./public-url";

/** Holds the install-state nonce between "Connect GitHub" and the callback (card 1000). */
export const GITHUB_NONCE_COOKIE = "agentboard_github_install";

export function nonceCookieOptions(request: NextRequest) {
  return {
    httpOnly: true,
    // Lax: the callback is a top-level GET navigation from github.com, which Lax still sends.
    sameSite: "lax" as const,
    secure: publicOrigin(request).startsWith("https:"),
    path: "/api/integrations/github",
    maxAge: 10 * 60,
  };
}
