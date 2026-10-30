import { initDb } from "../../../lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql, db as pool } from "../../../lib/sql";
import { boardIdForColumn, notifyBoard } from "../../../lib/realtime/notify";
import { checkCardText } from "../../../lib/card-text";
import { getCardWithLocation } from "../../../lib/card-location";
import { memberIdByName, resolveAgentMember } from "../../../lib/members";
import { settleAssignee } from "../../../lib/assignee";
import { assertColumn, assertMember, withTenant } from "../../../lib/tenant";
import { resolveScope } from "../../../lib/scope-params";
import { withCardUrl } from "../../../lib/public-url";

export const GET = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const sp = request.nextUrl.searchParams;
  const scope = await resolveScope(teamId, sp, ["org", "product", "board", "column"]);
  const { org: orgId, product: productId, board: boardId, column: columnId } = scope;
  const assignee = sp.get("assignee");
  const assigneeId = sp.get("assignee_id");
  const priority = sp.get("priority");
  const label = sp.get("label");

  // Every card query joins up to organizations, so the team filter always
  // applies, whatever else is asked for.
  const conditions: string[] = ["o.team_id = $1"];
  const values: unknown[] = [teamId];
  let paramIdx = 2;

  // Each row says where the card lives, with the same fields as a single card
  // (getCardWithLocation), so a list needs no lookup per column to read.
  const baseQuery = `SELECT cards.*, m.name AS assignee_name, m.type AS assignee_type, m.color AS assignee_color,
      columns.slug AS column_slug, columns.name AS column_name,
      b.id AS board_id, b.slug AS board_slug, b.name AS board_name,
      p.id AS product_id, p.slug AS product_slug, p.name AS product_name,
      p.key AS product_key,
      CASE WHEN p.key IS NOT NULL AND cards.number IS NOT NULL
        THEN p.key || '-' || cards.number END AS key,
      o.slug AS org_slug
    FROM cards
    JOIN columns ON cards.column_id = columns.id
    JOIN boards b ON b.id = columns.board_id
    JOIN products p ON p.id = b.product_id
    JOIN organizations o ON o.id = p.org_id
    LEFT JOIN members m ON cards.assignee_id = m.id`;

  if (orgId) {
    conditions.push(`o.id = $${paramIdx++}`);
    values.push(orgId);
  }

  if (productId) {
    conditions.push(`p.id = $${paramIdx++}`);
    values.push(productId);
  }

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
    // By member name, or by the text name of a card filed under no member. A
    // card written before card 838 can carry stale text beside its member;
    // the member is who it's filed under.
    conditions.push(`(m.name = $${paramIdx} OR (cards.assignee_id IS NULL AND cards.assignee = $${paramIdx}))`);
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
  return NextResponse.json(withCardUrl(request, rows));
});

export const POST = withTenant(async (request: NextRequest, { teamId, memberId }) => {
  await initDb();
  const body = await request.json();
  const textError = checkCardText(body);
  if (textError) {
    return NextResponse.json({ error: textError }, { status: 400 });
  }
  const { title, description, priority, labels, github_issue_url, github_pr_url, due_date } = body;

  if (!body.column_id || !title) {
    return NextResponse.json({ error: "column_id and title are required" }, { status: 400 });
  }
  const column_id = await assertColumn(teamId, body.column_id);
  // An assignee from another team is refused, not silently attached.
  const namedId = body.assignee_id ? await assertMember(teamId, body.assignee_id) : undefined;

  // Who the card is filed under, most explicit first. A named assignee, by id
  // or by name, is the caller's choice and wins, and is stored as one field
  // (a member, or text for a name that matches nobody), never both. Without
  // one, the card goes to whoever is calling: a credential issued to one
  // agent says who that is, and X-Agent-Name is only a claim, so it counts
  // only when the credential doesn't name an agent. A name that matches
  // nobody stays as text rather than being quietly filed under the caller.
  const named = await settleAssignee(
    { assignee: body.assignee, assignee_id: namedId },
    (name) => memberIdByName(teamId, name),
  );
  let assignee_id = named?.assignee_id ?? null;
  const assignee = named?.assignee ?? null;
  const credentialMember = memberId ?? null;
  if (!assignee_id && !assignee && credentialMember !== null) {
    assignee_id = await assertMember(teamId, credentialMember);
  }
  const agentName = request.headers.get("x-agent-name");
  if (!assignee_id && !assignee && agentName && credentialMember === null) {
    assignee_id = await resolveAgentMember(teamId, agentName);
  }

  const { rows: maxRows } = await sql`SELECT COALESCE(MAX(position), -1) as max FROM cards WHERE column_id = ${column_id}`;

  const { rows } = await sql`
    INSERT INTO cards (column_id, title, description, assignee, assignee_id, priority, labels, github_issue_url, github_pr_url, due_date, position)
    VALUES (${column_id}, ${title}, ${description || ""}, ${assignee || null}, ${assignee_id || null}, ${priority || "medium"}, ${labels || ""}, ${github_issue_url || null}, ${github_pr_url || null}, ${due_date || null}, ${maxRows[0].max + 1})
    RETURNING id
  `;

  await notifyBoard(teamId, await boardIdForColumn(column_id));

  // With member info, location and the readable key the trigger assigned.
  return NextResponse.json(withCardUrl(request, await getCardWithLocation(teamId, rows[0].id)), { status: 201 });
});
