import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";
import { boardIdForCard, notifyBoard } from "@/lib/realtime/notify";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  // The owning card is read before the delete, while the row still points at it.
  const { rows: owner } = await sql`SELECT card_id FROM attachments WHERE id = ${id}`;
  const cardId = owner.length > 0 ? owner[0].card_id : null;

  const result = await sql`DELETE FROM attachments WHERE id = ${id}`;
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (cardId !== null) {
    await sql`UPDATE cards SET updated_at = NOW() WHERE id = ${cardId}`;
    await notifyBoard(await boardIdForCard(cardId));
  }

  return NextResponse.json({ success: true });
}
