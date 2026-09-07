import { initDb } from "@/lib/db";
import { NextRequest } from "next/server";
import { sql } from "@/lib/sql";
import { ensureListening, onBoardChange } from "@/lib/realtime/listen";

/**
 * Live board updates over Server-Sent Events.
 *
 * The stream carries invalidation, never data: an event says "board 4 moved",
 * and the client answers it with `GET /api/board?updated_since=`. That keeps
 * this route cheap, keeps authorisation in one place, and — the real win —
 * makes a live update and a reconnect catch-up the same code path, so dropping
 * the connection costs nothing but a round trip.
 *
 *   GET /api/stream            — every board (the sidebar's past-due badge)
 *   GET /api/stream?board_id=4 — one board
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
const MAX_SECONDS = Number(process.env.SSE_MAX_SECONDS || 240);
const HEARTBEAT_MS = 15_000;
const POLL_MS = Number(process.env.SSE_POLL_MS || 2_000);

/**
 * A cheap signature of everything the board screen renders.
 *
 * Only used in polling mode. Two details matter. The counts are load-bearing —
 * a delete lowers a count without moving any `updated_at`. And every timestamp
 * is formatted by Postgres, because a JS Date renders to second precision and
 * two edits inside the same second would compare equal, losing the second one.
 */
const STAMP_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US';

async function stampFor(boardId: number | null): Promise<string> {
  if (boardId === null) {
    const { rows } = await sql`
      SELECT
        to_char((SELECT MAX(updated_at) FROM cards), ${STAMP_FORMAT})   AS cm,
        (SELECT COUNT(*) FROM cards)                                    AS cc,
        to_char((SELECT MAX(updated_at) FROM columns), ${STAMP_FORMAT}) AS lm,
        (SELECT COUNT(*) FROM columns)                                  AS lc,
        to_char((SELECT MAX(updated_at) FROM boards), ${STAMP_FORMAT})  AS bm,
        (SELECT COUNT(*) FROM boards)                                   AS bc
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

export async function GET(request: NextRequest) {
  await initDb();

  const raw = request.nextUrl.searchParams.get("board_id");
  const boardId = raw !== null && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null;

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

      request.signal.addEventListener("abort", shutdown);

      // Proxies buffer a response with no bytes on it, and the browser will not
      // fire `onopen` until something arrives. Announce the mode we ended up in
      // so a misconfigured listener is visible from the client, not just a log.
      const live = await ensureListening();
      event("hello", { board_id: boardId, mode: live ? "listen" : "poll" });

      if (live) {
        unsubscribe = onBoardChange((changed) => {
          if (boardId === null || changed === boardId) {
            event("change", { board_id: changed });
          }
        });
      } else {
        // No NOTIFY available. Poll the signature and emit the same event, so
        // the client cannot tell the difference and needs no second code path.
        let last: string | null = null;
        try {
          last = await stampFor(boardId);
        } catch (err) {
          console.error("realtime: initial stamp failed", err);
        }
        const tick = async () => {
          if (closed) return;
          try {
            const next = await stampFor(boardId);
            if (last !== null && next !== last) event("change", { board_id: boardId });
            last = next;
          } catch (err) {
            console.error("realtime: poll failed", err);
          }
          if (!closed) timers.push(setTimeout(tick, POLL_MS));
        };
        timers.push(setTimeout(tick, POLL_MS));
      }

      const beat = () => {
        if (closed) return;
        // A comment line: keeps intermediaries from timing the connection out
        // without waking any client-side handler.
        send(`: ping\n\n`);
        timers.push(setTimeout(beat, HEARTBEAT_MS));
      };
      timers.push(setTimeout(beat, HEARTBEAT_MS));

      timers.push(
        setTimeout(() => {
          event("reconnect", { reason: "max-duration" });
          shutdown();
        }, MAX_SECONDS * 1_000)
      );
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
}
