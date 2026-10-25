import { initDb } from "@/lib/db";
import { orgSlugFromName } from "@/lib/org-slug";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";
import { boardIdsUnderOrgs, notifyBoards } from "@/lib/realtime/notify";
import { assertOrg, withTenantParams } from "@/lib/tenant";

export const PATCH = withTenantParams<{ id: string }>(async (request: NextRequest, { teamId }, { params }) => {
  await initDb();
  const orgId = await assertOrg(teamId, (await params).id);
  const { name } = await request.json();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  const slug = orgSlugFromName(name);
  const { rows } = await sql`
    UPDATE organizations SET name = ${name}, slug = ${slug} WHERE id = ${orgId} AND team_id = ${teamId} RETURNING *
  `;
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
