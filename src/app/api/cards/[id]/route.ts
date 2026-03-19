import { NextRequest, NextResponse } from "next/server";
import { sql, db as pool } from "@vercel/postgres";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { rows } = await sql`SELECT * FROM cards WHERE id = ${id}`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const { rows: existing } = await sql`SELECT * FROM cards WHERE id = ${id}`;
  if (existing.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allowedFields = [
    "title", "description", "assignee", "priority", "labels",
    "github_issue_url", "github_pr_url", "column_id", "position"
  ];

  const sets: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      sets.push(`${field} = $${paramIdx++}`);
      values.push(body[field]);
    }
  }

  if (sets.length === 0) {
    return NextResponse.json(existing[0]);
  }

  sets.push("updated_at = NOW()");
  values.push(id);

  const query = `UPDATE cards SET ${sets.join(", ")} WHERE id = $${paramIdx} RETURNING *`;
  const { rows } = await pool.query(query, values);
  return NextResponse.json(rows[0]);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await sql`DELETE FROM cards WHERE id = ${id}`;
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
