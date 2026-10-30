import { initDb, teamDefaultColumns } from "../../../lib/db";
import { isUniqueViolation, planSlugName } from "../../../lib/slug";
import { NextRequest, NextResponse } from "next/server";
import { sql, withClient } from "../../../lib/sql";
import { withSiblingNames } from "../../../lib/sibling-names";
import { notifyBoard } from "../../../lib/realtime/notify";
import { assertProduct, found, withTenant } from "../../../lib/tenant";
import { resolveScope } from "../../../lib/scope-params";

const BOARD = { kind: "board", scope: "in this product" };
const TAKEN = "Another board in this product already uses that slug. Pick a different name.";

export const GET = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const { product: rawProductId } = await resolveScope(teamId, request.nextUrl.searchParams, [
    "org",
    "product",
  ]);

  if (!rawProductId) {
    return NextResponse.json({ error: "product_id or product is required" }, { status: 400 });
  }
  // Another team's product has no boards, like one that doesn't exist.
  const productId = await found(assertProduct(teamId, rawProductId));
  if (productId === null) return NextResponse.json([]);

  const { rows } = await sql`SELECT * FROM boards WHERE product_id = ${productId} ORDER BY position`;
  return NextResponse.json(rows);
});

export const POST = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const body = await request.json();
  const { name } = body;

  if (!body.product_id || !name) {
    return NextResponse.json({ error: "product_id and name are required" }, { status: 400 });
  }
  const product_id = await assertProduct(teamId, body.product_id);

  // Checked and written under the product's name lock, so a rename to the
  // same name at the same moment can't pass the check too (card 815).
  let added;
  try {
    added = await withClient((client) =>
      withSiblingNames(client, "board", product_id, async (query) => {
        const { rows: siblings } = await query("SELECT id, name, slug FROM boards WHERE product_id = $1", [product_id]);
        const plan = planSlugName(BOARD, name, siblings, null);
        if (!plan.ok) return plan;
        // Set position to max+1
        const { rows: maxRows } = await query(
          "SELECT COALESCE(MAX(position), -1) AS max_pos FROM boards WHERE product_id = $1", [product_id]
        );
        const { rows } = await query(
          "INSERT INTO boards (product_id, name, slug, position) VALUES ($1, $2, $3, $4) RETURNING *",
          [product_id, plan.name, plan.slug, maxRows[0].max_pos + 1]
        );
        return { ok: true as const, board: rows[0] };
      })
    );
  } catch (err) {
    // A slug taken some other way than through this check.
    if (isUniqueViolation(err)) return NextResponse.json({ error: TAKEN }, { status: 409 });
    throw err;
  }
  if (!added.ok) return NextResponse.json({ error: added.error }, { status: added.status });
  const { board } = added;

  // The team's Default columns, the same list a new product's boards get.
  const cols = await teamDefaultColumns(teamId);
  for (let j = 0; j < cols.length; j++) {
    const { item: col, slug: colSlug } = cols[j];
    await sql`
      INSERT INTO columns (board_id, name, slug, position, color)
      VALUES (${board.id}, ${col.name}, ${colSlug}, ${j}, ${col.color})
    `;
  }

  await notifyBoard(teamId, board.id);

  return NextResponse.json(board, { status: 201 });
});
