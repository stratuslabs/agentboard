import { initDb } from "../../../lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "../../../lib/sql";
import { withTenant } from "../../../lib/tenant";
import { boardIdsForCards, cardIdsForMember, notifyBoards, stampCards } from "../../../lib/realtime/notify";

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
  const DEFAULT_COLOR = "#6B7280";
  const avatar = avatar_url || null;

  // An agent registering again lands on the row it already has (one agent
  // per name per team, any case; see agent-names.js): 200 rather than 201.
  // Only what the request sent is changed; an omitted color or avatar keeps
  // the stored one. People are created once, by a person, and two may share a
  // name, so a human always gets a row of their own. xmax is zero on a row
  // this statement inserted and non-zero on one it updated through the
  // conflict. `restyled` compares against the row as it was before.
  const { rows } = isAgent
    ? await sql`
        WITH before AS (
          SELECT color, avatar_url FROM members
          WHERE team_id = ${teamId} AND LOWER(name) = LOWER(${name.trim()}) AND type = 'agent'
        )
        INSERT INTO members (team_id, name, type, color, avatar_url)
        VALUES (${teamId}, ${name.trim()}, 'agent', ${color || DEFAULT_COLOR}, ${avatar})
        ON CONFLICT (team_id, LOWER(name)) WHERE type = 'agent' DO UPDATE
          SET color = COALESCE(${color || null}, members.color),
              avatar_url = COALESCE(EXCLUDED.avatar_url, members.avatar_url)
        RETURNING members.*, (xmax = 0) AS created,
          EXISTS (
            SELECT 1 FROM before
            WHERE before.color IS DISTINCT FROM members.color
               OR before.avatar_url IS DISTINCT FROM members.avatar_url
          ) AS restyled
      `
    : await sql`
        INSERT INTO members (team_id, name, type, color, avatar_url)
        VALUES (${teamId}, ${name.trim()}, 'human', ${color || DEFAULT_COLOR}, ${avatar})
        RETURNING *, true AS created, false AS restyled
      `;
  const { created, restyled, ...member } = rows[0];

  // Cards show an agent's color and avatar through a join, so a changed look
  // reaches delta and SSE clients only if its cards are stamped (as the
  // member PATCH route does). A new agent has no cards yet.
  if (!created && restyled) {
    const cardIds = await cardIdsForMember(member.id);
    await stampCards(cardIds);
    await notifyBoards(teamId, await boardIdsForCards(cardIds));
  }
  return NextResponse.json(member, { status: created ? 201 : 200 });
});
