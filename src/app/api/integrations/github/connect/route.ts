import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { githubAppConfig, installUrl, signState } from "../../../../../lib/github-install";
import { withTenant } from "../../../../../lib/tenant";
import { GITHUB_NONCE_COOKIE, nonceCookieOptions } from "../../../../../lib/github-cookie";

export const runtime = "nodejs";

/**
 * Settings → "Connect GitHub" (card 1000): send the browser to the App's
 * install page with a signed state for this team, and keep the state's nonce
 * in a cookie so only this browser can finish the flow.
 */
export const GET = withTenant(async (request: NextRequest, { teamId }) => {
  const config = githubAppConfig();
  if (!config) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const nonce = randomBytes(16).toString("base64url");
  const state = signState({ teamId, nonce }, config.clientSecret);
  const response = NextResponse.redirect(installUrl(config.slug, state), 302);
  response.cookies.set(GITHUB_NONCE_COOKIE, nonce, nonceCookieOptions(request));
  return response;
});
