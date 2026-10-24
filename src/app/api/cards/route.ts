import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql, db as pool } from "@/lib/sql";
import { boardIdForColumn, notifyBoard } from "@/lib/realtime/notify";
import { checkCardText } from "@/lib/card-text";
import { getCardWithLocation } from "@/lib/card-location";
import { memberIdByName, resolveAgentMember } from "@/lib/members";
import { assertColumn, assertMember, withTenant } from "@/lib/tenant";

export const GET = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const sp = request.nextUrl.searchParams;
  const boardId = sp.get("board_id");
  const columnId = sp.get("column_id");
  const assignee = sp.get("assignee");
  const assigneeId = sp.get("assignee_id");
  const priority = sp.get("priority");
  const label = sp.get("label");

  // Every card query joins up to organizations, so the team filter always
  // applies, whatever else is asked for.
  const conditions: string[] = ["o.team_id = $1"];
  const values: unknown[] = [teamId];
  let paramIdx = 2;

  const baseQuery = `SELECT cards.*, m.name AS assignee_name, m.type AS assignee_type, m.color AS assignee_color
    FROM cards
    JOIN columns ON cards.column_id = columns.id
    JOIN boards b ON b.id = columns.board_id
    JOIN products p ON p.id = b.product_id
    JOIN organizations o ON o.id = p.org_id
    LEFT JOIN members m ON cards.assignee_id = m.id`;

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
});

export const POST = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const body = await request.json();
  const textError = checkCardText(body);
  if (textError) {
    return NextResponse.json({ error: textError }, { status: 400 });
  }
  const { title, description, assignee, priority, labels, github_issue_url, github_pr_url, due_date } = body;
  let { assignee_id } = body;

  if (!body.column_id || !title) {
    return NextResponse.json({ error: "column_id and title are required" }, { status: 400 });
  }
  const column_id = await assertColumn(teamId, body.column_id);
  // An assignee from another team is refused, not silently attached.
  if (assignee_id) assignee_id = await assertMember(teamId, assignee_id);

  // Auto-register agent from X-Agent-Name header
  const agentName = request.headers.get("x-agent-name");
  if (agentName && !assignee_id) {
    assignee_id = await resolveAgentMember(teamId, agentName);
  }

  // Resolve text assignee name to member ID if no assignee_id provided
  if (!assignee_id && assignee) {
    assignee_id = await memberIdByName(teamId, assignee);
  }

  const { rows: maxRows } = await sql`SELECT COALESCE(MAX(position), -1) as max FROM cards WHERE column_id = ${column_id}`;

  const { rows } = await sql`
    INSERT INTO cards (column_id, title, description, assignee, assignee_id, priority, labels, github_issue_url, github_pr_url, due_date, position)
    VALUES (${column_id}, ${title}, ${description || ""}, ${assignee || null}, ${assignee_id || null}, ${priority || "medium"}, ${labels || ""}, ${github_issue_url || null}, ${github_pr_url || null}, ${due_date || null}, ${maxRows[0].max + 1})
    RETURNING id
  `;

  await notifyBoard(teamId, await boardIdForColumn(column_id));

  // With member info, location and the readable key the trigger assigned.
  return NextResponse.json(await getCardWithLocation(teamId, rows[0].id), { status: 201 });
});
