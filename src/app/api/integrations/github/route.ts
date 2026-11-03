import { NextRequest, NextResponse } from "next/server";
import { initDb } from "../../../../lib/db";
import { githubAppConfig } from "../../../../lib/github-install";
import { sql } from "../../../../lib/sql";
import { withTenant } from "../../../../lib/tenant";

/**
 * The GitHub App integration for Settings (card 1000): whether it's
 * configured on this server, and which installations this team has connected.
 */
export const GET = withTenant(async (_request: NextRequest, { teamId }) => {
  if (!githubAppConfig()) return NextResponse.json({ enabled: false, installations: [] });
  await initDb();
  const { rows } = await sql`
    SELECT installation_id::text AS installation_id, account_login, created_at
    FROM github_installations WHERE team_id = ${teamId} ORDER BY created_at
  `;
  return NextResponse.json({ enabled: true, installations: rows });
});

/**
 * Disconnect one installation from this team (?installation_id=N). The App
 * stays installed on GitHub, where it's removed; its webhooks stop reaching
 * this team's cards straight away.
 */
export const DELETE = withTenant(async (request: NextRequest, { teamId }) => {
  if (!githubAppConfig()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const raw = request.nextUrl.searchParams.get("installation_id") ?? "";
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) {
    return NextResponse.json({ error: "installation_id must be a positive whole number" }, { status: 400 });
  }
  await initDb();
  const { rowCount } = await sql`
    DELETE FROM github_installations WHERE installation_id = ${raw} AND team_id = ${teamId}
  `;
  if (!rowCount) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
});
