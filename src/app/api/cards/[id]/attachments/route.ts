import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

// Attachment bodies are stored inline in Postgres, so cap them to keep a single
// request from bloating the database.
const MAX_CONTENT_BYTES = 1024 * 1024; // 1 MiB
const MAX_FILENAME_LENGTH = 255;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const { rows } = await sql`SELECT * FROM attachments WHERE card_id = ${id} ORDER BY created_at`;
  return NextResponse.json(rows);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const { filename, content } = await request.json();

  if (!filename || !content) {
    return NextResponse.json({ error: "filename and content are required" }, { status: 400 });
  }

  if (typeof filename !== "string" || typeof content !== "string") {
    return NextResponse.json(
      { error: "filename and content must be strings" },
      { status: 400 }
    );
  }

  if (filename.length > MAX_FILENAME_LENGTH) {
    return NextResponse.json(
      { error: `filename must be at most ${MAX_FILENAME_LENGTH} characters` },
      { status: 400 }
    );
  }

  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
    return NextResponse.json(
      { error: `content must be at most ${MAX_CONTENT_BYTES} bytes` },
      { status: 413 }
    );
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
