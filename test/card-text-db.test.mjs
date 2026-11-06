// A NUL character in a card's text through the real card routes (AB-117).
// Postgres text can't hold one, so it used to reach the INSERT or UPDATE and
// fail it with "invalid byte sequence for encoding UTF8: 0x00", an HTTP 500.
// Now it's a 400 that names the field, and nothing is written.
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
const SCHEMA = `card_text_test_${process.pid}`;

// Every string a card write stores, with a value that is otherwise valid.
const FIELDS = {
  title: "Ship\u0000it",
  description: "line one\n\u0000",
  labels: "bug,\u0000",
  assignee: "Remy\u0000",
  priority: "high\u0000",
  github_issue_url: "https://github.com/o/r/issues/1\u0000",
  github_pr_url: "\u0000https://github.com/o/r/pull/2",
};

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

const COLUMNS = "title, description, labels, assignee, priority, github_issue_url, github_pr_url";

async function stored(id = card.id) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM cards WHERE id = $1`, [id]);
  return rows[0];
}

const count = async () => Number((await db.query("SELECT count(*) FROM cards")).rows[0].count);

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

  const org = await call(api.orgs.POST, "/api/orgs", { method: "POST", body: { name: "Text Labs" } });
  const product = await call(api.products.POST, "/api/products", { method: "POST", body: { org_id: org.data.id, name: "AgentBoard" } });
  const { rows } = await db.query(
    "SELECT c.id FROM columns c JOIN boards b ON b.id = c.board_id WHERE b.product_id = $1 ORDER BY b.position, c.position LIMIT 1",
    [product.data.id],
  );
  columnId = rows[0].id;
  const made = await create({
    title: "Ship it", description: "first", labels: "bug", priority: "low",
    github_issue_url: "https://github.com/o/r/issues/1", github_pr_url: "https://github.com/o/r/pull/2",
  });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  card = made.data;
});

after(async () => {
  if (skip || !end) return;
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await end();
});

test("a NUL in any text field on update is a 400 naming it, and nothing is written", { skip }, async () => {
  const before = await stored();
  for (const [field, value] of Object.entries(FIELDS)) {
    // Beside a valid change, which must not be written either.
    const body = field === "description" ? { [field]: value, title: "Renamed" } : { [field]: value, description: "changed" };
    const r = await patch(body);
    assert.equal(r.status, 400, `${field}: ${JSON.stringify(r.data)}`);
    assert.match(r.data.error, new RegExp(`^${field} can't contain a NUL character`));
    assert.deepEqual(await stored(), before, `${field}: no field changed`);
  }
});

test("a NUL in any text field on create is a 400 naming it, and no card is made", { skip }, async () => {
  const n = await count();
  for (const [field, value] of Object.entries(FIELDS)) {
    const body = field === "title" ? { title: value } : { title: "Never made", [field]: value };
    const r = await create(body);
    assert.equal(r.status, 400, `${field}: ${JSON.stringify(r.data)}`);
    assert.match(r.data.error, new RegExp(`^${field} can't contain a NUL character`));
  }
  assert.equal(await count(), n);
});

test("other control characters and non-ASCII text are still stored as sent", { skip }, async () => {
  const description = "tab\there \u0001\u001f\u007f é 😀   end";
  const r = await patch({ description });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await stored()).description, description);

  const made = await create({ title: "Bell \u0007 ok", description });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal((await stored(made.data.id)).title, "Bell \u0007 ok");
});
