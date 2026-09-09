import { sql } from "@/lib/sql";

/**
 * Telling connected clients that a board moved.
 *
 * The payload is deliberately just an id: the stream carries invalidation, not
 * data. A client that hears its board changed asks `/api/board?updated_since=`
 * for the delta, which means live updates and reconnect catch-up are the same
 * code path, and no permission check has to be duplicated in the fan-out.
 */

export const REALTIME_CHANNEL = "agentboard";

export type BoardChange = { board_id: number };

/**
 * Announce a change. Never throws.
 *
 * A write that succeeded must not fail because the notification did — the
 * client polls as a fallback and would pick the change up regardless, so a
 * broken NOTIFY should cost freshness, never data.
 */
export async function notifyBoard(boardId: number | string | null | undefined): Promise<void> {
  if (boardId === null || boardId === undefined) return;
  const id = Number(boardId);
  if (!Number.isFinite(id)) return;
  try {
    // pg_notify() rather than NOTIFY so the channel and payload bind as
    // parameters; NOTIFY takes an identifier and cannot be parameterised.
    await sql`SELECT pg_notify(${REALTIME_CHANNEL}, ${JSON.stringify({ board_id: id })})`;
  } catch (err) {
    console.error("realtime: notify failed", err);
  }
}

/** Announce several boards at once, skipping repeats. */
export async function notifyBoards(
  boardIds: (number | string | null | undefined)[]
): Promise<void> {
  const unique = new Set<number>();
  for (const raw of boardIds) {
    const id = Number(raw);
    if (Number.isFinite(id)) unique.add(id);
  }
  await Promise.all([...unique].map(notifyBoard));
}

/**
 * The board a column belongs to.
 *
 * Call this *before* a delete: once the row is gone there is nothing left to
 * resolve, and the clients watching that board are exactly the ones who need
 * to hear about it.
 */
export async function boardIdForColumn(
  columnId: number | string
): Promise<number | null> {
  const { rows } = await sql`SELECT board_id FROM columns WHERE id = ${columnId}`;
  return rows.length > 0 ? rows[0].board_id : null;
}

/** The board a card sits on. Same ordering rule as above for deletes. */
export async function boardIdForCard(
  cardId: number | string
): Promise<number | null> {
  const { rows } = await sql`
    SELECT columns.board_id
      FROM cards
      JOIN columns ON cards.column_id = columns.id
     WHERE cards.id = ${cardId}
  `;
  return rows.length > 0 ? rows[0].board_id : null;
}

/** The boards a set of cards sit on — for reorder, which takes a list of ids. */
export async function boardIdsForCards(
  cardIds: (number | string)[]
): Promise<number[]> {
  if (cardIds.length === 0) return [];
  const { rows } = await sql`
    SELECT DISTINCT columns.board_id
      FROM cards
      JOIN columns ON cards.column_id = columns.id
     WHERE cards.id = ANY(${cardIds})
  `;
  return rows.map((r) => r.board_id);
}

/**
 * The cards a member is assigned to.
 *
 * Cards carry the member's name, type and colour as joined columns, so editing
 * a member changes what those cards render even though no card row is touched.
 * Resolve this *before* deleting a member: `ON DELETE SET NULL` clears
 * `assignee_id`, and afterwards there is no way to find them again.
 */
export async function cardIdsForMember(memberId: number | string): Promise<number[]> {
  const { rows } = await sql`SELECT id FROM cards WHERE assignee_id = ${memberId}`;
  return rows.map((r) => r.id);
}

/**
 * Mark cards as changed without changing them.
 *
 * A delta is defined by `updated_at`, so a card whose *joined* fields changed
 * has to be stamped or it will not be in one — and the client would keep the
 * old name or colour until a full reload. The three-second poll used to paper
 * over this by refetching everything.
 */
export async function stampCards(cardIds: number[]): Promise<void> {
  if (cardIds.length === 0) return;
  await sql`UPDATE cards SET updated_at = NOW() WHERE id = ANY(${cardIds})`;
}

/**
 * Every board under a product, by id or slug.
 *
 * Deleting a product cascades through boards, columns and cards without any of
 * those routes running, so anyone watching one of those boards hears nothing
 * and keeps rendering rows that no longer exist. Resolve before the delete.
 */
export async function boardIdsUnderProduct(idOrSlug: string): Promise<number[]> {
  const numId = parseInt(idOrSlug, 10);
  const { rows } = Number.isNaN(numId)
    ? await sql`
        SELECT b.id FROM boards b
          JOIN products p ON p.id = b.product_id
         WHERE p.slug = ${idOrSlug}
      `
    : await sql`
        SELECT b.id FROM boards b
          JOIN products p ON p.id = b.product_id
         WHERE p.id = ${numId} OR p.slug = ${idOrSlug}
      `;
  return rows.map((r) => r.id);
}

/** Every board under an organization, by id or slug. Same reasoning as above. */
export async function boardIdsUnderOrg(idOrSlug: string): Promise<number[]> {
  const numId = parseInt(idOrSlug, 10);
  const { rows } = Number.isNaN(numId)
    ? await sql`
        SELECT b.id FROM boards b
          JOIN products p ON p.id = b.product_id
          JOIN organizations o ON o.id = p.org_id
         WHERE o.slug = ${idOrSlug}
      `
    : await sql`
        SELECT b.id FROM boards b
          JOIN products p ON p.id = b.product_id
          JOIN organizations o ON o.id = p.org_id
         WHERE o.id = ${numId} OR o.slug = ${idOrSlug}
      `;
  return rows.map((r) => r.id);
}
