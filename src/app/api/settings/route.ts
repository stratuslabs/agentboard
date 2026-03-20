import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { initDb } from "@/lib/db";

export async function GET() {
  await initDb();
  const { rows } = await sql`SELECT key, value FROM settings`;
  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }
  return NextResponse.json(settings);
}

export async function PATCH(request: NextRequest) {
  await initDb();
  const { key, value } = await request.json();
  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const { rows } = await sql`
    INSERT INTO settings (key, value, updated_at)
    VALUES (${key}, ${serialized}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${serialized}, updated_at = NOW()
    RETURNING *
  `;
  return NextResponse.json(rows[0]);
}
