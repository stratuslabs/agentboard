import { sql, db } from "@/lib/sql";
import { resolveCardRef } from "@/lib/card-keys";

/** Largest value a Postgres INTEGER (and so a SERIAL card id) can hold. */
const MAX_CARD_ID = 2147483647;

/**
 * A card id from a URL segment, or null when it can't be one. Strict on
 * purpose: `Number()` and `parseInt()` both accept things like "1.0", "0x10"
 * or "12abc", and a value Postgres can't cast to INTEGER fails the query
 * instead of matching nothing.
 */
export function parseCardId(raw: string | number): number | null {
  const text = String(raw);
  if (!/^[1-9][0-9]{0,9}$/.test(text)) return null;
  const id = Number(text);
  return id <= MAX_CARD_ID ? id : null;
}

/**
 * The internal id for a card reference from a URL or the CLI: a numeric id,
 * or a readable key like AB-142 (any case, old keys and pre-move numbers
 * included). Null when it names no card in the team, so a route can answer
 * 404 without ever passing the raw text to a query, and another team's card
 * looks exactly like one that doesn't exist.
 */
export async function cardIdFromRef(teamId: number, raw: string | number): Promise<number | null> {
  return resolveCardRef((text: string, values?: unknown[]) => db.query(text, values), teamId, raw);
}

// A card joined to the column, board, product and org it lives on, so a caller
// that just moved it can see where it landed without a second request.
// Accepts a numeric id or a readable key; `key` is the card's current one.
export async function getCardWithLocation(teamId: number, rawId: string | number) {
  const id = await cardIdFromRef(teamId, rawId);
  if (id === null) return null;
  const { rows } = await sql`
    SELECT cards.*,
      m.name AS assignee_name, m.type AS assignee_type, m.color AS assignee_color,
      col.slug AS column_slug, col.name AS column_name,
      b.id AS board_id, b.slug AS board_slug, b.name AS board_name,
      p.id AS product_id, p.slug AS product_slug, p.name AS product_name,
      p.key AS product_key,
      CASE WHEN p.key IS NOT NULL AND cards.number IS NOT NULL
        THEN p.key || '-' || cards.number END AS key,
      o.slug AS org_slug,
      (SELECT COUNT(*)::int FROM subtasks st WHERE st.card_id = cards.id) AS subtask_total,
      (SELECT COUNT(*)::int FROM subtasks st WHERE st.card_id = cards.id AND st.done) AS subtask_done
    FROM cards
    JOIN columns col ON col.id = cards.column_id
    JOIN boards b ON b.id = col.board_id
    JOIN products p ON p.id = b.product_id
    JOIN organizations o ON o.id = p.org_id
    LEFT JOIN members m ON cards.assignee_id = m.id
    WHERE cards.id = ${id} AND o.team_id = ${teamId}
  `;
  return rows[0] ?? null;
}
