// Live updates through the real stream route and listener: the listener's
// probe proves delivery from the pool, where real notifications come from, and
// a stream whose first signature read failed still tells the client once the
// database answers again.
//
//   AGENTBOARD_TEST_DATABASE_URL=postgres://... node --test test/
//
// Skipped without it. Runs in a schema of its own, dropped at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire, register } from "node:module";

const require = createRequire(import.meta.url);
const URL_VAR = "AGENTBOARD_TEST_DATABASE_URL";
const url = process.env[URL_VAR];
const skip = url ? false : `set ${URL_VAR} to run`;
const SCHEMA = `realtime_test_${process.pid}`;
// LISTEN/NOTIFY channels are database-wide, while every other DB test file
// runs concurrently in a schema of its own whose team ids start at 1. A team id
// none of them will reach keeps their writes out of this file's streams.
const TEAM_ID = 2_000_000_000 + (process.pid % 100_000_000);

// Read when the route module loads: a sweep fast enough to watch, and no
// self-terminate inside a test.
process.env.SSE_RECONCILE_MS = "200";
process.env.SSE_POLL_MS = "200";
process.env.SSE_MAX_SECONDS = "600";
// A database that can't deliver across connections (pglite-socket) falls back
// to polling after this; no need to wait the full three seconds.
process.env.SSE_PROBE_TIMEOUT_MS = "1000";

let api;
let listen;
let REALTIME_CHANNEL;
let configure;
let db;
let end;
const team = {};
/** Every pg_notify payload sent through the pool, in order. */
const poolNotifies = [];

const resolver = {
  fromRequest: async (request) => ({
    teamId: Number(request.headers.get("x-test-team")),
    userId: null,
  }),
};

async function load(path) {
  return import(new URL(`../src/app/api/${path}/route.ts`, import.meta.url).href);
}

async function call(handler, path, { method = "GET", body } = {}) {
  const { NextRequest } = api.next;
  const response = await handler(new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-team": String(team.id) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: response.status, data: await response.json() };
}

/** Open the team's stream. `next(ms)` resolves to the next event name, or null on timeout. */
async function openStream() {
  const { NextRequest } = api.next;
  const abort = new AbortController();
  const response = await api.stream.GET(new NextRequest("http://localhost/api/stream", {
    headers: { "x-test-team": String(team.id) },
    signal: abort.signal,
  }));
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pending = null;

  async function next(ms) {
    const deadline = Date.now() + ms;
    for (;;) {
      const match = buffer.match(/^event: (\S+)\n/m);
      if (match) {
        const at = buffer.indexOf("\n\n", match.index);
        if (at !== -1) {
          buffer = buffer.slice(at + 2);
          return match[1];
        }
      }
      const left = deadline - Date.now();
      if (left <= 0) return null;
      pending ??= reader.read();
      const result = await Promise.race([
        pending,
        new Promise((r) => setTimeout(() => r("timeout"), left).unref()),
      ]);
      if (result === "timeout") return null;
      pending = null;
      if (result.done) return null;
      // Heartbeat comments carry no event line and are skipped by the match.
      buffer += decoder.decode(result.value, { stream: true });
    }
  }

  const close = async () => {
    abort.abort();
    await reader.cancel().catch(() => {});
  };
  return { next, close };
}

before(async () => {
  if (skip) return;
  const pg = require("pg");
  const BasePool = pg.Pool;
  pg.Pool = class ScopedPool extends BasePool {
    constructor(options) {
      super(options);
      this.on("connect", (client) => {
        client.query(`SET search_path TO ${SCHEMA}`).catch(() => {});
      });
    }
    query(...args) {
      const text = typeof args[0] === "string" ? args[0] : args[0]?.text;
      if (typeof text === "string" && text.includes("pg_notify")) {
        const values = Array.isArray(args[1]) ? args[1] : args[0]?.values;
        poolNotifies.push(values?.[1]);
      }
      return super.query(...args);
    }
  };
  process.env.POSTGRES_URL = url;
  process.env.POSTGRES_POOL_MAX = process.env.TEST_POOL_MAX || "5";

  register("./support/ts-loader.mjs", import.meta.url);
  ({ end, db } = require("../src/lib/sql.js"));
  await db.query(`CREATE SCHEMA ${SCHEMA}`);

  const tenant = await import(new URL("../src/lib/tenant.ts", import.meta.url).href);
  ({ configure } = await import(new URL("../src/configure.ts", import.meta.url).href));
  listen = await import(new URL("../src/lib/realtime/listen.ts", import.meta.url).href);
  ({ REALTIME_CHANNEL } = await import(new URL("../src/lib/realtime/notify.ts", import.meta.url).href));
  api = {
    next: require("next/server.js"),
    orgs: await load("orgs"),
    products: await load("products"),
    board: await load("board"),
    stream: await load("stream"),
  };

  // Creates the tables (and the default team, which these tests do not use).
  await tenant.resolveTenant(new Request("http://localhost/"));
  await db.query("INSERT INTO teams (id, name, slug) VALUES ($1, 'Realtime', $2)", [TEAM_ID, `realtime-${TEAM_ID}`]);
  team.id = TEAM_ID;
  configure({ tenant: resolver });
  const org = await call(api.orgs.POST, "/api/orgs", { method: "POST", body: { name: "Acme" } });
  const product = await call(api.products.POST, "/api/products", {
    method: "POST", body: { org_id: org.data.id, name: "Widget" },
  });
  await call(api.board.GET, `/api/board?product_id=${product.data.id}`);
});

after(async () => {
  if (skip || !end) return;
  configure({});
  // The listener holds a socket of its own; left open, the file never exits.
  await listen.stopListening();
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await end();
});

test("the listener's probe is sent through the pool, where real notifications come from", { skip }, async () => {
  // On a transaction pooler, a probe sent down the listening connection can
  // come back for the wrong reason (that connection is briefly handed the
  // backend that ran LISTEN). Write routes notify through the pool, so that is
  // the path the probe has to prove.
  const before = poolNotifies.length;
  await listen.ensureListening();
  const probes = poolNotifies.slice(before).filter((p) => typeof p === "string" && p.includes('"probe"'));
  assert.equal(probes.length, 1, `pool pg_notify payloads: ${JSON.stringify(poolNotifies.slice(before))}`);
});

test("an idle stream with a good baseline sends no change", { skip }, async () => {
  const stream = await openStream();
  try {
    assert.equal(await stream.next(5_000), "hello");
    // What a concurrent test file writing in its own schema looks like from
    // here: same channel, a low team id. It must not reach this team's stream.
    await db.query("SELECT pg_notify($1, $2)", [REALTIME_CHANNEL, JSON.stringify({ board_id: 1, team_id: 1 })]);
    assert.equal(await stream.next(1_000), null, "five sweeps over an unchanged board stay quiet");
  } finally {
    await stream.close();
  }
});

test("a stream whose baseline failed reports a change once the database answers", { skip }, async () => {
  // The signature reads boards; without the table the baseline fails, as it
  // would in a transient outage. The client's own mount fetch most likely
  // failed with it, so the first good reading has to tell it to fetch.
  await db.query("ALTER TABLE boards RENAME TO boards_away");
  let stream;
  try {
    stream = await openStream();
    assert.equal(await stream.next(5_000), "hello");
  } finally {
    await db.query("ALTER TABLE boards_away RENAME TO boards");
  }
  try {
    assert.equal(await stream.next(2_000), "change");
    assert.equal(await stream.next(1_000), null, "then quiet again: one invalidation, not one per sweep");
  } finally {
    await stream.close();
  }
});

test("stopListening closes the listener's connection", { skip }, async (t) => {
  if (!(await listen.ensureListening())) {
    t.skip("this database cannot deliver across connections, so there is no listener to close");
    return;
  }
  const listeners = async () => Number((await db.query(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE query ILIKE $1 AND pid <> pg_backend_pid()",
    [`LISTEN ${REALTIME_CHANNEL}`],
  )).rows[0].n);
  assert.ok((await listeners()) >= 1, "a live listener shows up as a backend");
  await listen.stopListening();
  for (let i = 0; i < 50 && (await listeners()) > 0; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(await listeners(), 0, "and is gone once stopped");
});
