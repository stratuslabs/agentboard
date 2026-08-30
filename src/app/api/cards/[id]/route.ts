import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql, db as pool } from "@/lib/sql";

const AGENT_COLORS = ['#EF4444','#F97316','#EAB308','#22C55E','#06B6D4','#3B82F6','#8B5CF6','#EC4899','#6B7280'];

async function resolveAgentMember(agentName: string): Promise<number> {
  const { rows: existing } = await sql`
    SELECT id FROM members WHERE name = ${agentName} AND type = 'agent'
  `;
  if (existing.length > 0) return existing[0].id;

  const color = AGENT_COLORS[Math.floor(Math.random() * AGENT_COLORS.length)];
  const { rows: created } = await sql`
    INSERT INTO members (name, type, color)
    VALUES (${agentName}, 'agent', ${color})
    RETURNING id
  `;
  return created[0].id;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const { rows } = await sql`
    SELECT cards.*, m.name AS assignee_name, m.type AS assignee_type, m.color AS assignee_color
    FROM cards
    LEFT JOIN members m ON cards.assignee_id = m.id
    WHERE cards.id = ${id}
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const body = await request.json();

  const { rows: existing } = await sql`SELECT * FROM cards WHERE id = ${id}`;
  if (existing.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Auto-register agent from X-Agent-Name header
  const agentName = request.headers.get("x-agent-name");
  if (agentName && body.assignee_id === undefined) {
    body.assignee_id = await resolveAgentMember(agentName);
  }

  // Resolve text assignee name to member ID if no assignee_id provided
  if (body.assignee && body.assignee_id === undefined) {
    const { rows: memberMatch } = await sql`SELECT id FROM members WHERE LOWER(name) = LOWER(${body.assignee}) LIMIT 1`;
    if (memberMatch.length > 0) {
      body.assignee_id = memberMatch[0].id;
    }
  }

  const allowedFields = [
    "title", "description", "assignee", "assignee_id", "priority", "labels",
    "github_issue_url", "github_pr_url", "column_id", "position", "due_date"
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

  // Attach member info
  if (rows[0].assignee_id) {
    const { rows: memberRows } = await sql`SELECT name, type, color FROM members WHERE id = ${rows[0].assignee_id}`;
    if (memberRows.length > 0) {
      rows[0].assignee_name = memberRows[0].name;
      rows[0].assignee_type = memberRows[0].type;
      rows[0].assignee_color = memberRows[0].color;
    }
  }

  return NextResponse.json(rows[0]);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const result = await sql`DELETE FROM cards WHERE id = ${id}`;
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
