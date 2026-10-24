import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql, db as pool } from "@/lib/sql";
import { boardIdForColumn, notifyBoard } from "@/lib/realtime/notify";
import { planColumnRename } from "@/lib/column-slug";
import { assertColumn, withTenantParams } from "@/lib/tenant";

export const PATCH = withTenantParams<{ id: string }>(async (request: NextRequest, { teamId }, { params }) => {
  await initDb();
  const id = await assertColumn(teamId, (await params).id);
  const body = await request.json();

  const { rows: existing } = await sql`SELECT * FROM columns WHERE id = ${id}`;
  if (existing.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (body.name !== undefined) {
    // The slug follows the name, so `status <id> todo` can't land a card in a
    // column that was renamed to mean something else.
    const { rows: boardColumns } = await sql`
      SELECT id, name, slug FROM columns WHERE board_id = ${existing[0].board_id}
    `;
    const rename = planColumnRename(boardColumns, existing[0].id, body.name);
    if (!rename.ok) {
      return NextResponse.json({ error: rename.error }, { status: rename.status });
    }
    sets.push(`name = $${paramIdx++}`); values.push(rename.name);
    sets.push(`slug = $${paramIdx++}`); values.push(rename.slug);
  }
  if (body.position !== undefined) { sets.push(`position = $${paramIdx++}`); values.push(body.position); }
  if (body.color !== undefined) { sets.push(`color = $${paramIdx++}`); values.push(body.color); }

  if (sets.length === 0) {
    return NextResponse.json(existing[0]);
  }

  sets.push("updated_at = NOW()");
  values.push(id);
  const query = `UPDATE columns SET ${sets.join(", ")} WHERE id = $${paramIdx} RETURNING *`;
  let rows;
  try {
    ({ rows } = await pool.query(query, values));
  } catch (err) {
    // Another rename took the slug between the check above and this write.
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "Another column on this board already uses that slug. Pick a different name." },
        { status: 409 }
      );
    }
    throw err;
  }

  await notifyBoard(teamId, existing[0].board_id);

  return NextResponse.json(rows[0]);
});

export const DELETE = withTenantParams<{ id: string }>(async (_request, { teamId }, { params }) => {
  await initDb();
  const id = await assertColumn(teamId, (await params).id);
  // Resolved before the delete, while the column still knows its board.
  const boardId = await boardIdForColumn(id);
  const result = await sql`DELETE FROM columns WHERE id = ${id}`;
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await notifyBoard(teamId, boardId);
  return NextResponse.json({ success: true });
});
