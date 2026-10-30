import { initDb } from "../../../../lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "../../../../lib/sql";
import { withTenant } from "../../../../lib/tenant";
import { withCardUrl } from "../../../../lib/public-url";

// Every view joins up to organizations and filters on the team, so a member id
// from another team, like one that doesn't exist, matches no cards.
export const GET = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const sp = request.nextUrl.searchParams;
  const view = sp.get("view");

  if (view === "past-due") {
    const tz = sp.get("tz") || "UTC";
    const memberId = sp.get("member_id");
    if (!memberId) {
      return NextResponse.json({ error: "member_id is required for past-due view" }, { status: 400 });
    }
    const { rows } = await sql`
      SELECT
        cards.*,
        m.name AS assignee_name,
        m.type AS assignee_type,
        m.color AS assignee_color,
        o.id AS org_id,
        o.name AS org_name,
        o.slug AS org_slug,
        p.name AS product_name,
        p.slug AS product_slug,
        p.emoji AS product_emoji,
        p.key AS product_key,
        p.id AS product_id,
        b.id AS board_id,
        b.name AS board_name,
        b.slug AS board_slug,
        col.name AS column_name,
        col.slug AS column_slug,
        p.slug AS product_slug,
        col.color AS column_color
      FROM cards
      JOIN columns col ON cards.column_id = col.id
      JOIN boards b ON col.board_id = b.id
      JOIN products p ON b.product_id = p.id
      JOIN organizations o ON p.org_id = o.id
      LEFT JOIN members m ON cards.assignee_id = m.id
      WHERE o.team_id = ${teamId}
        AND cards.assignee_id = ${memberId}
        AND cards.due_date < (NOW() AT TIME ZONE ${tz})::date
        AND LOWER(col.name) != 'done'
      ORDER BY cards.due_date ASC, cards.priority, cards.position
    `;
    return NextResponse.json(withCardUrl(request, rows));
  }

  if (view === "past-due-count") {
    const tz = sp.get("tz") || "UTC";
    const memberId = sp.get("member_id");
    if (!memberId) {
      return NextResponse.json({ error: "member_id is required" }, { status: 400 });
    }
    const { rows } = await sql`
      SELECT COUNT(*)::int AS count
      FROM cards
      JOIN columns col ON cards.column_id = col.id
      JOIN boards b ON col.board_id = b.id
      JOIN products p ON b.product_id = p.id
      JOIN organizations o ON p.org_id = o.id
      WHERE o.team_id = ${teamId}
        AND cards.assignee_id = ${memberId}
        AND cards.due_date < (NOW() AT TIME ZONE ${tz})::date
        AND LOWER(col.name) != 'done'
    `;
    return NextResponse.json({ count: rows[0].count });
  }

  if (view === "today") {
    const tz = sp.get("tz") || "UTC";
    const { rows } = await sql`
      SELECT
        cards.*,
        m.name AS assignee_name,
        m.type AS assignee_type,
        m.color AS assignee_color,
        o.id AS org_id,
        o.name AS org_name,
        o.slug AS org_slug,
        p.name AS product_name,
        p.slug AS product_slug,
        p.emoji AS product_emoji,
        p.key AS product_key,
        p.id AS product_id,
        b.id AS board_id,
        b.name AS board_name,
        b.slug AS board_slug,
        col.name AS column_name,
        col.slug AS column_slug,
        p.slug AS product_slug,
        col.color AS column_color
      FROM cards
      JOIN columns col ON cards.column_id = col.id
      JOIN boards b ON col.board_id = b.id
      JOIN products p ON b.product_id = p.id
      JOIN organizations o ON p.org_id = o.id
      LEFT JOIN members m ON cards.assignee_id = m.id
      WHERE o.team_id = ${teamId}
        AND cards.due_date = (NOW() AT TIME ZONE ${tz})::date
      ORDER BY p.name, cards.priority, cards.position
    `;
    return NextResponse.json(withCardUrl(request, rows));
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
        o.id AS org_id,
        o.name AS org_name,
        o.slug AS org_slug,
        p.name AS product_name,
        p.slug AS product_slug,
        p.emoji AS product_emoji,
        p.key AS product_key,
        p.id AS product_id,
        b.id AS board_id,
        b.name AS board_name,
        b.slug AS board_slug,
        col.name AS column_name,
        col.slug AS column_slug,
        p.slug AS product_slug,
        col.color AS column_color
      FROM cards
      JOIN columns col ON cards.column_id = col.id
      JOIN boards b ON col.board_id = b.id
      JOIN products p ON b.product_id = p.id
      JOIN organizations o ON p.org_id = o.id
      LEFT JOIN members m ON cards.assignee_id = m.id
      WHERE o.team_id = ${teamId}
        AND cards.assignee_id = ${memberId}
        AND LOWER(col.name) != 'done'
      ORDER BY p.name, cards.priority, cards.position
    `;
    return NextResponse.json(withCardUrl(request, rows));
  }

  return NextResponse.json({ error: "Invalid view. Use 'today' or 'assigned'." }, { status: 400 });
});
