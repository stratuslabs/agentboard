import { NextRequest, NextResponse } from "next/server";
import { sql } from "../../../lib/sql";
import { initDb } from "../../../lib/db";
import { isReservedOrgSlug, orgSlugFromName } from "../../../lib/org-slug";
import { planSlugName, slugConflict } from "../../../lib/slug";
import { withTenant } from "../../../lib/tenant";

const ORG = { kind: "organization", scope: "in this workspace" };

export const GET = withTenant(async (_request, { teamId }) => {
  await initDb();
  const { rows } = await sql`SELECT * FROM organizations WHERE team_id = ${teamId} ORDER BY position, name`;
  return NextResponse.json(rows);
});

export const POST = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const { name, slug: customSlug } = await request.json();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  if (customSlug && isReservedOrgSlug(customSlug)) {
    return NextResponse.json(
      { error: `"${customSlug}" is reserved for the app's own pages; pick another slug` },
      { status: 400 }
    );
  }
  const { rows: siblings } = await sql`SELECT id, name, slug FROM organizations WHERE team_id = ${teamId}`;
  const plan = planSlugName(ORG, name, siblings, null, orgSlugFromName);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });
  // A slug asked for has to be free too; it's checked as a slug, not a name.
  const custom = customSlug ? slugConflict(ORG, customSlug, customSlug, siblings) : null;
  if (custom) return NextResponse.json({ error: custom.error }, { status: custom.status });
  const slug = customSlug || plan.slug;
  const { rows: maxRows } = await sql`SELECT COALESCE(MAX(position), -1) as max FROM organizations WHERE team_id = ${teamId}`;

  try {
    const { rows } = await sql`
      INSERT INTO organizations (team_id, name, slug, position)
      VALUES (${teamId}, ${plan.name}, ${slug}, ${maxRows[0].max + 1})
      RETURNING *
    `;
    return NextResponse.json(rows[0], { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "Another organization already has that name or slug. Pick a different name." }, { status: 409 });
    }
    throw e;
  }
});
