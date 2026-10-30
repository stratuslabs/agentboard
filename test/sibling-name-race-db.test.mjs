// Two requests that give siblings the same name at the same time (card 815).
//
// Renaming an org, product or board keeps its slug, so the database's slug
// uniqueness can't catch two siblings ending up with one name: each request
// checks the siblings, sees the name free, and writes. The check and the
// write have to happen under one lock per scope, so the second request sees
// the first one's name and gets the 409.
//
// To make the race happen every time rather than now and then, each test
// holds a SHARE lock on the table being written. Both requests read their
// siblings, then wait to write; the test lets them go only once both are
// waiting. Without the scope lock both writes land. With it, the second
// request waits before it reads, and reads the first one's name.
//
//   AGENTBOARD_TEST_DATABASE_URL=postgres://... node --test test/
//
// Skipped without it. The handlers run in-process against a schema of their
// own, dropped at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire, register } from "node:module";

const require = createRequire(import.meta.url);
const URL_VAR = "AGENTBOARD_TEST_DATABASE_URL";
const url = process.env[URL_VAR];
const skip = url ? false : `set ${URL_VAR} to run`;
const SCHEMA = `name_race_test_${process.pid}`;

let api;
let end;
let db;
let pg;
let org;
let product;

async function call(handler, path, { method = "GET", body, params } = {}) {
  const { NextRequest } = api.next;
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = params
    ? await handler(request, { params: Promise.resolve(params) })
    : await handler(request);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

const load = (path) => import(new URL(`../src/app/api/${path}/route.ts`, import.meta.url).href);
const post = (handler, path, body) => () => call(handler, path, { method: "POST", body });
const patch = (handler, path, id, body) => () =>
  call(handler, `${path}/${id}`, { method: "PATCH", body, params: { id: String(id) } });

function created(r, status) {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
}

/**
 * How many requests are waiting: to write one of this schema's tables, or
 * for a sibling-name lock (an advisory lock with the two-key form).
 */
async function waiting(client) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM pg_locks
     WHERE NOT granted AND pid <> pg_backend_pid() AND (
       relation IN (SELECT oid FROM pg_class WHERE relnamespace = $1::regnamespace)
       OR (locktype = 'advisory' AND objsubid = 2)
     )`,
    [SCHEMA]
  );
  return rows[0].n;
}

/**
 * Start every request while `table` is SHARE-locked, wait until all of them
 * are stuck on a lock, then release it and return their responses.
 */
async function race(table, requests) {
  const holder = new pg.Client({ connectionString: url });
  await holder.connect();
  try {
    await holder.query("BEGIN");
    await holder.query(`LOCK TABLE ${SCHEMA}.${table} IN SHARE MODE`);
    const pending = requests.map((r) => r());
    // Responses that come back early mean a request didn't get as far as the
    // write; they're reported below rather than waited on forever.
    const settled = Promise.allSettled(pending);
    const deadline = Date.now() + 10_000;
    for (;;) {
      const n = await waiting(holder);
      if (n >= requests.length) break;
      const done = await Promise.race([settled.then(() => true), new Promise((r) => setTimeout(() => r(false), 25))]);
      if (done) break;
      if (Date.now() > deadline) throw new Error(`only ${n} of ${requests.length} requests reached a lock`);
    }
    await holder.query("COMMIT");
    return await Promise.all(pending);
  } finally {
    await holder.query("ROLLBACK").catch(() => {});
    await holder.end();
  }
}

/** Exactly one request won and the rest were 409s. */
function oneWinner(results, winStatuses) {
  const statuses = results.map((r) => r.status).sort();
  const wins = results.filter((r) => winStatuses.includes(r.status));
  const conflicts = results.filter((r) => r.status === 409);
  assert.equal(wins.length, 1, `one request wins, got ${JSON.stringify(statuses)}`);
  assert.equal(conflicts.length, results.length - 1, `the rest are 409s, got ${JSON.stringify(results)}`);
  for (const c of conflicts) assert.match(c.data.error, /already/);
}

const namesIn = async (table, where, id) =>
  (await db.query(`SELECT name FROM ${table} WHERE ${where} = $1`, [id])).rows.map((r) => r.name.toLowerCase());

function assertUnique(names, label) {
  assert.equal(new Set(names).size, names.length, `${label} names are unique: ${names.join(", ")}`);
}

before(async () => {
  if (skip) return;
  pg = require("pg");
  const BasePool = pg.Pool;
  pg.Pool = class ScopedPool extends BasePool {
    constructor(options) {
      super(options);
      this.on("connect", (client) => {
        client.query(`SET search_path TO ${SCHEMA}`).catch(() => {});
      });
    }
  };
  process.env.POSTGRES_URL = url;
  process.env.POSTGRES_POOL_MAX = process.env.TEST_POOL_MAX || "5";

  register("./support/ts-loader.mjs", import.meta.url);
  ({ end, db } = require("../src/lib/sql.js"));
  await db.query(`CREATE SCHEMA ${SCHEMA}`);

  api = {
    next: require("next/server.js"),
    orgs: await load("orgs"),
    org: await load("orgs/[id]"),
    products: await load("products"),
    product: await load("products/[id]"),
    boards: await load("boards"),
    board: await load("boards/[id]"),
  };

  org = created(await post(api.orgs.POST, "/api/orgs", { name: "Race Labs" })(), 201);
  product = created(await post(api.products.POST, "/api/products", { org_id: org.id, name: "Racer" })(), 201);
});

after(async () => {
  if (skip || !end) return;
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await end();
});

test("two boards renamed to the same name at once: one wins, one 409", { skip }, async () => {
  const a = created(await post(api.boards.POST, "/api/boards", { product_id: product.id, name: "Alpha" })(), 201);
  const b = created(await post(api.boards.POST, "/api/boards", { product_id: product.id, name: "Beta" })(), 201);
  const results = await race("boards", [
    patch(api.board.PATCH, "/api/boards", a.id, { name: "Ops" }),
    patch(api.board.PATCH, "/api/boards", b.id, { name: "OPS" }),
  ]);
  oneWinner(results, [200]);
  assertUnique(await namesIn("boards", "product_id", product.id), "board");
});

test("a board renamed while another is added with that name: one wins, one 409", { skip }, async () => {
  const c = created(await post(api.boards.POST, "/api/boards", { product_id: product.id, name: "Gamma" })(), 201);
  const results = await race("boards", [
    patch(api.board.PATCH, "/api/boards", c.id, { name: "Infra" }),
    post(api.boards.POST, "/api/boards", { product_id: product.id, name: "Infra" }),
  ]);
  oneWinner(results, [200, 201]);
  assertUnique(await namesIn("boards", "product_id", product.id), "board");
});

test("two products renamed to the same name at once: one wins, one 409", { skip }, async () => {
  const a = created(await post(api.products.POST, "/api/products", { org_id: org.id, name: "Apple" })(), 201);
  const b = created(await post(api.products.POST, "/api/products", { org_id: org.id, name: "Banana" })(), 201);
  const results = await race("products", [
    patch(api.product.PATCH, "/api/products", a.id, { name: "Cherry" }),
    patch(api.product.PATCH, "/api/products", b.id, { name: "cherry" }),
  ]);
  oneWinner(results, [200]);
  assertUnique(await namesIn("products", "org_id", org.id), "product");
});

test("a product renamed while another is added with that name: one wins, one 409", { skip }, async () => {
  const d = created(await post(api.products.POST, "/api/products", { org_id: org.id, name: "Date" })(), 201);
  const results = await race("products", [
    patch(api.product.PATCH, "/api/products", d.id, { name: "Elder" }),
    post(api.products.POST, "/api/products", { org_id: org.id, name: "Elder" }),
  ]);
  oneWinner(results, [200, 201]);
  assertUnique(await namesIn("products", "org_id", org.id), "product");
  // The loser left nothing half-made behind: every product has its boards.
  const { rows } = await db.query(
    "SELECT p.name FROM products p WHERE p.org_id = $1 AND NOT EXISTS (SELECT 1 FROM boards b WHERE b.product_id = p.id)",
    [org.id]
  );
  assert.deepEqual(rows, []);
});

test("two orgs renamed to the same name at once: one wins, one 409", { skip }, async () => {
  const a = created(await post(api.orgs.POST, "/api/orgs", { name: "North" })(), 201);
  const b = created(await post(api.orgs.POST, "/api/orgs", { name: "South" })(), 201);
  const results = await race("organizations", [
    // Not the exact same name: organizations have a unique (team, name)
    // index, which catches that much already.
    patch(api.org.PATCH, "/api/orgs", a.id, { name: "Central" }),
    patch(api.org.PATCH, "/api/orgs", b.id, { name: "CENTRAL" }),
  ]);
  oneWinner(results, [200]);
  const { rows } = await db.query("SELECT name FROM organizations");
  assertUnique(rows.map((r) => r.name.toLowerCase()), "org");
});

test("an org renamed while another is added with that name: one wins, one 409", { skip }, async () => {
  const e = created(await post(api.orgs.POST, "/api/orgs", { name: "East" })(), 201);
  const results = await race("organizations", [
    patch(api.org.PATCH, "/api/orgs", e.id, { name: "West" }),
    post(api.orgs.POST, "/api/orgs", { name: "west" }),
  ]);
  oneWinner(results, [200, 201]);
  const { rows } = await db.query("SELECT name FROM organizations");
  assertUnique(rows.map((r) => r.name.toLowerCase()), "org");
});

test("the same name in two products is fine, at the same moment too", { skip }, async () => {
  const other = created(await post(api.products.POST, "/api/products", { org_id: org.id, name: "Other" })(), 201);
  const [x] = (await db.query("SELECT id FROM boards WHERE product_id = $1", [product.id])).rows;
  const [y] = (await db.query("SELECT id FROM boards WHERE product_id = $1", [other.id])).rows;
  const results = await race("boards", [
    patch(api.board.PATCH, "/api/boards", x.id, { name: "Shared Name" }),
    patch(api.board.PATCH, "/api/boards", y.id, { name: "Shared Name" }),
  ]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
});

test("two products added at once in different orgs still both get a key", { skip }, async () => {
  // Same name, so both derive the same card key. Whichever writes second hits
  // the key's unique index inside its transaction and has to derive another,
  // which needs the transaction to survive the failed insert.
  const other = created(await post(api.orgs.POST, "/api/orgs", { name: "Key Org" })(), 201);
  const results = await race("products", [
    post(api.products.POST, "/api/products", { org_id: org.id, name: "Zephyr" }),
    post(api.products.POST, "/api/products", { org_id: other.id, name: "Zephyr" }),
  ]);
  assert.deepEqual(results.map((r) => r.status), [201, 201], JSON.stringify(results.map((r) => r.data)));
  const [a, b] = results.map((r) => r.data.key);
  assert.ok(a && b && a !== b, `different keys: ${a}, ${b}`);
});
