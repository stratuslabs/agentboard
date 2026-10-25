import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";
import { boardIdForCard, boardIdForColumn, notifyBoards } from "@/lib/realtime/notify";
import { cardIdFromRef, getCardWithLocation } from "@/lib/card-location";
import { assertColumn, found, withTenantParams } from "@/lib/tenant";

export const PATCH = withTenantParams<{ id: string }>(async (request: NextRequest, { teamId }, { params }) => {
  await initDb();
  const id = await cardIdFromRef(teamId, (await params).id);
  const { column_id: rawColumnId, position } = await request.json();

  const { rows } = id === null ? { rows: [] } : await sql`SELECT * FROM cards WHERE id = ${id}`;
  if (id === null || rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!rawColumnId) {
    return NextResponse.json({ error: "column_id is required" }, { status: 400 });
  }

  // Another team's column is as missing as a deleted one.
  const column_id = await found(assertColumn(teamId, rawColumnId));
  if (column_id === null) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  let newPosition = position;
  if (newPosition === undefined) {
    const { rows: maxRows } = await sql`SELECT COALESCE(MAX(position), -1) as max FROM cards WHERE column_id = ${column_id}`;
    newPosition = maxRows[0].max + 1;
  }

  const boardBefore = await boardIdForCard(id);

  await sql`
    UPDATE cards SET column_id = ${column_id}, position = ${newPosition}, updated_at = NOW()
    WHERE id = ${id}
  `;

  await notifyBoards(teamId, [boardBefore, await boardIdForColumn(column_id)]);

  // Includes product/board so a caller can confirm where the card landed.
  return NextResponse.json(await getCardWithLocation(teamId, id));
});
