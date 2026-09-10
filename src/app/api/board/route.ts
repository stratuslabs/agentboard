import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { readSnapshot } from "@/lib/sql";
import { envInt } from "@/lib/env";

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

/**
 * How far back a delta reaches beyond the cursor it was given.
 *
 * `updated_at` is stamped with `NOW()`, which is transaction-start time, while
 * a row only becomes visible at commit. So a write can be stamped before a
 * reader samples its cursor and become visible after that reader has already
 * read the cards — leaving a row whose timestamp is behind a cursor that has
 * moved past it. The strict `>` below would then exclude it from every later
 * delta, and nothing heals it: the reconciliation sweep compares
 * `MAX(updated_at)`, which did not move either.
 *
 * Overlapping the window re-sends whatever changed in the last couple of
 * seconds. The client merges by id and rebuilds membership from `card_ids`, so
 * a repeated row is a no-op, and an idle board still sends nothing at all.
 *
 * This bounds the race rather than removing it — a write held off by a row
 * lock for longer than the overlap would still slip through. Every write in
 * this app is a single autocommit statement, so the real exposure is one
 * statement's duration and two seconds is roughly a thousand times that. The
 * alternatives that close it outright — a commit-ordered `xid8` cursor, or
 * clamping to the oldest in-flight transaction — cost a schema change and a
 * cursor that is no longer a readable timestamp, or a dependency on
 * `pg_stat_activity`'s privilege rules.
 */
const DELTA_OVERLAP_MS = envInt("BOARD_DELTA_OVERLAP_MS", 2_000, 0);

export async function GET(request: NextRequest) {
  await initDb();
  const sp = request.nextUrl.searchParams;
  const productId = sp.get("product_id");
  const requestedBoardId = sp.get("board_id");
  const updatedSince = sp.get("updated_since");

  if (!productId) {
    return NextResponse.json({ error: "product_id is required" }, { status: 400 });
  }

  // One snapshot for the whole response. Read separately, the validator and
  // the rows it describes come from different instants, and a write landing
  // between them yields a payload that is stale under an ETag that is not —
  // which a conditional client then holds onto through every later 304.
  const snap = await readSnapshot(async (c) => {
    // First statement in the transaction, so this is the moment the snapshot
    // was taken and everything below is consistent with it.
    const { rows: timeRows } = await c.query(`SELECT ${SERVER_TIME} AS server_time`);
    const serverTime: string = timeRows[0].server_time;

    const { rows: boards } = await c.query(
      `SELECT * FROM boards WHERE product_id = $1 ORDER BY position, id`,
      [productId]
    );
    if (boards.length === 0) {
      return { kind: "empty" as const, serverTime };
    }

    // An unknown or foreign board_id falls back to the first board rather than
    // erroring: the client's remembered board may have been deleted by someone
    // else, and landing on the product's first board is the useful answer.
    const activeBoard =
      boards.find((b) => String(b.id) === String(requestedBoardId)) ?? boards[0];
    const boardId = activeBoard.id;

    const { rows: columns } = await c.query(
      `SELECT * FROM columns WHERE board_id = $1 ORDER BY position, id`,
      [boardId]
    );

    // A weak validator over the board's high-water mark and row counts. The
    // mark alone would miss a delete, which lowers the count without moving
    // any timestamp.
    //
    // Every timestamp is formatted by Postgres rather than interpolated as a
    // JS Date: `Date.toString()` is second-granular, so two edits landing in
    // the same second would produce one validator and the second client would
    // get a 304 for a board that had in fact moved.
    const { rows: stampRows } = await c.query(
      `SELECT
         to_char((SELECT MAX(cards.updated_at) FROM cards
            JOIN columns ON cards.column_id = columns.id
           WHERE columns.board_id = $1), $3)                          AS cards_max,
         (SELECT COUNT(*) FROM cards
            JOIN columns ON cards.column_id = columns.id
           WHERE columns.board_id = $1)                               AS cards_count,
         to_char((SELECT MAX(updated_at) FROM columns
           WHERE board_id = $1), $3)                                  AS columns_max,
         (SELECT COUNT(*) FROM columns WHERE board_id = $1)           AS columns_count,
         to_char((SELECT MAX(updated_at) FROM boards
           WHERE product_id = $2), $3)                                AS boards_max,
         (SELECT COUNT(*) FROM boards WHERE product_id = $2)          AS boards_count`,
      [boardId, productId, STAMP_FORMAT]
    );
    const st = stampRows[0];
    const signature = [
      boardId,
      st.cards_max ?? "-", st.cards_count,
      st.columns_max ?? "-", st.columns_count,
      st.boards_max ?? "-", st.boards_count,
    ].join("|");
    const etag = `W/"${createHash("sha1").update(signature).digest("base64url")}"`;

    // Decided inside the snapshot, so the validator that answers 304 is the
    // one the rows below would have been sent under.
    if (request.headers.get("if-none-match") === etag) {
      return { kind: "not-modified" as const, etag };
    }

    let cards;
    let cardIds: number[] | undefined;

    if (updatedSince) {
      // Only what changed, plus every id on the board in position order. The
      // id list is how a delta reports deletions: a row that no longer exists
      // can never show up in a `changed since` query, so the client reconciles
      // by set difference. It is one small array against a tombstone table.
      const { rows: changed } = await c.query(
        `SELECT ${CARD_COLUMNS}
           FROM cards
           JOIN columns ON cards.column_id = columns.id
           LEFT JOIN members m ON cards.assignee_id = m.id
          WHERE columns.board_id = $1
            AND cards.updated_at > ($2::timestamp - ($3::int * interval '1 millisecond'))
          ORDER BY cards.position, cards.id`,
        [boardId, updatedSince, DELTA_OVERLAP_MS]
      );
      cards = changed;

      const { rows: idRows } = await c.query(
        `SELECT cards.id FROM cards
           JOIN columns ON cards.column_id = columns.id
          WHERE columns.board_id = $1
          ORDER BY cards.position, cards.id`,
        [boardId]
      );
      cardIds = idRows.map((r) => r.id);
    } else {
      const { rows: all } = await c.query(
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

    return { kind: "full" as const, serverTime, boards, boardId, columns, cards, cardIds, etag };
  });

  if (snap.kind === "not-modified") {
    return new NextResponse(null, { status: 304, headers: { ETag: snap.etag } });
  }

  if (snap.kind === "empty") {
    return NextResponse.json({
      server_time: snap.serverTime,
      boards: [],
      active_board_id: null,
      columns: [],
      cards: [],
      ...(updatedSince ? { card_ids: [] } : {}),
    });
  }

  return NextResponse.json(
    {
      server_time: snap.serverTime,
      boards: snap.boards,
      active_board_id: snap.boardId,
      columns: snap.columns,
      cards: snap.cards,
      ...(snap.cardIds ? { card_ids: snap.cardIds } : {}),
    },
    { headers: { ETag: snap.etag, "Cache-Control": "no-store" } }
  );
}
