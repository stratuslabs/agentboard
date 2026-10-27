import { NextRequest, NextResponse } from "next/server";
import { sql } from "../../../lib/sql";
import { initDb } from "../../../lib/db";
import { isUniqueViolation, planSlugName } from "../../../lib/slug";
import { COLUMN } from "../../../lib/column-slug";
import { notifyBoard } from "../../../lib/realtime/notify";
import { assertBoard, found, withTenant } from "../../../lib/tenant";
import { resolveScope } from "../../../lib/scope-params";

export const GET = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const { board: rawBoardId } = await resolveScope(teamId, request.nextUrl.searchParams, [
    "org",
    "product",
    "board",
  ]);

  if (!rawBoardId) {
    return NextResponse.json({ error: "board_id or board is required" }, { status: 400 });
  }
  // Another team's board has no columns, like one that doesn't exist.
  const boardId = await found(assertBoard(teamId, rawBoardId));
  if (boardId === null) return NextResponse.json([]);

  const { rows } = await sql`SELECT * FROM columns WHERE board_id = ${boardId} ORDER BY position`;
  return NextResponse.json(rows);
});

export const POST = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const { board_id: rawBoardId, name, color } = await request.json();
  if (!rawBoardId || !name) {
    return NextResponse.json({ error: "board_id and name are required" }, { status: 400 });
  }
  const board_id = await assertBoard(teamId, rawBoardId);

  const { rows: siblings } = await sql`SELECT id, name, slug FROM columns WHERE board_id = ${board_id}`;
  const plan = planSlugName(COLUMN, name, siblings, null);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });
  const { rows: maxRows } = await sql`SELECT COALESCE(MAX(position), -1) as max FROM columns WHERE board_id = ${board_id}`;

  let rows;
  try {
    ({ rows } = await sql`
      INSERT INTO columns (board_id, name, slug, position, color)
      VALUES (${board_id}, ${plan.name}, ${plan.slug}, ${maxRows[0].max + 1}, ${color || "#6B7280"})
      RETURNING *
    `);
  } catch (err) {
    // Another request took the slug between the check and this write.
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "Another column on this board already uses that slug. Pick a different name." }, { status: 409 });
    }
    throw err;
  }
  await notifyBoard(teamId, board_id);

  return NextResponse.json(rows[0], { status: 201 });
});
