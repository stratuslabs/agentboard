import { initDb, slugify } from "../../../lib/db";
import { isUniqueViolation, planSlugName } from "../../../lib/slug";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "../../../lib/sql";
import { notifyBoard } from "../../../lib/realtime/notify";
import { DEFAULT_COLUMNS } from "../../../lib/default-columns";
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

  const { rows: siblings } = await sql`SELECT id, name, slug FROM boards WHERE product_id = ${product_id}`;
  const plan = planSlugName(BOARD, name, siblings, null);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });
  const { slug } = plan;

  // Set position to max+1
  const { rows: maxRows } = await sql`SELECT COALESCE(MAX(position), -1) AS max_pos FROM boards WHERE product_id = ${product_id}`;
  const position = maxRows[0].max_pos + 1;

  let rows;
  try {
    ({ rows } = await sql`
      INSERT INTO boards (product_id, name, slug, position)
      VALUES (${product_id}, ${plan.name}, ${slug}, ${position})
      RETURNING *
    `);
  } catch (err) {
    // Another request took the slug between the check and this write.
    if (isUniqueViolation(err)) return NextResponse.json({ error: TAKEN }, { status: 409 });
    throw err;
  }
  const board = rows[0];

  // Create default columns
  for (let j = 0; j < DEFAULT_COLUMNS.length; j++) {
    const col = DEFAULT_COLUMNS[j];
    const colSlug = slugify(col.name);
    await sql`
      INSERT INTO columns (board_id, name, slug, position, color)
      VALUES (${board.id}, ${col.name}, ${colSlug}, ${j}, ${col.color})
    `;
  }

  await notifyBoard(teamId, board.id);

  return NextResponse.json(board, { status: 201 });
});
