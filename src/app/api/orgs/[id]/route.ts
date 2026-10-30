import { initDb } from "../../../../lib/db";
import { orgSlugFromName } from "../../../../lib/org-slug";
import { isUniqueViolation, planSlugName } from "../../../../lib/slug";
import { NextRequest, NextResponse } from "next/server";
import { sql, withClient } from "../../../../lib/sql";
import { withSiblingNames } from "../../../../lib/sibling-names";
import { boardIdsUnderOrgs, notifyBoards } from "../../../../lib/realtime/notify";
import { assertOrg, withTenantParams } from "../../../../lib/tenant";

export const PATCH = withTenantParams<{ id: string }>(async (request: NextRequest, { teamId }, { params }) => {
  await initDb();
  const orgId = await assertOrg(teamId, (await params).id);
  const { name } = await request.json();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  // The slug stays: every product URL under the org starts with it. The new
  // name still can't be one another org has, or makes.
  // Checked and written under the team's name lock (card 815).
  let result;
  try {
    result = await withClient((client) =>
      withSiblingNames(client, "org", teamId, async (query) => {
        const { rows: siblings } = await query("SELECT id, name, slug FROM organizations WHERE team_id = $1", [teamId]);
        const plan = planSlugName(
          { kind: "organization", scope: "in this workspace" }, name, siblings, orgId, orgSlugFromName
        );
        if (!plan.ok) return plan;
        const { rows } = await query(
          "UPDATE organizations SET name = $1 WHERE id = $2 AND team_id = $3 RETURNING *", [plan.name, orgId, teamId]
        );
        return { ok: true as const, rows };
      })
    );
  } catch (err) {
    // Another request took the name between the check and this write.
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "Another organization already has that name. Pick a different name." }, { status: 409 });
    }
    throw err;
  }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const { rows } = result;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
});

export const DELETE = withTenantParams<{ id: string }>(async (_request, { teamId }, { params }) => {
  await initDb();
  const { id } = await params;
  const numId = parseInt(id, 10);

  // By id or slug, only ever among the team's organizations.
  const { rows: orgs } = Number.isNaN(numId)
    ? await sql`SELECT id FROM organizations WHERE team_id = ${teamId} AND slug = ${id}`
    : await sql`SELECT id FROM organizations WHERE team_id = ${teamId} AND (id = ${numId} OR slug = ${id})`;
  const orgIds: number[] = orgs.map((o) => o.id);

  // Same cascade as a product delete, one level up.
  const boardIds = await boardIdsUnderOrgs(orgIds);

  const result = orgIds.length === 0
    ? { rowCount: 0 }
    : await sql`DELETE FROM organizations WHERE team_id = ${teamId} AND id = ANY(${orgIds})`;

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await notifyBoards(teamId, boardIds);

  return NextResponse.json({ success: true });
});
