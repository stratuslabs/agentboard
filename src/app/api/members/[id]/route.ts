import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";
import {
  boardIdsForCards,
  cardIdsForMember,
  notifyBoards,
  stampCards,
} from "@/lib/realtime/notify";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const body = await request.json();

  const { rows: existing } = await sql`SELECT * FROM members WHERE id = ${id}`;
  if (existing.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.type !== undefined) updates.type = body.type;
  if (body.color !== undefined) updates.color = body.color;
  if (body.avatar_url !== undefined) updates.avatar_url = body.avatar_url;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(existing[0]);
  }

  const member = existing[0];
  const { rows } = await sql`
    UPDATE members SET
      name = ${(updates.name as string) ?? member.name},
      type = ${(updates.type as string) ?? member.type},
      color = ${(updates.color as string) ?? member.color},
      avatar_url = ${(updates.avatar_url as string) ?? member.avatar_url}
    WHERE id = ${id}
    RETURNING *
  `;

  // Cards show this member's name, type and colour through a join, so editing
  // one changes what they render without touching a card row. Stamping them is
  // what puts them in the next delta.
  const cardIds = await cardIdsForMember(id);
  await stampCards(cardIds);
  await notifyBoards(await boardIdsForCards(cardIds));

  return NextResponse.json(rows[0]);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;

  // Captured first: deleting the member sets assignee_id to NULL on these
  // cards, and afterwards there is nothing left to find them by. The cards
  // become unassigned, which is a visible change nobody would otherwise see.
  const cardIds = await cardIdsForMember(id);
  const boardIds = await boardIdsForCards(cardIds);

  const result = await sql`DELETE FROM members WHERE id = ${id}`;
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await stampCards(cardIds);
  await notifyBoards(boardIds);

  return NextResponse.json({ success: true });
}
