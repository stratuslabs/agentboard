// First requests on an empty database, at the same time (AB-147).
//
// The schema is created on the first request, and `CREATE TABLE IF NOT
// EXISTS` is not safe to run twice at once: both sessions see the table
// missing, both create it, and the second fails on the catalog's unique index
// (`duplicate key value violates unique constraint "pg_type_typname_nsp_index"`).
// Several requests in one process, or several processes, must set the schema
// up one at a time.
//
// To make the race happen every time rather than now and then, each test
// first creates `organizations` in a transaction of its own and holds it open.
// Every `initDb` that reaches its first CREATE then waits on that row. The
// test rolls back once the waiters are queued; without serialization each of
// them then creates the table and all but one fail.
//
//   AGENTBOARD_TEST_DATABASE_URL=postgres://... node --test test/
//
// Skipped without it. Each test gets a database of its own, dropped at the
// end, so it starts truly empty and its locks can't meet other test files'.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire, register } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const URL_VAR = "AGENTBOARD_TEST_DATABASE_URL";
const url = process.env[URL_VAR];
const skip = url ? false : `set ${URL_VAR} to run`;
const PREFIX = `ab147_${process.pid}`;
const CHILD = fileURLToPath(new URL("./support/init-db-child.mjs", import.meta.url));

let pg;
let admin;
const created = [];

const urlFor = (name) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.href;
};

async function createDatabase(name) {
  await admin.query(`CREATE DATABASE ${name}`);
  created.push(name);
  return urlFor(name);
}

/** Open a transaction that has created `organizations` and not committed. */
async function holdOrganizations(dbUrl) {
  const blocker = new pg.Client({ connectionString: dbUrl });
  await blocker.connect();
  await blocker.query("BEGIN");
  await blocker.query("CREATE TABLE organizations (id INTEGER)");
  return blocker;
}

/** How many backends in database `name` are waiting on a lock. */
async function waiting(name) {
  const { rows } = await admin.query(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = 'Lock'",
    [name],
  );
  return rows[0].n;
}

async function untilWaiting(name, n, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await waiting(name)) >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${n} backends to wait on a lock in ${name}`);
}

function startChild(dbUrl) {
  // A pool of one: the lock must not wait on a pool slot its own setup needs.
  const child = spawn(process.execPath, [CHILD], {
    env: { ...process.env, POSTGRES_URL: dbUrl, DATABASE_URL: "", POSTGRES_POOL_MAX: "1", NODE_NO_WARNINGS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const done = new Promise((resolve) => child.on("exit", (code) => resolve({ code, output: output.trim() })));
  return done;
}

async function tables(dbUrl) {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT to_regclass('public.cards') IS NOT NULL AS cards,
              to_regclass('public.teams') IS NOT NULL AS teams,
              to_regclass('public.github_installations') IS NOT NULL AS github`,
    );
    return rows[0];
  } finally {
    await client.end();
  }
}

before(async () => {
  if (skip) return;
  pg = require("pg");
  admin = new pg.Client({ connectionString: url });
  await admin.connect();
});

after(async () => {
  if (skip || !admin) return;
  const { end } = require("../src/lib/sql.js");
  await end();
  for (const name of created) {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [name],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  }
  await admin.end();
});

test("a first start that fails is tried again by the next request", { skip }, async () => {
  // Point the app at a database that isn't there yet: the first initDb fails,
  // and must not be remembered as done or as failed for good.
  const name = `${PREFIX}_inproc`;
  process.env.POSTGRES_URL = urlFor(name);
  process.env.DATABASE_URL = "";
  process.env.POSTGRES_POOL_MAX = "5";
  register("./support/ts-loader.mjs", import.meta.url);
  const { initDb } = await import(new URL("../src/lib/db.ts", import.meta.url).href);
  await assert.rejects(initDb(), /does not exist/);
  await createDatabase(name);
  await initDb();
  assert.deepEqual(await tables(urlFor(name)), { cards: true, teams: true, github: true });
});

test("concurrent first requests in one process all succeed", { skip }, async () => {
  // A new empty database, a new pool for it, and a new module instance, so
  // initDb doesn't remember the previous test's database.
  const name = `${PREFIX}_concurrent`;
  await createDatabase(name);
  process.env.POSTGRES_URL = urlFor(name);
  await require("../src/lib/sql.js").end();
  const { initDb } = await import(new URL("../src/lib/db.ts?fresh=1", import.meta.url).href);

  const blocker = await holdOrganizations(urlFor(name));
  const requests = Array.from({ length: 5 }, () => initDb());
  const results = Promise.allSettled(requests);
  try {
    await untilWaiting(name, 1);
    // Let every request that is going to reach the CREATE get there.
    await new Promise((r) => setTimeout(r, 300));
  } finally {
    await blocker.query("ROLLBACK");
    await blocker.end();
  }
  const settled = await results;
  const failures = settled.filter((r) => r.status === "rejected").map((r) => r.reason?.message);
  assert.deepEqual(failures, []);
  assert.deepEqual(await tables(urlFor(name)), { cards: true, teams: true, github: true });
});

test("two processes starting on one empty database both succeed", { skip }, async () => {
  const name = `${PREFIX}_procs`;
  const dbUrl = await createDatabase(name);
  const blocker = await holdOrganizations(dbUrl);
  let first;
  let second;
  try {
    first = startChild(dbUrl);
    second = startChild(dbUrl);
    // Both processes are queued: on the held CREATE, or one of them behind
    // the other's lock.
    await untilWaiting(name, 2);
  } finally {
    await blocker.query("ROLLBACK");
    await blocker.end();
  }
  const outcomes = await Promise.all([first, second]);
  assert.deepEqual(
    outcomes.map((o) => o.code),
    [0, 0],
    outcomes.map((o) => o.output).join("\n"),
  );
  assert.deepEqual(await tables(dbUrl), { cards: true, teams: true, github: true });
});
