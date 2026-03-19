import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const attachments = db.prepare("SELECT * FROM attachments WHERE card_id = ? ORDER BY created_at").all(id);
  return NextResponse.json(attachments);
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

  const db = getDb();
  const card = db.prepare("SELECT id FROM cards WHERE id = ?").get(id);
  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const result = db.prepare(
    "INSERT INTO attachments (card_id, filename, content) VALUES (?, ?, ?)"
  ).run(id, filename, content);

  const attachment = db.prepare("SELECT * FROM attachments WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(attachment, { status: 201 });
}
