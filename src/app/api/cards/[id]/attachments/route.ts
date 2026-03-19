import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { rows } = await sql`SELECT * FROM attachments WHERE card_id = ${id} ORDER BY created_at`;
  return NextResponse.json(rows);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { filename, content } = await request.json();

  if (!filename || !content) {
    return NextResponse.json({ error: "filename and content are required" }, { status: 400 });
  }

  const { rows: cardRows } = await sql`SELECT id FROM cards WHERE id = ${id}`;
  if (cardRows.length === 0) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const { rows } = await sql`
    INSERT INTO attachments (card_id, filename, content)
    VALUES (${id}, ${filename}, ${content})
    RETURNING *
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
