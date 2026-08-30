import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql, db as pool } from "@/lib/sql";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const body = await request.json();

  const { rows: existing } = await sql`SELECT * FROM columns WHERE id = ${id}`;
  if (existing.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (body.name !== undefined) { sets.push(`name = $${paramIdx++}`); values.push(body.name); }
  if (body.position !== undefined) { sets.push(`position = $${paramIdx++}`); values.push(body.position); }
  if (body.color !== undefined) { sets.push(`color = $${paramIdx++}`); values.push(body.color); }

  if (sets.length === 0) {
    return NextResponse.json(existing[0]);
  }

  values.push(id);
  const query = `UPDATE columns SET ${sets.join(", ")} WHERE id = $${paramIdx} RETURNING *`;
  const { rows } = await pool.query(query, values);
  return NextResponse.json(rows[0]);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const result = await sql`DELETE FROM columns WHERE id = ${id}`;
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
