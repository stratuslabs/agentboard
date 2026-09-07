import { EventEmitter } from "node:events";
import { Client } from "pg";
import { connectionString, sslConfig } from "@/lib/sql";
import { REALTIME_CHANNEL, type BoardChange } from "./notify";

/**
 * One LISTEN connection per process, fanned out to every open stream.
 *
 * This cannot use the shared pool: LISTEN registers interest on a specific
 * backend connection, and a pooled client is handed to somebody else the moment
 * the query returns. It needs a socket of its own, held open.
 *
 * `DIRECT_POSTGRES_URL` exists because a pooled endpoint cannot do this at all
 * — pgbouncer in transaction mode hands each statement to a different backend,
 * so the subscription is dropped on the floor. Production points POSTGRES_URL
 * at the pooler by design, so the listener needs the direct endpoint. When it
 * is unset we simply fall back: see `ensureListening`.
 */

const emitter = new EventEmitter();
// One listener per open stream, and there is no useful ceiling on those.
emitter.setMaxListeners(0);

const BOARD_CHANGE = "board-change";
const MAX_RETRY_MS = 30_000;

let client: Client | null = null;
let starting: Promise<boolean> | null = null;
let retryMs = 1_000;
let retryTimer: NodeJS.Timeout | null = null;

function listenerUrl(): string | null {
  const direct = process.env.DIRECT_POSTGRES_URL?.trim();
  if (direct) return direct;
  return connectionString();
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void ensureListening();
  }, retryMs);
  // Do not hold a short-lived script open just to retry a subscription.
  retryTimer.unref?.();
  retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
}

function teardown() {
  if (!client) return;
  const dying = client;
  client = null;
  dying.removeAllListeners();
  dying.end().catch(() => {
    // Already gone. Nothing to do and nothing worth logging.
  });
}

async function start(): Promise<boolean> {
  const url = listenerUrl();
  if (!url) return false;

  const next = new Client({ connectionString: url, ssl: sslConfig(url) });

  next.on("notification", (msg) => {
    if (msg.channel !== REALTIME_CHANNEL || !msg.payload) return;
    try {
      const parsed = JSON.parse(msg.payload) as BoardChange;
      if (typeof parsed.board_id === "number") {
        emitter.emit(BOARD_CHANGE, parsed.board_id);
      }
    } catch {
      // A payload we cannot parse is not worth taking the listener down for.
    }
  });

  // A dropped subscription is silent otherwise: queries keep working through
  // the pool while every open stream quietly stops hearing anything.
  next.on("error", (err) => {
    console.error("realtime: listener connection error", err);
    teardown();
    scheduleRetry();
  });
  next.on("end", () => {
    teardown();
    scheduleRetry();
  });

  try {
    await next.connect();
    await next.query(`LISTEN ${REALTIME_CHANNEL}`);
  } catch (err) {
    console.error("realtime: could not LISTEN, falling back to polling", err);
    next.removeAllListeners();
    await next.end().catch(() => {});
    scheduleRetry();
    return false;
  }

  client = next;
  retryMs = 1_000;
  return true;
}

/**
 * True when this process is receiving NOTIFY. False means the caller should
 * poll instead — an answer, not an error, so a self-hoster who never sets
 * DIRECT_POSTGRES_URL still gets live updates without configuring anything.
 */
export async function ensureListening(): Promise<boolean> {
  if (client) return true;
  if (!starting) {
    starting = start().finally(() => {
      starting = null;
    });
  }
  return starting;
}

/** Subscribe to board changes. Returns an unsubscribe function. */
export function onBoardChange(handler: (boardId: number) => void): () => void {
  emitter.on(BOARD_CHANGE, handler);
  return () => {
    emitter.off(BOARD_CHANGE, handler);
  };
}
