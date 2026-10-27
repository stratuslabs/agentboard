import { initDb } from "../../../../lib/db";
import { NextRequest, NextResponse } from "next/server";
import { db as pool } from "../../../../lib/sql";
import { withTenant } from "../../../../lib/tenant";
import { parseSearchQuery, escapeLike } from "../../../../lib/card-search";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * Quick search: cards anywhere in the team, for the Cmd+K dialog.
 *
 *   GET /api/cards/search?q=login redirect&limit=20
 *
 * Reads the query the way the board filter does (src/lib/card-search.js):
 * every word has to match the title, description or labels, or name the card
 * by reference. `AB-12` is that card (old keys and pre-move numbers too), and
 * `#41` or `41` is the card with id 41 or number 41 in its product.
 *
 * Results that a reference names come first, then cards matching on the
 * title, then the rest; open cards before ones in a Done column, then most
 * recently updated. Each says where the card lives, so the dialog can show
 * it and open `/c/<key>`. A blank query finds nothing.
 */
export const GET = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();
  const sp = request.nextUrl.searchParams;
  const { terms } = parseSearchQuery(sp.get("q"));
  if (terms.length === 0) return NextResponse.json([]);

  const asked = Number.parseInt(sp.get("limit") ?? "", 10);
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT;

  const values: unknown[] = [teamId];
  const param = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };

  const matches: string[] = [];
  const inTitle: string[] = [];
  // Cards a word names outright (by id or key), and cards that only share a
  // number with one: `41` is card 41 first, then every product's #41.
  const named: string[] = [];
  const numbered: string[] = [];
  for (const term of terms) {
    const like = param(`%${escapeLike(term)}%`);
    const alternatives = [`cards.title ILIKE ${like}`, `cards.description ILIKE ${like}`, `cards.labels ILIKE ${like}`];
    inTitle.push(`cards.title ILIKE ${like}`);
    const ref = parseSearchQuery(term).refs[0];
    if (ref && "id" in ref) {
      const n = param(ref.id);
      named.push(`cards.id = ${n}`);
      numbered.push(`cards.number = ${n}`);
      alternatives.push(`cards.id = ${n}`, `cards.number = ${n}`);
    } else if (ref) {
      // Through card_numbers and product_keys, so an old key or a number from
      // before a move still finds the card, as /c/<key> does.
      const hit = `cards.id IN (
        SELECT cn.card_id FROM card_numbers cn
        JOIN product_keys pk ON pk.product_id = cn.product_id
        WHERE pk.team_id = $1 AND pk.key = ${param(ref.key)} AND cn.number = ${param(ref.number)})`;
      named.push(hit);
      alternatives.push(hit);
    }
    matches.push(`(${alternatives.join(" OR ")})`);
  }
  // Postgres refuses a bare constant in ORDER BY, so a rank with nothing to
  // rank by is left out.
  const rank = (conditions: string[]) => (conditions.length > 0 ? `(${conditions.join(" OR ")}) DESC, ` : "");

  const { rows } = await pool.query(
    `SELECT cards.id, cards.number, cards.title, cards.priority, cards.labels, cards.updated_at,
       CASE WHEN p.key IS NOT NULL AND cards.number IS NOT NULL
         THEN p.key || '-' || cards.number END AS key,
       p.key AS product_key, p.name AS product_name, p.slug AS product_slug, p.emoji AS product_emoji,
       o.name AS org_name, o.slug AS org_slug,
       b.name AS board_name, col.name AS column_name, col.color AS column_color,
       LOWER(col.name) = 'done' AS done,
       m.name AS assignee_name, m.type AS assignee_type, m.color AS assignee_color
     FROM cards
     JOIN columns col ON col.id = cards.column_id
     JOIN boards b ON b.id = col.board_id
     JOIN products p ON p.id = b.product_id
     JOIN organizations o ON o.id = p.org_id
     LEFT JOIN members m ON m.id = cards.assignee_id
     WHERE o.team_id = $1 AND ${matches.join(" AND ")}
     ORDER BY ${rank(named)}${rank(numbered)}(${inTitle.join(" AND ")}) DESC,
       (LOWER(col.name) = 'done') ASC,
       cards.updated_at DESC, cards.id DESC
     LIMIT ${param(limit)}`,
    values,
  );
  return NextResponse.json(rows);
});

