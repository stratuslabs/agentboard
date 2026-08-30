import { initDb, slugify } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const body = await request.json();

  if (body.name) {
    const { rows } = await sql`
      UPDATE products SET name = ${body.name}, slug = ${slugify(body.name)} WHERE id = ${parseInt(id, 10)} RETURNING *
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // If emoji also provided, update that too
    if (body.emoji) {
      await sql`UPDATE products SET emoji = ${body.emoji} WHERE id = ${parseInt(id, 10)}`;
    }
    const { rows: final } = await sql`SELECT * FROM products WHERE id = ${parseInt(id, 10)}`;
    return NextResponse.json(final[0]);
  }

  if (body.emoji) {
    const { rows } = await sql`
      UPDATE products SET emoji = ${body.emoji} WHERE id = ${parseInt(id, 10)} RETURNING *
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  }

  return NextResponse.json({ error: "No fields to update" }, { status: 400 });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const numId = parseInt(id, 10);

  let result;
  if (!isNaN(numId)) {
    result = await sql`DELETE FROM products WHERE id = ${numId} OR slug = ${id}`;
  } else {
    result = await sql`DELETE FROM products WHERE slug = ${id}`;
  }

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
