import { sql } from "@/lib/sql";
import { NextRequest, NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { withTenant } from "@/lib/tenant";

// Preferences are per user within a team. A caller with no user (the hosted
// edition's API keys) has none to read or write. Self-hosted requests always
// have one, its implicit user.
const noUser = () =>
  NextResponse.json({ error: "Preferences are per user; sign in to read or change them" }, { status: 403 });

export const GET = withTenant(async (_request, { teamId, userId }) => {
  if (userId === null) return noUser();
  await initDb();
  const { rows } = await sql`
    SELECT key, value FROM user_preferences WHERE team_id = ${teamId} AND user_id = ${userId}
  `;
  const prefs: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      prefs[row.key] = JSON.parse(row.value);
    } catch {
      prefs[row.key] = row.value;
    }
  }
  return NextResponse.json(prefs);
});

export const PATCH = withTenant(async (req: NextRequest, { teamId, userId }) => {
  if (userId === null) return noUser();
  await initDb();
  const { key, value } = await req.json();
  if (!key || value === undefined) {
    return NextResponse.json({ error: "key and value required" }, { status: 400 });
  }
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const { rows } = await sql`
    INSERT INTO user_preferences (team_id, user_id, key, value, updated_at)
    VALUES (${teamId}, ${userId}, ${key}, ${serialized}, NOW())
    ON CONFLICT (team_id, user_id, key) DO UPDATE SET value = ${serialized}, updated_at = NOW()
    RETURNING *
  `;
  return NextResponse.json(rows[0]);
});
