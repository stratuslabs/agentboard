import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";
import { withTenant } from "@/lib/tenant";

export const GET = withTenant(async (_request, { teamId }) => {
  await initDb();
  const { rows } = await sql`
    SELECT * FROM members
    WHERE team_id = ${teamId}
    ORDER BY
      CASE WHEN type = 'human' THEN 0 ELSE 1 END,
      name
  `;
  return NextResponse.json(rows);
});

export const POST = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const body = await request.json();
  const { name, type, color, avatar_url } = body;

  if (!name || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const memberType = type === "agent" ? "agent" : "human";
  const memberColor = color || "#6B7280";

  const { rows } = await sql`
    INSERT INTO members (team_id, name, type, color, avatar_url)
    VALUES (${teamId}, ${name.trim()}, ${memberType}, ${memberColor}, ${avatar_url || null})
    RETURNING *
  `;
  return NextResponse.json(rows[0], { status: 201 });
});
