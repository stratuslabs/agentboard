// The slug rule (card 248) through the real route handlers: add and rename of
// orgs, products, boards and columns.
//
// - Renaming an org, product or board keeps its slug, so saved references
//   (agent configs, URLs) keep working. Renaming General to HQ once broke
//   every agent config that pointed at `general`.
// - A name that makes a slug a sibling already holds is a 409 that names the
//   holder, on add and on rename, instead of a 500 or a silent no-op.
// - Apostrophes are dropped: "Floyd's X" is floyds-x.
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
const SCHEMA = `slug_rules_test_${process.pid}`;

let api;
let end;
let db;
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

function expect(r, status, pattern) {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (pattern) assert.match(r.data.error, pattern);
}

const post = (handler, path, body) => call(handler, path, { method: "POST", body });
const patch = (handler, path, id, body) => call(handler, `${path}/${id}`, { method: "PATCH", body, params: { id: String(id) } });

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
    org: await load("orgs/[id]"),
    products: await load("products"),
    product: await load("products/[id]"),
    boards: await load("boards"),
    board: await load("boards/[id]"),
    columns: await load("columns"),
    column: await load("columns/[id]"),
  };

  const o = await post(api.orgs.POST, "/api/orgs", { name: "Slug Labs" });
  expect(o, 201);
  org = o.data;
  const p = await post(api.products.POST, "/api/products", { org_id: org.id, name: "General" });
  expect(p, 201);
  product = p.data;
});

after(async () => {
  if (skip || !end) return;
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await end();
});

const boardsOf = async (productId) =>
  (await db.query("SELECT id, name, slug FROM boards WHERE product_id = $1 ORDER BY id", [productId])).rows;

test("renaming a product keeps its slug", { skip }, async () => {
  const r = await patch(api.product.PATCH, "/api/products", product.id, { name: "HQ" });
  expect(r, 200);
  assert.equal(r.data.name, "HQ");
  assert.equal(r.data.slug, "general", "agent configs pointing at 'general' still work");
});

test("adding a product whose name makes a taken slug is a 409 naming the holder", { skip }, async () => {
  // The renamed product still holds `general`.
  const r = await post(api.products.POST, "/api/products", { org_id: org.id, name: "General" });
  expect(r, 409, /already uses the slug 'general' \(HQ\)/);
  const again = await post(api.products.POST, "/api/products", { org_id: org.id, name: "hq" });
  // Nobody holds `hq`, but a sibling is already called HQ.
  expect(again, 409, /product in this org is already called HQ \(slug 'general'\)/);
});

test("renaming a product to another product's name is a 409", { skip }, async () => {
  const other = await post(api.products.POST, "/api/products", { org_id: org.id, name: "Ops" });
  expect(other, 201);
  const r = await patch(api.product.PATCH, "/api/products", product.id, { name: "OPS" });
  expect(r, 409, /'ops' \(Ops\)/);
  const { rows } = await db.query("SELECT name, slug FROM products WHERE id = $1", [product.id]);
  assert.deepEqual(rows[0], { name: "HQ", slug: "general" }, "nothing changed");
});

test("renaming a board keeps its slug", { skip }, async () => {
  const [dev] = await boardsOf(product.id);
  assert.equal(dev.slug, "development");
  const r = await patch(api.board.PATCH, "/api/boards", dev.id, { name: "Engineering" });
  expect(r, 200);
  assert.equal(r.data.name, "Engineering");
  assert.equal(r.data.slug, "development");
});

test("renaming a board to a sibling's slug fails loudly instead of silently", { skip }, async () => {
  const boards = await boardsOf(product.id);
  const eng = boards.find((b) => b.slug === "development");
  const r = await patch(api.board.PATCH, "/api/boards", eng.id, { name: "Marketing" });
  expect(r, 409, /board in this product already uses the slug 'marketing' \(Marketing\)/);
});

test("adding a board with a taken slug is a 409, and apostrophes are dropped", { skip }, async () => {
  const dup = await post(api.boards.POST, "/api/boards", { product_id: product.id, name: "SALES" });
  expect(dup, 409, /'sales' \(Sales\)/);
  const floyd = await post(api.boards.POST, "/api/boards", { product_id: product.id, name: "Floyd's X" });
  expect(floyd, 201);
  assert.equal(floyd.data.slug, "floyds-x");
  const empty = await post(api.boards.POST, "/api/boards", { product_id: product.id, name: "!!!" });
  expect(empty, 400, /letter or number/);
});

test("adding a column with a taken slug is a 409, and apostrophes are dropped", { skip }, async () => {
  const [board] = await boardsOf(product.id);
  const dup = await post(api.columns.POST, "/api/columns", { board_id: board.id, name: "TODO" });
  expect(dup, 409, /column on this board already uses the slug 'todo' \(Todo\)/);
  const cant = await post(api.columns.POST, "/api/columns", { board_id: board.id, name: "Can't replicate" });
  expect(cant, 201);
  assert.equal(cant.data.slug, "cant-replicate");
});

test("renaming a column still moves its slug to the new name", { skip }, async () => {
  const [board] = await boardsOf(product.id);
  const { rows } = await db.query("SELECT id FROM columns WHERE board_id = $1 AND slug = 'cant-replicate'", [board.id]);
  const r = await patch(api.column.PATCH, "/api/columns", rows[0].id, { name: "Won't fix" });
  expect(r, 200);
  assert.equal(r.data.slug, "wont-fix");
});

test("renaming an org keeps its slug; a taken name is a 409", { skip }, async () => {
  const r = await patch(api.org.PATCH, "/api/orgs", org.id, { name: "Stratus Labs" });
  expect(r, 200);
  assert.equal(r.data.slug, "slug-labs");
  const other = await post(api.orgs.POST, "/api/orgs", { name: "Second Org" });
  expect(other, 201);
  const clash = await patch(api.org.PATCH, "/api/orgs", other.data.id, { name: "SLUG LABS" });
  expect(clash, 409, /'slug-labs' \(Stratus Labs\)/);
  const dupAdd = await post(api.orgs.POST, "/api/orgs", { name: "Second-Org" });
  expect(dupAdd, 409, /'second-org' \(Second Org\)/);
});

test("a custom org slug is checked against stored slugs only, not names", { skip }, async () => {
  // The first org is now called Stratus Labs but holds `slug-labs`, so
  // `stratus-labs` is free even though that name would make it.
  const free = await post(api.orgs.POST, "/api/orgs", { name: "Sales Org", slug: "stratus-labs" });
  expect(free, 201);
  assert.equal(free.data.slug, "stratus-labs");
  const taken = await post(api.orgs.POST, "/api/orgs", { name: "Third Org", slug: "slug-labs" });
  expect(taken, 409, /already uses the slug 'slug-labs' \(Stratus Labs\)/);
});

test("saved defaults that now make the same slug don't break adding a product", { skip }, async () => {
  // Distinct under the old rule (can-t, cant), the same once apostrophes are
  // dropped. The later one is skipped instead of failing the insert halfway.
  const teamId = org.team_id;
  const { rows: saved } = await db.query(
    "SELECT key, value FROM settings WHERE team_id = $1 AND key IN ('default_boards', 'default_columns')",
    [teamId]
  );
  const save = (key, value) =>
    db.query(
      "INSERT INTO settings (team_id, key, value) VALUES ($1, $2, $3) ON CONFLICT ON CONSTRAINT settings_pkey DO UPDATE SET value = EXCLUDED.value",
      [teamId, key, value]
    );
  await save("default_boards", JSON.stringify(["Floyd's", "Floyds", "Ops"]));
  await save(
    "default_columns",
    JSON.stringify([
      { name: "Can't", color: "#111111" },
      { name: "Cant", color: "#222222" },
      { name: "Done", color: "#333333" },
    ])
  );
  try {
    const r = await post(api.products.POST, "/api/products", { org_id: org.id, name: "Defaults Check" });
    expect(r, 201);
    const boards = await boardsOf(r.data.id);
    assert.deepEqual(boards.map((b) => [b.name, b.slug]), [["Floyd's", "floyds"], ["Ops", "ops"]]);
    const { rows: cols } = await db.query("SELECT name, slug FROM columns WHERE board_id = $1 ORDER BY position", [boards[0].id]);
    assert.deepEqual(cols.map((c) => [c.name, c.slug]), [["Can't", "cant"], ["Done", "done"]]);
  } finally {
    await db.query("DELETE FROM settings WHERE team_id = $1 AND key IN ('default_boards', 'default_columns')", [teamId]);
    for (const row of saved) await save(row.key, row.value);
  }
});
