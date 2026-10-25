import { initDb } from "../../../../../lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "../../../../../lib/sql";
import { boardIdForCard, notifyBoard } from "../../../../../lib/realtime/notify";
import { cardIdFromRef } from "../../../../../lib/card-location";
import { parseSubtaskCreate } from "../../../../../lib/subtasks";
import { withTenantParams } from "../../../../../lib/tenant";

async function cardExists(id: number): Promise<boolean> {
  const { rows } = await sql`SELECT 1 FROM cards WHERE id = ${id}`;
  return rows.length > 0;
}

export const GET = withTenantParams<{ id: string }>(async (_request, { teamId }, { params }) => {
  await initDb();
  const id = await cardIdFromRef(teamId, (await params).id);
  if (id === null || !(await cardExists(id))) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }
  const { rows } = await sql`
    SELECT * FROM subtasks WHERE card_id = ${id} ORDER BY position, id
  `;
  return NextResponse.json(rows);
});

export const POST = withTenantParams<{ id: string }>(async (request: NextRequest, { teamId }, { params }) => {
  await initDb();
  const id = await cardIdFromRef(teamId, (await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const parsed = parseSubtaskCreate(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (!(await cardExists(id))) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  // New sub-tasks go to the end of the list.
  const { rows } = await sql`
    INSERT INTO subtasks (card_id, title, done, position)
    VALUES (
      ${id}, ${parsed.value.title}, ${parsed.value.done},
      (SELECT COALESCE(MAX(position) + 1, 0) FROM subtasks WHERE card_id = ${id})
    )
    RETURNING *
  `;

  await sql`UPDATE cards SET updated_at = NOW() WHERE id = ${id}`;
  await notifyBoard(teamId, await boardIdForCard(id));

  return NextResponse.json(rows[0], { status: 201 });
});
