import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";
import { boardIdForCard, boardIdForColumn, notifyBoards } from "@/lib/realtime/notify";
import { getCardWithLocation } from "@/lib/card-location";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const { column_id, position } = await request.json();

  const { rows } = await sql`SELECT * FROM cards WHERE id = ${id}`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!column_id) {
    return NextResponse.json({ error: "column_id is required" }, { status: 400 });
  }

  const { rows: colRows } = await sql`SELECT id FROM columns WHERE id = ${column_id}`;
  if (colRows.length === 0) {
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

  await notifyBoards([boardBefore, await boardIdForColumn(column_id)]);

  // Includes product/board so a caller can confirm where the card landed.
  return NextResponse.json(await getCardWithLocation(id));
}
