import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  const db = getDb();
  const sp = request.nextUrl.searchParams;
  const boardId = sp.get("board_id");
  const columnId = sp.get("column_id");
  const assignee = sp.get("assignee");
  const priority = sp.get("priority");
  const label = sp.get("label");

  let query = "SELECT cards.* FROM cards";
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (boardId) {
    query = "SELECT cards.* FROM cards JOIN columns ON cards.column_id = columns.id";
    conditions.push("columns.board_id = ?");
    values.push(boardId);
  }

  if (columnId) {
    conditions.push("cards.column_id = ?");
    values.push(columnId);
  }

  if (assignee) {
    conditions.push("cards.assignee = ?");
    values.push(assignee);
  }

  if (priority) {
    conditions.push("cards.priority = ?");
    values.push(priority);
  }

  if (label) {
    conditions.push("cards.labels LIKE ?");
    values.push(`%${label}%`);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY cards.position, cards.id";
  const cards = db.prepare(query).all(...values);
  return NextResponse.json(cards);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { column_id, title, description, assignee, priority, labels, github_issue_url, github_pr_url } = body;

  if (!column_id || !title) {
    return NextResponse.json({ error: "column_id and title are required" }, { status: 400 });
  }

  const db = getDb();
  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) as max FROM cards WHERE column_id = ?").get(column_id) as { max: number };

  const result = db.prepare(`
    INSERT INTO cards (column_id, title, description, assignee, priority, labels, github_issue_url, github_pr_url, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    column_id,
    title,
    description || "",
    assignee || null,
    priority || "medium",
    labels || "",
    github_issue_url || null,
    github_pr_url || null,
    maxPos.max + 1
  );

  const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(card, { status: 201 });
}
