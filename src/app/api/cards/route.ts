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

export async function GET(request: NextRequest) {
  await initDb();
  const sp = request.nextUrl.searchParams;
  const boardId = sp.get("board_id");
  const columnId = sp.get("column_id");
  const assignee = sp.get("assignee");
  const assigneeId = sp.get("assignee_id");
  const priority = sp.get("priority");
  const label = sp.get("label");

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  const baseQuery = boardId
    ? "SELECT cards.*, m.name AS assignee_name, m.type AS assignee_type, m.color AS assignee_color FROM cards JOIN columns ON cards.column_id = columns.id LEFT JOIN members m ON cards.assignee_id = m.id"
    : "SELECT cards.*, m.name AS assignee_name, m.type AS assignee_type, m.color AS assignee_color FROM cards LEFT JOIN members m ON cards.assignee_id = m.id";

  if (boardId) {
    conditions.push(`columns.board_id = $${paramIdx++}`);
    values.push(boardId);
  }

  if (columnId) {
    conditions.push(`cards.column_id = $${paramIdx++}`);
    values.push(columnId);
  }

  if (assigneeId) {
    conditions.push(`cards.assignee_id = $${paramIdx++}`);
    values.push(assigneeId);
  } else if (assignee) {
    // Support filtering by old text assignee OR by member name
    conditions.push(`(cards.assignee = $${paramIdx} OR m.name = $${paramIdx})`);
    values.push(assignee);
    paramIdx++;
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
  const { column_id, title, description, assignee, priority, labels, github_issue_url, github_pr_url, due_date } = body;
  let { assignee_id } = body;

  if (!column_id || !title) {
    return NextResponse.json({ error: "column_id and title are required" }, { status: 400 });
  }

  // Auto-register agent from X-Agent-Name header
  const agentName = request.headers.get("x-agent-name");
  if (agentName && !assignee_id) {
    assignee_id = await resolveAgentMember(agentName);
  }

  // Resolve text assignee name to member ID if no assignee_id provided
  if (!assignee_id && assignee) {
    const { rows: memberMatch } = await sql`SELECT id FROM members WHERE LOWER(name) = LOWER(${assignee}) LIMIT 1`;
    if (memberMatch.length > 0) {
      assignee_id = memberMatch[0].id;
    }
  }

  const { rows: maxRows } = await sql`SELECT COALESCE(MAX(position), -1) as max FROM cards WHERE column_id = ${column_id}`;

  const { rows } = await sql`
    INSERT INTO cards (column_id, title, description, assignee, assignee_id, priority, labels, github_issue_url, github_pr_url, due_date, position)
    VALUES (${column_id}, ${title}, ${description || ""}, ${assignee || null}, ${assignee_id || null}, ${priority || "medium"}, ${labels || ""}, ${github_issue_url || null}, ${github_pr_url || null}, ${due_date || null}, ${maxRows[0].max + 1})
    RETURNING *
  `;

  // Return with member info if assignee_id is set
  if (rows[0].assignee_id) {
    const { rows: memberRows } = await sql`SELECT name, type, color FROM members WHERE id = ${rows[0].assignee_id}`;
    if (memberRows.length > 0) {
      rows[0].assignee_name = memberRows[0].name;
      rows[0].assignee_type = memberRows[0].type;
      rows[0].assignee_color = memberRows[0].color;
    }
  }

  return NextResponse.json(rows[0], { status: 201 });
}
