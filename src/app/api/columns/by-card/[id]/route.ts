import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";
import { cardIdFromRef } from "@/lib/card-location";

// GET /api/columns/by-card/:cardId
// Returns all columns for the board that contains the given card
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  // A numeric id or a readable key (AB-142). Names no card: no columns.
  const id = await cardIdFromRef((await params).id);
  if (id === null) return NextResponse.json([]);

  const { rows } = await sql`
    SELECT col.*
    FROM columns col
    JOIN columns card_col ON card_col.board_id = col.board_id
    JOIN cards c ON c.column_id = card_col.id
    WHERE c.id = ${id}
    ORDER BY col.position
  `;

  return NextResponse.json(rows);
}
