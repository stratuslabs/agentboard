import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";
import { initDb } from "@/lib/db";
import { withTenant } from "@/lib/tenant";

export const GET = withTenant(async (_request, { teamId }) => {
  await initDb();
  const { rows } = await sql`SELECT key, value FROM settings WHERE team_id = ${teamId}`;
  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }
  return NextResponse.json(settings);
});

export const PATCH = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const { key, value } = await request.json();
  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const { rows } = await sql`
    INSERT INTO settings (team_id, key, value, updated_at)
    VALUES (${teamId}, ${key}, ${serialized}, NOW())
    ON CONFLICT (team_id, key) DO UPDATE SET value = ${serialized}, updated_at = NOW()
    RETURNING *
  `;
  return NextResponse.json(rows[0]);
});
