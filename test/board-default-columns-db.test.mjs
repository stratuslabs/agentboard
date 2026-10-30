// A board added to an existing product starts with the team's Default columns
// setting (card 696), the same list a new product's boards get. Before, POST
// /api/boards always used the built-in list, though Settings says the list is
// used for every new board.
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
const SCHEMA = `board_default_columns_test_${process.pid}`;

let api;
let end;
let db;
let product;
let teamId;
let DEFAULT_COLUMNS;

async function post(handler, path, body) {
  const { NextRequest } = api.next;
  const request = new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await handler(request);
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

const load = (path) => import(new URL(`../src/app/api/${path}/route.ts`, import.meta.url).href);

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
  ({ DEFAULT_COLUMNS } = require("../src/lib/default-columns.js"));
  await db.query(`CREATE SCHEMA ${SCHEMA}`);

  api = {
    next: require("next/server.js"),
    orgs: await load("orgs"),
    products: await load("products"),
    boards: await load("boards"),
  };

  const o = await post(api.orgs.POST, "/api/orgs", { name: "Columns Labs" });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  teamId = o.data.team_id;
  const p = await post(api.products.POST, "/api/products", { org_id: o.data.id, name: "Columns" });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  product = p.data;
});

after(async () => {
  if (skip || !end) return;
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await end();
});

const save = (value) =>
  db.query(
    `INSERT INTO settings (team_id, key, value) VALUES ($1, 'default_columns', $2)
     ON CONFLICT ON CONSTRAINT settings_pkey DO UPDATE SET value = EXCLUDED.value`,
    [teamId, value]
  );
const forget = () => db.query("DELETE FROM settings WHERE team_id = $1 AND key = 'default_columns'", [teamId]);

let n = 0;
async function addBoard() {
  const r = await post(api.boards.POST, "/api/boards", { product_id: product.id, name: `Board ${++n}` });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const { rows } = await db.query(
    "SELECT name, slug, color, position FROM columns WHERE board_id = $1 ORDER BY position",
    [r.data.id]
  );
  return rows;
}

const builtIn = () =>
  DEFAULT_COLUMNS.map((c, i) => ({ name: c.name, color: c.color, position: i }));
const shape = (rows) => rows.map(({ name, color, position }) => ({ name, color, position }));

test("a board added to an existing product gets the Default columns setting", { skip }, async () => {
  await save(
    JSON.stringify([
      { name: "Ideas", color: "#111111" },
      { name: "Doing", color: "#222222" },
      { name: "Shipped", color: "#333333" },
    ])
  );
  try {
    const cols = await addBoard();
    assert.deepEqual(
      cols.map((c) => [c.name, c.slug, c.color, c.position]),
      [
        ["Ideas", "ideas", "#111111", 0],
        ["Doing", "doing", "#222222", 1],
        ["Shipped", "shipped", "#333333", 2],
      ]
    );
  } finally {
    await forget();
  }
});

test("saved columns that make the same slug are skipped, not a failed insert", { skip }, async () => {
  await save(
    JSON.stringify([
      { name: "Can't", color: "#111111" },
      { name: "Cant", color: "#222222" },
      { name: "Done", color: "#333333" },
    ])
  );
  try {
    const cols = await addBoard();
    assert.deepEqual(cols.map((c) => [c.name, c.slug]), [["Can't", "cant"], ["Done", "done"]]);
  } finally {
    await forget();
  }
});

test("without the setting, a new board gets the built-in columns", { skip }, async () => {
  await forget();
  assert.deepEqual(shape(await addBoard()), builtIn());
});

test("an unreadable setting falls back to the built-in columns instead of failing", { skip }, async () => {
  for (const value of ["not json", JSON.stringify({ name: "Todo" }), JSON.stringify([{ color: "#111111" }])]) {
    await save(value);
    try {
      assert.deepEqual(shape(await addBoard()), builtIn(), value);
    } finally {
      await forget();
    }
  }
});

test("a new product's boards and a board added later get the same columns", { skip }, async () => {
  await save(JSON.stringify([{ name: "Now", color: "#444444" }, { name: "Later", color: "#555555" }]));
  try {
    const p = await post(api.products.POST, "/api/products", { org_id: product.org_id, name: "Same Columns" });
    assert.equal(p.status, 201, JSON.stringify(p.data));
    const { rows: boards } = await db.query("SELECT id FROM boards WHERE product_id = $1 ORDER BY position", [p.data.id]);
    const { rows: first } = await db.query(
      "SELECT name, color, position FROM columns WHERE board_id = $1 ORDER BY position",
      [boards[0].id]
    );
    assert.deepEqual(shape(await addBoard()), first);
  } finally {
    await forget();
  }
});
