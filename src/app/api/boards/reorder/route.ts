import { initDb } from "../../../../lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "../../../../lib/sql";
import { notifyBoards } from "../../../../lib/realtime/notify";
import { withTenant } from "../../../../lib/tenant";

export const PATCH = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const body = await request.json();
  const { ids } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array is required" }, { status: 400 });
  }

  // Another team's id, like a deleted one, is skipped, and not announced.
  const moved: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    const { rows } = await sql`
      UPDATE boards SET position = ${i}, updated_at = NOW()
      WHERE id = ${ids[i]} AND product_id IN (
        SELECT p.id FROM products p JOIN organizations o ON o.id = p.org_id WHERE o.team_id = ${teamId}
      )
      RETURNING id
    `;
    if (rows.length > 0) moved.push(rows[0].id);
  }

  await notifyBoards(teamId, moved);

  return NextResponse.json({ ok: true });
});
