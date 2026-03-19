import { NextRequest, NextResponse } from "next/server";
import { getDb, slugify } from "@/lib/db";

export async function GET(request: NextRequest) {
  const db = getDb();
  const boardId = request.nextUrl.searchParams.get("board_id");

  if (!boardId) {
    return NextResponse.json({ error: "board_id is required" }, { status: 400 });
  }

  const columns = db.prepare("SELECT * FROM columns WHERE board_id = ? ORDER BY position").all(boardId);
  return NextResponse.json(columns);
}

export async function POST(request: NextRequest) {
  const { board_id, name, color } = await request.json();
  if (!board_id || !name) {
    return NextResponse.json({ error: "board_id and name are required" }, { status: 400 });
  }

  const db = getDb();
  const slug = slugify(name);
  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) as max FROM columns WHERE board_id = ?").get(board_id) as { max: number };

  const result = db.prepare(
    "INSERT INTO columns (board_id, name, slug, position, color) VALUES (?, ?, ?, ?, ?)"
  ).run(board_id, name, slug, maxPos.max + 1, color || "#6B7280");

  const column = db.prepare("SELECT * FROM columns WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(column, { status: 201 });
}
