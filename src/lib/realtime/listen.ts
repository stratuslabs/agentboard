import { EventEmitter } from "node:events";
import { Client } from "pg";
import { connectionString, sslConfig } from "@/lib/sql";
import { REALTIME_CHANNEL, type BoardChange } from "./notify";
import { envInt } from "@/lib/env";

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
 *
 * A `LISTEN` that does not throw is not proof of anything. Some poolers accept
 * the statement and then release the backend, so the query succeeds while no
 * notification will ever arrive — and a caller that trusts the return value
 * disables its own polling and goes quiet forever, which is worse than never
 * having tried. So the subscription is proved before it is trusted: see
 * `probe`.
 */

const emitter = new EventEmitter();
// One listener per open stream, and there is no useful ceiling on those.
emitter.setMaxListeners(0);

const BOARD_CHANGE = "board-change";
const MAX_RETRY_MS = 30_000;

/**
 * How long to wait for a notification we sent ourselves.
 *
 * Generous: this runs once per process against a database we are already
 * connected to, and a false negative costs live updates for the life of the
 * process, while a slow true positive costs one startup.
 */
const PROBE_TIMEOUT_MS = envInt("SSE_PROBE_TIMEOUT_MS", 3_000);

/** Resolves when the round-trip probe for this token comes back. */
let pendingProbe: { token: string; seen: () => void } | null = null;

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

  // Both timeouts matter because `/api/stream` awaits this before writing a
  // single byte, and a browser fires no `onopen` until something arrives.
  // `pg` defaults to waiting forever on connect, so a black-holed SYN parks
  // the stream — and every other stream opening behind the shared promise —
  // until the kernel gives up, which is minutes. The pool already sets ten
  // seconds; match it. `query_timeout` covers the probe's own `pg_notify`,
  // whose timeout only bounds the round trip after the query resolves.
  const next = new Client({
    connectionString: url,
    ssl: sslConfig(url),
    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
  });

  next.on("notification", (msg) => {
    if (msg.channel !== REALTIME_CHANNEL || !msg.payload) return;
    try {
      const parsed = JSON.parse(msg.payload) as BoardChange & { probe?: string };
      if (parsed.probe !== undefined) {
        if (pendingProbe && parsed.probe === pendingProbe.token) pendingProbe.seen();
        return;
      }
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

  // Prove it. A pooler that accepted the LISTEN but handed the backend to
  // somebody else answers this by never delivering, which is exactly the
  // silent failure the caller cannot otherwise detect.
  if (!(await probe(next))) {
    console.error(
      "realtime: LISTEN was accepted but no notification arrived — the " +
        "connection is probably pooled. Falling back to polling; set " +
        "DIRECT_POSTGRES_URL to an unpooled endpoint for push updates.",
    );
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
 * Send ourselves a notification and wait for it to come back.
 *
 * Sent down the same connection that is listening, so it tests the exact
 * property every stream depends on. The payload carries no `board_id`, so even
 * if it reached another process it would be ignored there rather than being
 * mistaken for a board change.
 */
async function probe(candidate: Client): Promise<boolean> {
  const token = `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const roundTrip = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pendingProbe = null;
      resolve(false);
    }, PROBE_TIMEOUT_MS);
    timer.unref?.();

    pendingProbe = {
      token,
      seen: () => {
        clearTimeout(timer);
        pendingProbe = null;
        resolve(true);
      },
    };
  });

  try {
    await candidate.query("SELECT pg_notify($1, $2)", [
      REALTIME_CHANNEL,
      JSON.stringify({ probe: token }),
    ]);
  } catch {
    pendingProbe = null;
    return false;
  }

  return roundTrip;
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
