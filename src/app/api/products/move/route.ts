import { initDb } from "../../../../lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "../../../../lib/sql";
import { assertOrg, assertProduct, withTenant } from "../../../../lib/tenant";

export const PATCH = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const body = await request.json();

  if (!body.product_id || !body.org_id) {
    return NextResponse.json({ error: "product_id and org_id required" }, { status: 400 });
  }
  // Both ends in the team: a product never moves into another team's org.
  const product_id = await assertProduct(teamId, body.product_id);
  const org_id = await assertOrg(teamId, body.org_id);
  const position = body.position;

  const pos = position ?? 0;
  const { rows } = await sql`
    UPDATE products SET org_id = ${org_id}, position = ${pos} WHERE id = ${product_id} RETURNING *
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
});
