import { initDb } from "../../../../../lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "../../../../../lib/sql";
import { cardIdFromRef } from "../../../../../lib/card-location";
import { withTenantParams } from "../../../../../lib/tenant";

// GET /api/columns/by-card/:cardId
// Returns all columns for the board that contains the given card
export const GET = withTenantParams<{ id: string }>(async (_request: NextRequest, { teamId }, { params }) => {
  await initDb();
  // A numeric id or a readable key (AB-142). Names no card in the team: no
  // columns.
  const id = await cardIdFromRef(teamId, (await params).id);
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
});
