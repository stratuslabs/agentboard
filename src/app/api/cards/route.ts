import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql, db as pool } from "@vercel/postgres";

export async function GET(request: NextRequest) {
  await initDb();
  const sp = request.nextUrl.searchParams;
  const boardId = sp.get("board_id");
  const columnId = sp.get("column_id");
  const assignee = sp.get("assignee");
  const priority = sp.get("priority");
  const label = sp.get("label");

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;
  let baseQuery: string;

  if (boardId) {
    baseQuery = "SELECT cards.* FROM cards JOIN columns ON cards.column_id = columns.id";
    conditions.push(`columns.board_id = $${paramIdx++}`);
    values.push(boardId);
  } else {
    baseQuery = "SELECT cards.* FROM cards";
  }

  if (columnId) {
    conditions.push(`cards.column_id = $${paramIdx++}`);
    values.push(columnId);
  }

  if (assignee) {
    conditions.push(`cards.assignee = $${paramIdx++}`);
    values.push(assignee);
  }

  if (priority) {
    conditions.push(`cards.priority = $${paramIdx++}`);
    values.push(priority);
  }

  if (label) {
    conditions.push(`cards.labels ILIKE $${paramIdx++}`);
    values.push(`%${label}%`);
  }

  let query = baseQuery;
  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " ORDER BY cards.position, cards.id";

  const { rows } = await pool.query(query, values);
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  await initDb();
  const body = await request.json();
  const { column_id, title, description, assignee, priority, labels, github_issue_url, github_pr_url } = body;

  if (!column_id || !title) {
    return NextResponse.json({ error: "column_id and title are required" }, { status: 400 });
  }

  const { rows: maxRows } = await sql`SELECT COALESCE(MAX(position), -1) as max FROM cards WHERE column_id = ${column_id}`;

  const { rows } = await sql`
    INSERT INTO cards (column_id, title, description, assignee, priority, labels, github_issue_url, github_pr_url, position)
    VALUES (${column_id}, ${title}, ${description || ""}, ${assignee || null}, ${priority || "medium"}, ${labels || ""}, ${github_issue_url || null}, ${github_pr_url || null}, ${maxRows[0].max + 1})
    RETURNING *
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
