import { initDb } from "../../../lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "../../../lib/sql";
import { withTenant } from "../../../lib/tenant";

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

  const isAgent = type === "agent";
  const memberColor = color || "#6B7280";
  const avatar = avatar_url || null;

  // An agent registering again lands on the row it already has (one agent
  // per name per team, any case; see agent-names.js): 200 rather than 201.
  // People are created once, by a person, and two may share a name, so a
  // human always gets a row of their own. xmax is zero on a row this
  // statement inserted and non-zero on one it updated through the conflict.
  const { rows } = isAgent
    ? await sql`
        INSERT INTO members (team_id, name, type, color, avatar_url)
        VALUES (${teamId}, ${name.trim()}, 'agent', ${memberColor}, ${avatar})
        ON CONFLICT (team_id, LOWER(name)) WHERE type = 'agent' DO UPDATE
          SET color = EXCLUDED.color,
              avatar_url = COALESCE(EXCLUDED.avatar_url, members.avatar_url)
        RETURNING *, (xmax = 0) AS created
      `
    : await sql`
        INSERT INTO members (team_id, name, type, color, avatar_url)
        VALUES (${teamId}, ${name.trim()}, 'human', ${memberColor}, ${avatar})
        RETURNING *, true AS created
      `;
  const { created, ...member } = rows[0];
  return NextResponse.json(member, { status: created ? 201 : 200 });
});
