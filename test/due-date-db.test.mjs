// Due dates through the real card routes (AB-114). A due_date Postgres can't
// read used to fail the write with an HTTP 500, so `agentboard task update
// <id> --due null` broke and there was no way to clear a date from the CLI.
// Now a bad date is a 400 that names it, nothing is written, and null (or "")
// clears the date.
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
const SCHEMA = `due_date_test_${process.pid}`;

let api;
let end;
let db;
let columnId;
let card;

const load = (path) => import(new URL(`../src/app/api/${path}/route.ts`, import.meta.url).href);

async function call(handler, path, { method, body, id }) {
  const { NextRequest } = api.next;
  const request = new NextRequest(`http://localhost${path}`, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const response = id === undefined
    ? await handler(request)
    : await handler(request, { params: Promise.resolve({ id: String(id) }) });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

const patch = (body) => call(api.card.PATCH, `/api/cards/${card.id}`, { method: "PATCH", body, id: card.id });
const create = (body) => call(api.cards.POST, "/api/cards", { method: "POST", body: { column_id: columnId, ...body } });

/** The stored row, with the date as text so no time zone gets in the way. */
async function stored(id = card.id) {
  const { rows } = await db.query("SELECT title, due_date::text AS due FROM cards WHERE id = $1", [id]);
  return rows[0];
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
  };
  process.env.POSTGRES_URL = url;
  process.env.POSTGRES_POOL_MAX = process.env.TEST_POOL_MAX || "5";

  register("./support/ts-loader.mjs", import.meta.url);
  ({ end, db } = require("../src/lib/sql.js"));
  await db.query(`CREATE SCHEMA ${SCHEMA}`);

  api = {
    next: require("next/server.js"),
    orgs: await load("orgs"),
    products: await load("products"),
    cards: await load("cards"),
    card: await load("cards/[id]"),
  };

  const org = await call(api.orgs.POST, "/api/orgs", { method: "POST", body: { name: "Due Labs" } });
  const product = await call(api.products.POST, "/api/products", { method: "POST", body: { org_id: org.data.id, name: "AgentBoard" } });
  const { rows } = await db.query(
    "SELECT c.id FROM columns c JOIN boards b ON b.id = c.board_id WHERE b.product_id = $1 ORDER BY b.position, c.position LIMIT 1",
    [product.data.id],
  );
  columnId = rows[0].id;
  const made = await create({ title: "Ship it", due_date: "2026-11-01" });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  card = made.data;
});

after(async () => {
  if (skip || !end) return;
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await end();
});

test("a bad due date on update is a 400 naming it, and nothing is written", { skip }, async () => {
  await patch({ due_date: "2026-11-01" });
  // Each a different Postgres data exception: 22007, 22008, 22021 for a NUL
  // character and 22023 for an unknown time zone.
  const bad = ["null", "none", "soon", "2026-13-45", "2026-02-30", "  ", "2026-11-01\u0000", "2026-11-01 America/Nowhere"];
  for (const value of bad) {
    const r = await patch({ due_date: value, title: "Renamed" });
    assert.equal(r.status, 400, `${JSON.stringify(value)}: ${JSON.stringify(r.data)}`);
    assert.match(r.data.error, /^due_date /);
    assert.ok(r.data.error.includes(JSON.stringify(value)), r.data.error);
    assert.deepEqual(await stored(), { title: "Ship it", due: "2026-11-01" }, "no field changed");
  }
});

test("a due date that isn't a string or null is a 400", { skip }, async () => {
  for (const value of [true, 20261101, { date: "2026-11-01" }]) {
    const r = await patch({ due_date: value });
    assert.equal(r.status, 400, JSON.stringify(value));
    assert.match(r.data.error, /^due_date must be a date string/);
  }
});

test("null clears a card's due date", { skip }, async () => {
  await patch({ due_date: "2026-11-01" });
  const r = await patch({ due_date: null });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.due_date, null);
  assert.equal((await stored()).due, null);
});

test("an empty string clears it too, as card creation already treats it", { skip }, async () => {
  await patch({ due_date: "2026-11-01" });
  const r = await patch({ due_date: "" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await stored()).due, null);
});

test("dates that worked before still work", { skip }, async () => {
  for (const [value, due] of [["2026-12-24", "2026-12-24"], ["2026-12-25T15:30:00Z", "2026-12-25"]]) {
    const r = await patch({ due_date: value });
    assert.equal(r.status, 200, `${value}: ${JSON.stringify(r.data)}`);
    assert.equal((await stored()).due, due);
  }
});

test("a bad due date on create is a 400 and no card is made", { skip }, async () => {
  const count = async () => Number((await db.query("SELECT count(*) FROM cards")).rows[0].count);
  const before = await count();
  const r = await create({ title: "Never made", due_date: "null" });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /^due_date "null" is not a date/);
  assert.equal(await count(), before);

  const ok = await create({ title: "Made", due_date: "2026-11-02" });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal((await stored(ok.data.id)).due, "2026-11-02");
});
