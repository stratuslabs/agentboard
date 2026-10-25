import { initDb } from "../../../../lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "../../../../lib/sql";
import { withTenant } from "../../../../lib/tenant";

export const PATCH = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const { ids } = await request.json(); // ordered array of product IDs

  if (!Array.isArray(ids)) {
    return NextResponse.json({ error: "ids array required" }, { status: 400 });
  }

  for (let i = 0; i < ids.length; i++) {
    // Another team's id, like a deleted one, is skipped.
    await sql`
      UPDATE products SET position = ${i}
      WHERE id = ${ids[i]} AND org_id IN (SELECT id FROM organizations WHERE team_id = ${teamId})
    `;
  }

  return NextResponse.json({ success: true });
});
