import { initDb } from "../../../lib/db";
import { NextRequest } from "next/server";
import { sql } from "../../../lib/sql";
import { ensureListening, onBoardChange } from "../../../lib/realtime/listen";
import { envInt } from "../../../lib/env";
import { assertBoard, withTenant } from "../../../lib/tenant";

/**
 * Live board updates over Server-Sent Events.
 *
 * The stream carries invalidation, never data: an event says "board 4 moved",
 * and the client answers it with `GET /api/board?updated_since=`. That keeps
 * this route cheap, keeps authorisation in one place, and — the real win —
 * makes a live update and a reconnect catch-up the same code path, so dropping
 * the connection costs nothing but a round trip.
 *
 *   GET /api/stream            — every board on the team (the past-due badge)
 *   GET /api/stream?board_id=4 — one board
 *
 * Board ids are global, so a requested board is checked against the team
 * before anything is subscribed, and every event is filtered by team on the
 * way out: one team never learns that another team's board moved.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel's ceiling for a streaming function. The self-terminate below fires
// well inside it; this only stops the platform killing us mid-write.
export const maxDuration = 300;

/**
 * Hang up and let the client reconnect, rather than waiting to be killed.
 *
 * A serverless platform will cut a streaming response off at its own limit, so
 * every connection is short-lived whether we plan for it or not. Closing on our
 * own terms means the client always gets a `reconnect` event first and resumes
 * from a cursor it already holds. Self-hosters can raise this freely — a
 * long-running Node process has no such limit.
 */
const MAX_SECONDS = envInt("SSE_MAX_SECONDS", 240);
const HEARTBEAT_MS = 15_000;
const POLL_MS = envInt("SSE_POLL_MS", 2_000);

/**
 * How often to reconcile even when notifications are arriving.
 *
 * Every write path has to remember to announce itself, and the ones that forget
 * fail silently — a member rename that leaves stale names on cards, a cascading
 * delete that leaves rows on screen that no longer exist. Both of those were
 * real, and both were previously hidden by the three-second poll this replaced.
 *
 * A slow sweep turns "every write path must notify" from a correctness
 * requirement into a latency optimisation. At thirty seconds it costs a handful
 * of aggregates per connection, against the forty requests a minute per tab
 * that used to be normal. Set to 0 to switch it off.
 */
const RECONCILE_MS = envInt("SSE_RECONCILE_MS", 30_000, 0);

/**
 * A cheap signature of everything the board screen renders.
 *
 * Only used in polling mode. Two details matter. The counts are load-bearing —
 * a delete lowers a count without moving any `updated_at`. And every timestamp
 * is formatted by Postgres, because a JS Date renders to second precision and
 * two edits inside the same second would compare equal, losing the second one.
 */
const STAMP_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US';

async function stampFor(teamId: number, boardId: number | null): Promise<string> {
  if (boardId === null) {
    // Scoped to the team, or a quiet team would be woken by every other
    // team's writes.
    const { rows } = await sql`
      WITH team_boards AS (
        SELECT b.id, b.updated_at FROM boards b
          JOIN products p ON p.id = b.product_id
          JOIN organizations o ON o.id = p.org_id
         WHERE o.team_id = ${teamId}
      ),
      team_columns AS (
        SELECT c.id, c.updated_at FROM columns c JOIN team_boards tb ON tb.id = c.board_id
      ),
      team_cards AS (
        SELECT cd.updated_at FROM cards cd JOIN team_columns tc ON tc.id = cd.column_id
      )
      SELECT
        to_char((SELECT MAX(updated_at) FROM team_cards), ${STAMP_FORMAT})   AS cm,
        (SELECT COUNT(*) FROM team_cards)                                    AS cc,
        to_char((SELECT MAX(updated_at) FROM team_columns), ${STAMP_FORMAT}) AS lm,
        (SELECT COUNT(*) FROM team_columns)                                  AS lc,
        to_char((SELECT MAX(updated_at) FROM team_boards), ${STAMP_FORMAT})  AS bm,
        (SELECT COUNT(*) FROM team_boards)                                   AS bc
    `;
    const r = rows[0];
    return `${r.cm ?? "-"}|${r.cc}|${r.lm ?? "-"}|${r.lc}|${r.bm ?? "-"}|${r.bc}`;
  }
  const { rows } = await sql`
    SELECT
      to_char((SELECT MAX(cards.updated_at) FROM cards
         JOIN columns ON cards.column_id = columns.id
        WHERE columns.board_id = ${boardId}), ${STAMP_FORMAT})          AS cm,
      (SELECT COUNT(*) FROM cards
         JOIN columns ON cards.column_id = columns.id
        WHERE columns.board_id = ${boardId})                            AS cc,
      to_char((SELECT MAX(updated_at) FROM columns
        WHERE board_id = ${boardId}), ${STAMP_FORMAT})                  AS lm,
      (SELECT COUNT(*) FROM columns WHERE board_id = ${boardId})        AS lc,
      to_char((SELECT updated_at FROM boards
        WHERE id = ${boardId}), ${STAMP_FORMAT})                        AS bm
  `;
  const r = rows[0];
  return `${r.cm ?? "-"}|${r.cc}|${r.lm ?? "-"}|${r.lc}|${r.bm ?? "-"}`;
}

export const GET = withTenant(async (request: NextRequest, { teamId }) => {
  await initDb();

  // Checked before anything is subscribed: another team's board is a 404.
  const raw = request.nextUrl.searchParams.get("board_id");
  const boardId = raw !== null && raw !== "" ? await assertBoard(teamId, raw) : null;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const timers: NodeJS.Timeout[] = [];
      let unsubscribe: (() => void) | null = null;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The peer went away between our check and this write.
          shutdown();
        }
      };

      const event = (name: string, data: unknown) =>
        send(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);

      function shutdown() {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        for (const t of timers) clearTimeout(t);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }

      /**
       * Register a timer, or don't if we are already finished.
       *
       * Setup spans two awaits, and the client can disconnect during either.
       * `shutdown` drains this array once, so a timer pushed afterwards is
       * never cleared — which is how a 240-second self-terminate outlived the
       * connection it belonged to. Checking here removes the class rather than
       * the instance, and `unref` means even a timer that escapes cannot hold
       * the process open.
       */
      function schedule(fn: () => void, ms: number) {
        if (closed) return;
        const t = setTimeout(fn, ms);
        t.unref?.();
        timers.push(t);
      }

      request.signal.addEventListener("abort", shutdown);

      // Proxies buffer a response with no bytes on it, and the browser will not
      // fire `onopen` until something arrives. Announce the mode we ended up in
      // so a misconfigured listener is visible from the client, not just a log.
      const live = await ensureListening();

      // The client can disconnect during that await — which the probe made a
      // longer window, up to a few seconds. `shutdown` has already run by then,
      // so anything registered below would never be torn down: the emitter
      // subscription in particular would sit there for the life of the
      // process, and it has no listener ceiling to warn about it.
      if (closed) return;

      // Subscribed before anything is awaited, and before `hello`.
      //
      // The baseline below is a query, so it is a window: a write can commit
      // after its snapshot and fire its notification while no handler is
      // attached. The notification is dropped, the baseline predates the
      // write, and nothing reports it until the sweep — or never, with
      // reconciliation switched off. Registering first closes that, and
      // `shutdown` clears `unsubscribe`, so aborting during the await now
      // tears the handler down rather than leaking it.
      //
      // The cost is that a `change` can reach the client before `hello`. That
      // is harmless: both mean "fetch a delta", and the client answers them
      // the same way.
      if (live) {
        unsubscribe = onBoardChange((changed) => {
          if (changed.team_id !== teamId) return;
          if (boardId === null || changed.board_id === boardId) {
            event("change", { board_id: changed.board_id });
          }
        });
      }

      // The signature sweep. It is the whole mechanism when there is no
      // NOTIFY, and a slow safety net when there is — the same code either
      // way, so the client cannot tell which is driving it.
      const interval = live ? RECONCILE_MS : POLL_MS;
      let last: string | null = null;
      // Whether `last` is a real reading or only the absence of one. A stamp
      // that never succeeded is not a baseline, and treating it as one turns a
      // transient outage into permanent staleness below.
      let baselined = false;

      // Sampled before `hello`, and that ordering is the whole point.
      //
      // The client's contract is to answer `hello` by fetching a delta. Take
      // this baseline afterwards and it lands a round trip later than the
      // client's own read, so a write arriving in between is absorbed as the
      // baseline: no tick ever sees it as a difference, and the board stays
      // stale until something unrelated moves the stamp. Taking it first can
      // only cost a redundant `change`, and the event carries no data.
      if (interval > 0) {
        try {
          last = await stampFor(teamId, boardId);
          baselined = true;
        } catch (err) {
          console.error("realtime: initial stamp failed", err);
        }
        // A second await, and so a second chance to have been disconnected.
        if (closed) return;
      }

      event("hello", { board_id: boardId, mode: live ? "listen" : "poll" });

      if (interval > 0) {
        const tick = async () => {
          if (closed) return;
          try {
            const next = await stampFor(teamId, boardId);
            // The first good reading after a failed baseline is an
            // invalidation, not a starting point. The old value was never
            // learned, so nothing can be said to be unchanged, and the outage
            // that lost the baseline most likely took the client's own mount
            // fetch with it.
            if (!baselined || next !== last) event("change", { board_id: boardId });
            last = next;
            baselined = true;
          } catch (err) {
            console.error("realtime: poll failed", err);
          }
          schedule(tick, interval);
        };
        schedule(tick, interval);
      }

      const beat = () => {
        if (closed) return;
        // A comment line: keeps intermediaries from timing the connection out
        // without waking any client-side handler.
        send(`: ping\n\n`);
        schedule(beat, HEARTBEAT_MS);
      };
      schedule(beat, HEARTBEAT_MS);

      schedule(() => {
        event("reconnect", { reason: "max-duration" });
        shutdown();
      }, MAX_SECONDS * 1_000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx buffers proxied responses by default, which holds every event
      // until the connection closes — the one setting that makes SSE look
      // broken on a normal self-hosted setup.
      "X-Accel-Buffering": "no",
    },
  });
});
