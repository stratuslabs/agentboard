import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql, db as pool } from "@/lib/sql";
import { boardIdForCard, notifyBoards } from "@/lib/realtime/notify";
import { cardIdFromRef, getCardWithLocation } from "@/lib/card-location";
import { checkCardText } from "@/lib/card-text";
import { memberIdByName, resolveAgentMember } from "@/lib/members";
import { assertColumn, assertMember, withTenantParams } from "@/lib/tenant";

export const GET = withTenantParams<{ id: string }>(async (_request, { teamId }, { params }) => {
  await initDb();
  const { id } = await params;
  const card = await getCardWithLocation(teamId, id);
  if (!card) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(card);
});

export const PATCH = withTenantParams<{ id: string }>(async (request: NextRequest, { teamId }, { params }) => {
  await initDb();
  // A numeric id or a readable key (AB-142), in the team; from here on, the
  // internal id.
  const id = await cardIdFromRef(teamId, (await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json();
  const textError = checkCardText(body);
  if (textError) {
    return NextResponse.json({ error: textError }, { status: 400 });
  }

  const { rows: existing } = await sql`SELECT * FROM cards WHERE id = ${id}`;
  if (existing.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // A card can only move to a column, or be assigned to a member, of its own
  // team.
  if (body.column_id !== undefined) body.column_id = await assertColumn(teamId, body.column_id);
  if (body.assignee_id !== undefined && body.assignee_id !== null) {
    body.assignee_id = await assertMember(teamId, body.assignee_id);
  }

  // Resolved before the update: a column change can move the card to a board
  // whose watchers also need to hear that it left.
  const boardBefore = await boardIdForCard(id);

  // Auto-register agent from X-Agent-Name header
  const agentName = request.headers.get("x-agent-name");
  if (agentName && body.assignee_id === undefined) {
    body.assignee_id = await resolveAgentMember(teamId, agentName);
  }

  // Resolve text assignee name to member ID if no assignee_id provided
  if (body.assignee && body.assignee_id === undefined) {
    const memberId = await memberIdByName(teamId, body.assignee);
    if (memberId !== null) {
      body.assignee_id = memberId;
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
  await pool.query(query, values);

  await notifyBoards(teamId, [boardBefore, await boardIdForCard(id)]);

  // Re-read with member, location and readable key: a column change may have
  // given the card a new number in another product.
  return NextResponse.json(await getCardWithLocation(teamId, id));
});

export const DELETE = withTenantParams<{ id: string }>(async (_request, { teamId }, { params }) => {
  await initDb();
  const id = await cardIdFromRef(teamId, (await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Resolved first: once the row is gone there is no board left to name.
  const boardId = await boardIdForCard(id);
  const result = await sql`DELETE FROM cards WHERE id = ${id}`;
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await notifyBoards(teamId, [boardId]);
  return NextResponse.json({ success: true });
});
