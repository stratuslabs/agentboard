import { NextRequest, NextResponse } from "next/server";
import { sql, withClient } from "../../../lib/sql";
import { initDb, createDefaultBoards } from "../../../lib/db";
import { planSlugName } from "../../../lib/slug";
import { withSiblingNames } from "../../../lib/sibling-names";
import { suggestEmoji } from "../../../lib/emoji-suggest";
import { createProductWithKey } from "../../../lib/card-keys";
import { assertOrg, found, withTenant } from "../../../lib/tenant";
import { resolveScope } from "../../../lib/scope-params";

export const GET = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const { org: orgId } = await resolveScope(teamId, request.nextUrl.searchParams, ["org"]);

  let rows;
  if (orgId) {
    // Another team's org has no products, like one that doesn't exist.
    const scoped = await found(assertOrg(teamId, orgId));
    if (scoped === null) return NextResponse.json([]);
    ({ rows } = await sql`SELECT * FROM products WHERE org_id = ${scoped} ORDER BY position, name`);
  } else {
    ({ rows } = await sql`
      SELECT p.* FROM products p JOIN organizations o ON o.id = p.org_id
      WHERE o.team_id = ${teamId}
      ORDER BY p.position, p.name
    `);
  }
  return NextResponse.json(rows);
});

export const POST = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const { org_id: rawOrgId, name, emoji, key: requestedKey } = await request.json();
  if (!rawOrgId || !name) {
    return NextResponse.json({ error: "org_id and name are required" }, { status: 400 });
  }
  const org_id = await assertOrg(teamId, rawOrgId);

  try {
    // Checked and written under the org's name lock, so a rename to the same
    // name at the same moment can't pass the check too (card 815).
    const created = await withClient((client) =>
      withSiblingNames(client, "product", org_id, async (query) => {
        const { rows: siblings } = await query("SELECT id, name, slug FROM products WHERE org_id = $1", [org_id]);
        const plan = planSlugName({ kind: "product", scope: "in this org" }, name, siblings, null);
        if (!plan.ok) return { error: plan.error, status: plan.status };
        const { rows: maxRows } = await query(
          "SELECT COALESCE(MAX(position), -1) as max FROM products WHERE org_id = $1", [org_id]
        );
        // The prefix for its cards' readable ids (AB-142): the one asked for, or
        // one derived from the name, derived again if another request takes it.
        // Each try is a savepoint, so a taken key doesn't end the transaction.
        return createProductWithKey(query, teamId, name, requestedKey, async (key: string) => {
          await query("SAVEPOINT product_key");
          try {
            const { rows } = await query(
              `INSERT INTO products (org_id, name, slug, emoji, position, key)
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
              [org_id, plan.name, plan.slug, emoji || suggestEmoji(plan.name), maxRows[0].max + 1, key]
            );
            await query("RELEASE SAVEPOINT product_key");
            return rows[0];
          } catch (err) {
            await query("ROLLBACK TO SAVEPOINT product_key");
            throw err;
          }
        });
      })
    );
    if ("error" in created) {
      return NextResponse.json({ error: created.error }, { status: created.status });
    }

    const productId = created.product.id;
    await createDefaultBoards(teamId, productId);

    // Re-read: creating the boards set the product's default board.
    const { rows: product } = await sql`SELECT * FROM products WHERE id = ${productId}`;
    return NextResponse.json(product[0], { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "Another product in this org already uses that slug. Pick a different name." }, { status: 409 });
    }
    throw e;
  }
});
