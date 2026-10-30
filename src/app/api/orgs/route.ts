import { NextRequest, NextResponse } from "next/server";
import { sql, withClient } from "../../../lib/sql";
import { initDb } from "../../../lib/db";
import { isReservedOrgSlug, orgSlugFromName } from "../../../lib/org-slug";
import { planSlugName, slugTaken } from "../../../lib/slug";
import { withSiblingNames } from "../../../lib/sibling-names";
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
  try {
    // Checked and written under the team's name lock, so a rename to the same
    // name at the same moment can't pass the check too.
    const result = await withClient((client) =>
      withSiblingNames(client, "org", teamId, async (query) => {
        const { rows: siblings } = await query("SELECT id, name, slug FROM organizations WHERE team_id = $1", [teamId]);
        const plan = planSlugName(ORG, name, siblings, null, orgSlugFromName);
        if (!plan.ok) return plan;
        // A slug asked for has to be free too. It's checked against stored slugs
        // only: an org renamed to HQ that kept `general` doesn't hold `hq`.
        const custom = customSlug ? slugTaken(ORG, customSlug, siblings) : null;
        if (custom) return custom;
        const slug = customSlug || plan.slug;
        const { rows: maxRows } = await query(
          "SELECT COALESCE(MAX(position), -1) as max FROM organizations WHERE team_id = $1", [teamId]
        );
        const { rows } = await query(
          "INSERT INTO organizations (team_id, name, slug, position) VALUES ($1, $2, $3, $4) RETURNING *",
          [teamId, plan.name, slug, maxRows[0].max + 1]
        );
        return { ok: true as const, org: rows[0] };
      })
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.org, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "Another organization already has that name or slug. Pick a different name." }, { status: 409 });
    }
    throw e;
  }
});
