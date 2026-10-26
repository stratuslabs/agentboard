import { NextRequest, NextResponse } from "next/server";
import { sql } from "../../../lib/sql";
import { initDb, slugify } from "../../../lib/db";
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

  const slug = slugify(name);
  const { rows: maxRows } = await sql`SELECT COALESCE(MAX(position), -1) as max FROM columns WHERE board_id = ${board_id}`;

  const { rows } = await sql`
    INSERT INTO columns (board_id, name, slug, position, color)
    VALUES (${board_id}, ${name}, ${slug}, ${maxRows[0].max + 1}, ${color || "#6B7280"})
    RETURNING *
  `;
  await notifyBoard(teamId, board_id);

  return NextResponse.json(rows[0], { status: 201 });
});
