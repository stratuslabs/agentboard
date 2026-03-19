import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const board = db.prepare("SELECT * FROM boards WHERE id = ?").get(id);
  if (!board) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(board);
}
