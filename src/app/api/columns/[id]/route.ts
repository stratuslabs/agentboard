import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const db = getDb();

  const existing = db.prepare("SELECT * FROM columns WHERE id = ?").get(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) { updates.push("name = ?"); values.push(body.name); }
  if (body.position !== undefined) { updates.push("position = ?"); values.push(body.position); }
  if (body.color !== undefined) { updates.push("color = ?"); values.push(body.color); }

  if (updates.length === 0) {
    return NextResponse.json(existing);
  }

  values.push(id);
  db.prepare(`UPDATE columns SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  const column = db.prepare("SELECT * FROM columns WHERE id = ?").get(id);
  return NextResponse.json(column);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const result = db.prepare("DELETE FROM columns WHERE id = ?").run(id);
  if (result.changes === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
