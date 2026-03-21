import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

export async function GET(request: NextRequest) {
  await initDb();
  const sp = request.nextUrl.searchParams;
  const view = sp.get("view");

  if (view === "today") {
    const { rows } = await sql`
      SELECT
        cards.*,
        m.name AS assignee_name,
        m.type AS assignee_type,
        m.color AS assignee_color,
        o.name AS org_name,
        p.name AS product_name,
        p.emoji AS product_emoji,
        b.name AS board_name,
        col.name AS column_name,
        col.color AS column_color
      FROM cards
      JOIN columns col ON cards.column_id = col.id
      JOIN boards b ON col.board_id = b.id
      JOIN products p ON b.product_id = p.id
      JOIN organizations o ON p.org_id = o.id
      LEFT JOIN members m ON cards.assignee_id = m.id
      WHERE cards.due_date = CURRENT_DATE
      ORDER BY p.name, cards.priority, cards.position
    `;
    return NextResponse.json(rows);
  }

  if (view === "assigned") {
    const memberId = sp.get("member_id");
    if (!memberId) {
      return NextResponse.json({ error: "member_id is required for assigned view" }, { status: 400 });
    }
    const { rows } = await sql`
      SELECT
        cards.*,
        m.name AS assignee_name,
        m.type AS assignee_type,
        m.color AS assignee_color,
        o.name AS org_name,
        p.name AS product_name,
        p.emoji AS product_emoji,
        b.name AS board_name,
        col.name AS column_name,
        col.color AS column_color
      FROM cards
      JOIN columns col ON cards.column_id = col.id
      JOIN boards b ON col.board_id = b.id
      JOIN products p ON b.product_id = p.id
      JOIN organizations o ON p.org_id = o.id
      LEFT JOIN members m ON cards.assignee_id = m.id
      WHERE cards.assignee_id = ${memberId}
        AND LOWER(col.name) != 'done'
      ORDER BY p.name, cards.priority, cards.position
    `;
    return NextResponse.json(rows);
  }

  return NextResponse.json({ error: "Invalid view. Use 'today' or 'assigned'." }, { status: 400 });
}
