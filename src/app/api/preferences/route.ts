import { sql } from "@/lib/sql";
import { NextRequest, NextResponse } from "next/server";
import { initDb } from "@/lib/db";

export async function GET() {
  await initDb();
  const { rows } = await sql`SELECT key, value FROM user_preferences`;
  const prefs: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      prefs[row.key] = JSON.parse(row.value);
    } catch {
      prefs[row.key] = row.value;
    }
  }
  return NextResponse.json(prefs);
}

export async function PATCH(req: NextRequest) {
  await initDb();
  const { key, value } = await req.json();
  if (!key || value === undefined) {
    return NextResponse.json({ error: "key and value required" }, { status: 400 });
  }
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const { rows } = await sql`
    INSERT INTO user_preferences (key, value, updated_at)
    VALUES (${key}, ${serialized}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${serialized}, updated_at = NOW()
    RETURNING *
  `;
  return NextResponse.json(rows[0]);
}
