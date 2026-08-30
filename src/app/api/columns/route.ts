import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";
import { initDb, slugify } from "@/lib/db";

export async function GET(request: NextRequest) {
  await initDb();
  const boardId = request.nextUrl.searchParams.get("board_id");

  if (!boardId) {
    return NextResponse.json({ error: "board_id is required" }, { status: 400 });
  }

  const { rows } = await sql`SELECT * FROM columns WHERE board_id = ${boardId} ORDER BY position`;
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  await initDb();
  const { board_id, name, color } = await request.json();
  if (!board_id || !name) {
    return NextResponse.json({ error: "board_id and name are required" }, { status: 400 });
  }

  const slug = slugify(name);
  const { rows: maxRows } = await sql`SELECT COALESCE(MAX(position), -1) as max FROM columns WHERE board_id = ${board_id}`;

  const { rows } = await sql`
    INSERT INTO columns (board_id, name, slug, position, color)
    VALUES (${board_id}, ${name}, ${slug}, ${maxRows[0].max + 1}, ${color || "#6B7280"})
    RETURNING *
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
