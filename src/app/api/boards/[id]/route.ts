import { initDb, slugify } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";
import { notifyBoard } from "@/lib/realtime/notify";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const { rows } = await sql`SELECT * FROM boards WHERE id = ${id}`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const body = await request.json();
  const { name } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const slug = slugify(name);
  const { rows } = await sql`
    UPDATE boards SET name = ${name}, slug = ${slug}, updated_at = NOW() WHERE id = ${id} RETURNING *
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await notifyBoard(id);

  return NextResponse.json(rows[0]);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  await sql`DELETE FROM boards WHERE id = ${id}`;
  // Announced after the fact so anyone still looking at it refetches and finds
  // it gone, rather than sitting on a board that no longer exists.
  await notifyBoard(id);
  return NextResponse.json({ ok: true });
}
