import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
  if (!card) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(card);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const db = getDb();

  const existing = db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allowedFields = [
    "title", "description", "assignee", "priority", "labels",
    "github_issue_url", "github_pr_url", "column_id", "position"
  ];

  const updates: string[] = [];
  const values: unknown[] = [];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(body[field]);
    }
  }

  if (updates.length === 0) {
    return NextResponse.json(existing);
  }

  updates.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id);

  db.prepare(`UPDATE cards SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
  return NextResponse.json(card);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const result = db.prepare("DELETE FROM cards WHERE id = ?").run(id);
  if (result.changes === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
