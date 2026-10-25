import { initDb } from "../../../../lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "../../../../lib/sql";
import { boardIdsForCards, notifyBoards } from "../../../../lib/realtime/notify";
import { withTenant } from "../../../../lib/tenant";

export const PATCH = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const { ids } = await request.json();

  if (!Array.isArray(ids)) {
    return NextResponse.json({ error: "ids must be an array" }, { status: 400 });
  }

  // Another team's id, like a deleted one, is skipped, and not announced.
  const moved: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    const { rows } = await sql`
      UPDATE cards SET position = ${i}, updated_at = NOW()
      WHERE id = ${ids[i]} AND column_id IN (
        SELECT c.id FROM columns c
        JOIN boards b ON b.id = c.board_id
        JOIN products p ON p.id = b.product_id
        JOIN organizations o ON o.id = p.org_id
        WHERE o.team_id = ${teamId}
      )
      RETURNING id
    `;
    if (rows.length > 0) moved.push(rows[0].id);
  }

  await notifyBoards(teamId, await boardIdsForCards(moved));

  return NextResponse.json({ ok: true });
});
