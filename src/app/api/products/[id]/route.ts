import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql, withClient } from "@/lib/sql";
import { boardIdsUnderProduct, notifyBoards } from "@/lib/realtime/notify";
import { parseDefaultBoardId } from "@/lib/default-board";
import { normalizeProductKey } from "@/lib/card-keys";
import { updateProduct } from "@/lib/product-update";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const productId = parseInt(id, 10);
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
  const { rows: existing } = await sql`SELECT id FROM products WHERE id = ${productId}`;
  if (existing.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const numId = parseInt(id, 10);

  // The delete cascades through boards, columns and cards without any of those
  // routes running, so nothing else would announce it. Resolved while the rows
  // still exist.
  const boardIds = await boardIdsUnderProduct(id);

  let result;
  if (!isNaN(numId)) {
    result = await sql`DELETE FROM products WHERE id = ${numId} OR slug = ${id}`;
  } else {
    result = await sql`DELETE FROM products WHERE slug = ${id}`;
  }

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await notifyBoards(boardIds);

  return NextResponse.json({ success: true });
}
