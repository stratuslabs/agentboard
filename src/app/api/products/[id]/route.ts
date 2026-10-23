import { initDb, slugify } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";
import { boardIdsUnderProduct, notifyBoards } from "@/lib/realtime/notify";
import { parseDefaultBoardId } from "@/lib/default-board";

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
  if (!body.name && !body.emoji && !defaultBoard.present) {
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

  if (body.name) {
    await sql`UPDATE products SET name = ${body.name}, slug = ${slugify(body.name)} WHERE id = ${productId}`;
  }
  if (body.emoji) {
    await sql`UPDATE products SET emoji = ${body.emoji} WHERE id = ${productId}`;
  }
  if (defaultBoard.present) {
    await sql`UPDATE products SET default_board_id = ${defaultBoard.value} WHERE id = ${productId}`;
  }

  const { rows: final } = await sql`SELECT * FROM products WHERE id = ${productId}`;
  return NextResponse.json(final[0]);
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
