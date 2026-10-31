import { NextRequest, NextResponse } from "next/server";
import { initDb } from "../../../../../lib/db";
import { completeInstall, githubAppConfig, InstallError, readState } from "../../../../../lib/github-install";
import { bindInstallation } from "../../../../../lib/github-webhook";
import { publicOrigin } from "../../../../../lib/public-url";
import { withTenant } from "../../../../../lib/tenant";
import { GITHUB_NONCE_COOKIE, nonceCookieOptions } from "../../../../../lib/github-cookie";

export const runtime = "nodejs";

/**
 * Where GitHub sends the browser after installing the App with OAuth during
 * installation (card 1000). Binds the installation to the signed-in team only
 * when the state is this browser's, for this team, and the GitHub user who
 * authorized can reach the installation. Always ends on Settings, with
 * ?github=connected or ?github_error=<message>.
 */
export const GET = withTenant(async (request: NextRequest, { teamId, userId }) => {
  const config = githubAppConfig();
  if (!config) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const params = request.nextUrl.searchParams;
  const settings = new URL("/settings", publicOrigin(request));
  const finish = (key: "github" | "github_error", value: string) => {
    settings.searchParams.set(key, value);
    const response = NextResponse.redirect(settings, 303);
    response.cookies.set(GITHUB_NONCE_COOKIE, "", { ...nonceCookieOptions(request), maxAge: 0 });
    return response;
  };

  const state = readState(params.get("state"), config.clientSecret, {
    teamId,
    nonce: request.cookies.get(GITHUB_NONCE_COOKIE)?.value,
  });
  if (!state) {
    return finish("github_error", "That GitHub connection link expired or was started elsewhere. Click Connect GitHub again.");
  }

  try {
    const { installationId, accountLogin } = await completeInstall({
      code: params.get("code"),
      installationId: params.get("installation_id"),
      config,
    });
    await initDb();
    await bindInstallation({ installationId, teamId, accountLogin, createdBy: userId });
  } catch (e) {
    if (e instanceof InstallError) return finish("github_error", e.message);
    if (e instanceof Error && /another team/.test(e.message)) return finish("github_error", e.message);
    throw e;
  }
  return finish("github", "connected");
});
