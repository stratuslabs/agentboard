import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { column_id, position } = await request.json();
  const db = getDb();

  const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
  if (!card) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!column_id) {
    return NextResponse.json({ error: "column_id is required" }, { status: 400 });
  }

  let newPosition = position;
  if (newPosition === undefined) {
    const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) as max FROM cards WHERE column_id = ?").get(column_id) as { max: number };
    newPosition = maxPos.max + 1;
  }

  db.prepare(
    "UPDATE cards SET column_id = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(column_id, newPosition, id);

  const updated = db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
  return NextResponse.json(updated);
}
