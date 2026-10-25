import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";
import { boardIdForCard, notifyBoard } from "@/lib/realtime/notify";
import { cardIdFromRef } from "@/lib/card-location";
import { withTenantParams } from "@/lib/tenant";

// Attachment bodies are stored inline in Postgres, so cap them to keep a single
// request from bloating the database.
const MAX_CONTENT_BYTES = 1024 * 1024; // 1 MiB
const MAX_FILENAME_LENGTH = 255;

export const GET = withTenantParams<{ id: string }>(async (_request, { teamId }, { params }) => {
  await initDb();
  const id = await cardIdFromRef(teamId, (await params).id);
  if (id === null) return NextResponse.json([]);
  const { rows } = await sql`SELECT * FROM attachments WHERE card_id = ${id} ORDER BY created_at`;
  return NextResponse.json(rows);
});

export const POST = withTenantParams<{ id: string }>(async (request: NextRequest, { teamId }, { params }) => {
  await initDb();
  const id = await cardIdFromRef(teamId, (await params).id);
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

  const { rows: cardRows } = id === null ? { rows: [] } : await sql`SELECT id FROM cards WHERE id = ${id}`;
  if (id === null || cardRows.length === 0) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const { rows } = await sql`
    INSERT INTO attachments (card_id, filename, content)
    VALUES (${id}, ${filename}, ${content})
    RETURNING *
  `;

  await sql`UPDATE cards SET updated_at = NOW() WHERE id = ${id}`;
  await notifyBoard(teamId, await boardIdForCard(id));

  return NextResponse.json(rows[0], { status: 201 });
});
