import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { sql, db as pool } from "@/lib/sql";

/**
 * Everything a board screen needs, in one request.
 *
 * The board used to mount with three sequential fetches — boards, then columns,
 * then cards — and then refetch cards and columns every three seconds to stay
 * current. This replaces the mount with one round trip and the poll with a
 * delta: pass `updated_since` and only the cards that actually changed come
 * back.
 *
 * Boards and columns are always returned whole. They are bounded — a handful of
 * rows each — so filtering them would buy nothing and cost the client a second
 * reconciliation path. Cards are the unbounded set, so cards are what `since`
 * applies to.
 *
 *   GET /api/board?product_id=1
 *   GET /api/board?product_id=1&board_id=4
 *   GET /api/board?product_id=1&board_id=4&updated_since=<server_time>
 */

/**
 * A cursor, not a date.
 *
 * `updated_at` is a naive TIMESTAMP, so anything that round-trips through a JS
 * Date picks up the client's timezone and starts comparing against the wrong
 * instant. Postgres formats it, the client stores the string, and it comes back
 * verbatim — no timezone semantics anywhere in the middle.
 */
const STAMP_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US';
const SERVER_TIME = `to_char(clock_timestamp(), '${STAMP_FORMAT}')`;

const CARD_COLUMNS = `
  cards.*,
  m.name AS assignee_name,
  m.type AS assignee_type,
  m.color AS assignee_color
`;

export async function GET(request: NextRequest) {
  await initDb();
  const sp = request.nextUrl.searchParams;
  const productId = sp.get("product_id");
  const requestedBoardId = sp.get("board_id");
  const updatedSince = sp.get("updated_since");

  if (!productId) {
    return NextResponse.json({ error: "product_id is required" }, { status: 400 });
  }

  const { rows: boards } = await sql`
    SELECT * FROM boards WHERE product_id = ${productId} ORDER BY position, id
  `;

  const { rows: timeRows } = await pool.query(`SELECT ${SERVER_TIME} AS server_time`);
  const serverTime: string = timeRows[0].server_time;

  if (boards.length === 0) {
    return NextResponse.json({
      server_time: serverTime,
      boards: [],
      active_board_id: null,
      columns: [],
      cards: [],
      ...(updatedSince ? { card_ids: [] } : {}),
    });
  }

  // An unknown or foreign board_id falls back to the first board rather than
  // erroring: the client's remembered board may have been deleted by someone
  // else, and landing on the product's first board is the useful answer.
  const activeBoard =
    boards.find((b) => String(b.id) === String(requestedBoardId)) ?? boards[0];
  const boardId = activeBoard.id;

  const { rows: columns } = await sql`
    SELECT * FROM columns WHERE board_id = ${boardId} ORDER BY position, id
  `;

  // A weak validator over the board's high-water mark and row counts. The mark
  // alone would miss a delete, which lowers the count without moving any
  // timestamp.
  //
  // Every timestamp is formatted by Postgres rather than interpolated as a JS
  // Date: `Date.toString()` is second-granular, so two edits landing in the
  // same second would produce one validator and the second client would get a
  // 304 for a board that had in fact moved.
  const { rows: stampRows } = await sql`
    SELECT
      to_char((SELECT MAX(cards.updated_at) FROM cards
         JOIN columns ON cards.column_id = columns.id
        WHERE columns.board_id = ${boardId}), ${STAMP_FORMAT})            AS cards_max,
      (SELECT COUNT(*) FROM cards
         JOIN columns ON cards.column_id = columns.id
        WHERE columns.board_id = ${boardId})                              AS cards_count,
      to_char((SELECT MAX(updated_at) FROM columns
        WHERE board_id = ${boardId}), ${STAMP_FORMAT})                    AS columns_max,
      (SELECT COUNT(*) FROM columns WHERE board_id = ${boardId})          AS columns_count,
      to_char((SELECT MAX(updated_at) FROM boards
        WHERE product_id = ${productId}), ${STAMP_FORMAT})                AS boards_max,
      (SELECT COUNT(*) FROM boards WHERE product_id = ${productId})       AS boards_count
  `;
  const st = stampRows[0];
  const signature = [
    boardId,
    st.cards_max ?? "-", st.cards_count,
    st.columns_max ?? "-", st.columns_count,
    st.boards_max ?? "-", st.boards_count,
  ].join("|");
  const etag = `W/"${createHash("sha1").update(signature).digest("base64url")}"`;

  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  let cards;
  let cardIds: number[] | undefined;

  if (updatedSince) {
    // Only what changed, plus every id on the board in position order. The id
    // list is how a delta reports deletions: a row that no longer exists can
    // never show up in a `changed since` query, so the client reconciles by
    // set difference. It is one small array against a tombstone table.
    const { rows: changed } = await pool.query(
      `SELECT ${CARD_COLUMNS}
         FROM cards
         JOIN columns ON cards.column_id = columns.id
         LEFT JOIN members m ON cards.assignee_id = m.id
        WHERE columns.board_id = $1 AND cards.updated_at > $2::timestamp
        ORDER BY cards.position, cards.id`,
      [boardId, updatedSince]
    );
    cards = changed;

    const { rows: idRows } = await sql`
      SELECT cards.id FROM cards
        JOIN columns ON cards.column_id = columns.id
       WHERE columns.board_id = ${boardId}
       ORDER BY cards.position, cards.id
    `;
    cardIds = idRows.map((r) => r.id);
  } else {
    const { rows: all } = await pool.query(
      `SELECT ${CARD_COLUMNS}
         FROM cards
         JOIN columns ON cards.column_id = columns.id
         LEFT JOIN members m ON cards.assignee_id = m.id
        WHERE columns.board_id = $1
        ORDER BY cards.position, cards.id`,
      [boardId]
    );
    cards = all;
  }

  return NextResponse.json(
    {
      server_time: serverTime,
      boards,
      active_board_id: boardId,
      columns,
      cards,
      ...(cardIds ? { card_ids: cardIds } : {}),
    },
    { headers: { ETag: etag, "Cache-Control": "no-store" } }
  );
}
