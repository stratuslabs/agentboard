import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql, withClient } from "@/lib/sql";
import { boardIdsUnderProducts, notifyBoards } from "@/lib/realtime/notify";
import { assertProduct, withTenantParams } from "@/lib/tenant";
import { parseDefaultBoardId } from "@/lib/default-board";
import { normalizeProductKey } from "@/lib/card-keys";
import { updateProduct } from "@/lib/product-update";

export const PATCH = withTenantParams<{ id: string }>(async (request: NextRequest, { teamId }, { params }) => {
  await initDb();
  const productId = await assertProduct(teamId, (await params).id);
  const body = await request.json();

  // Validate everything before writing anything, so a bad request changes
  // nothing.
  const defaultBoard = parseDefaultBoardId(body.default_board_id);
  if ("error" in defaultBoard) {
    return NextResponse.json({ error: defaultBoard.error }, { status: 400 });
  }
  const keyChange = body.key === undefined ? null : normalizeProductKey(body.key);
  if (keyChange && "error" in keyChange) {
    return NextResponse.json({ error: keyChange.error }, { status: 400 });
  }
  if (!body.name && !body.emoji && !defaultBoard.present && !keyChange) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  if (defaultBoard.present && defaultBoard.value !== null) {
    const { rows: board } = await sql`
      SELECT id FROM boards WHERE id = ${defaultBoard.value} AND product_id = ${productId}
    `;
    if (board.length === 0) {
      return NextResponse.json(
        { error: `Board ${defaultBoard.value} is not a board of this product` },
        { status: 400 }
      );
    }
  }

  // One transaction: a later failure (a name whose slug is taken) must not
  // leave an earlier change (the key) applied.
  const updated = await withClient((client) =>
    updateProduct(client, productId, {
      key: keyChange ? keyChange.key : undefined,
      name: body.name || undefined,
      emoji: body.emoji || undefined,
      defaultBoard,
    })
  );
  if ("error" in updated) {
    return NextResponse.json({ error: updated.error }, { status: updated.status });
  }
  return NextResponse.json(updated.product);
});

export const DELETE = withTenantParams<{ id: string }>(async (_request, { teamId }, { params }) => {
  await initDb();
  const { id } = await params;
  const numId = parseInt(id, 10);

  // By id or slug, only ever among the team's products.
  const { rows: products } = Number.isNaN(numId)
    ? await sql`
        SELECT p.id FROM products p JOIN organizations o ON o.id = p.org_id
        WHERE o.team_id = ${teamId} AND p.slug = ${id}`
    : await sql`
        SELECT p.id FROM products p JOIN organizations o ON o.id = p.org_id
        WHERE o.team_id = ${teamId} AND (p.id = ${numId} OR p.slug = ${id})`;
  const productIds: number[] = products.map((p) => p.id);

  // The delete cascades through boards, columns and cards without any of those
  // routes running, so nothing else would announce it. Resolved while the rows
  // still exist.
  const boardIds = await boardIdsUnderProducts(productIds);

  const result = productIds.length === 0
    ? { rowCount: 0 }
    : await sql`DELETE FROM products WHERE id = ANY(${productIds})`;

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await notifyBoards(teamId, boardIds);

  return NextResponse.json({ success: true });
});
