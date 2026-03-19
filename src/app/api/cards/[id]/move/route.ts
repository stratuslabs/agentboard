import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

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

  let newPosition = position;
  if (newPosition === undefined) {
    const { rows: maxRows } = await sql`SELECT COALESCE(MAX(position), -1) as max FROM cards WHERE column_id = ${column_id}`;
    newPosition = maxRows[0].max + 1;
  }

  const { rows: updated } = await sql`
    UPDATE cards SET column_id = ${column_id}, position = ${newPosition}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return NextResponse.json(updated[0]);
}
