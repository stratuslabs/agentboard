import { sql } from "@/lib/sql";

// A card joined to the column, board and product it lives on, so a caller
// that just moved it can see where it landed without a second request.
export async function getCardWithLocation(id: string | number) {
  const { rows } = await sql`
    SELECT cards.*,
      m.name AS assignee_name, m.type AS assignee_type, m.color AS assignee_color,
      col.slug AS column_slug, col.name AS column_name,
      b.id AS board_id, b.slug AS board_slug, b.name AS board_name,
      p.id AS product_id, p.slug AS product_slug, p.name AS product_name
    FROM cards
    JOIN columns col ON col.id = cards.column_id
    JOIN boards b ON b.id = col.board_id
    JOIN products p ON p.id = b.product_id
    LEFT JOIN members m ON cards.assignee_id = m.id
    WHERE cards.id = ${id}
  `;
  return rows[0] ?? null;
}
