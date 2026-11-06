// Bad input on routes outside the card text checks (AB-119). A NUL character
// (U+0000) in any string a route stores or searches for reached Postgres,
// which refused it with SQLSTATE 22021 "invalid byte sequence", and a card
// priority outside the four failed cards_priority_check. Both were HTTP 500s.
// Now both are 400s, and nothing is written.
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
const SCHEMA = `bad_input_test_${process.pid}`;

const NUL_ERROR = /NUL character/;

let api;
let end;
let db;
let ids;

const load = (path) => import(new URL(`../src/app/api/${path}/route.ts`, import.meta.url).href);

async function call(handler, path, { method = "GET", body, id } = {}) {
  const { NextRequest } = api.next;
  const init = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const request = new NextRequest(`http://localhost${path}`, init);
  const response = id === undefined
    ? await handler(request)
    : await handler(request, { params: Promise.resolve({ id: String(id) }) });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

/** Every row of the board data, so a test can see that nothing was written. */
async function snapshot() {
  const out = {};
  for (const table of ["organizations", "products", "boards", "columns", "cards", "subtasks", "members"]) {
    out[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  }
  return out;
}

const card = async () => (await db.query("SELECT * FROM cards WHERE id = $1", [ids.card])).rows[0];

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
    tenant: await import(new URL("../src/lib/tenant.ts", import.meta.url).href),
    orgs: await load("orgs"),
    org: await load("orgs/[id]"),
    products: await load("products"),
    boards: await load("boards"),
    columns: await load("columns"),
    column: await load("columns/[id]"),
    members: await load("members"),
    cards: await load("cards"),
    card: await load("cards/[id]"),
    subtasks: await load("cards/[id]/subtasks"),
    subtask: await load("subtasks/[id]"),
    search: await load("cards/search"),
    attachments: await load("cards/[id]/attachments"),
  };

  const org = await call(api.orgs.POST, "/api/orgs", { method: "POST", body: { name: "Input Labs" } });
  const product = await call(api.products.POST, "/api/products", { method: "POST", body: { org_id: org.data.id, name: "Widget" } });
  const { rows } = await db.query(
    "SELECT b.id AS board, c.id AS column FROM columns c JOIN boards b ON b.id = c.board_id WHERE b.product_id = $1 ORDER BY b.position, c.position LIMIT 1",
    [product.data.id],
  );
  const made = await call(api.cards.POST, "/api/cards", { method: "POST", body: { column_id: rows[0].column, title: "Ship it", priority: "high" } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const sub = await call(api.subtasks.POST, `/api/cards/${made.data.id}/subtasks`, { method: "POST", body: { title: "Step one" }, id: made.data.id });
  assert.equal(sub.status, 201, JSON.stringify(sub.data));
  ids = { org: org.data.id, product: product.data.id, board: rows[0].board, column: rows[0].column, card: made.data.id, subtask: sub.data.id };
});

after(async () => {
  if (skip || !end) return;
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await end();
});

test("a NUL in what a route stores is a 400, not a 500, and nothing is written", { skip }, async () => {
  const cases = [
    ["POST /api/orgs", () => call(api.orgs.POST, "/api/orgs", { method: "POST", body: { name: "Acme\u0000" } })],
    ["PATCH /api/orgs/:id", () => call(api.org.PATCH, `/api/orgs/${ids.org}`, { method: "PATCH", body: { name: "Ac\u0000me" }, id: ids.org })],
    ["POST /api/products", () => call(api.products.POST, "/api/products", { method: "POST", body: { org_id: ids.org, name: "\u0000Gadget" } })],
    ["POST /api/boards", () => call(api.boards.POST, "/api/boards", { method: "POST", body: { product_id: ids.product, name: "Ops\u0000" } })],
    ["POST /api/columns", () => call(api.columns.POST, "/api/columns", { method: "POST", body: { board_id: ids.board, name: "QA\u0000" } })],
    ["PATCH /api/columns/:id", () => call(api.column.PATCH, `/api/columns/${ids.column}`, { method: "PATCH", body: { name: "To\u0000do" }, id: ids.column })],
    ["POST /api/members", () => call(api.members.POST, "/api/members", { method: "POST", body: { name: "Ada\u0000", type: "human" } })],
    ["POST /api/cards/:id/subtasks", () => call(api.subtasks.POST, `/api/cards/${ids.card}/subtasks`, { method: "POST", body: { title: "x\u0000y" }, id: ids.card })],
    ["PATCH /api/subtasks/:id", () => call(api.subtask.PATCH, `/api/subtasks/${ids.subtask}`, { method: "PATCH", body: { title: "x\u0000y" }, id: ids.subtask })],
    ["POST /api/cards/:id/attachments (filename)", () => call(api.attachments.POST, `/api/cards/${ids.card}/attachments`, { method: "POST", body: { filename: "a\u0000.txt", content: "hello" }, id: ids.card })],
  ];
  const before = await snapshot();
  for (const [name, run] of cases) {
    const r = await run();
    assert.equal(r.status, 400, `${name}: ${JSON.stringify(r.data)}`);
    assert.match(r.data.error, NUL_ERROR, name);
    assert.deepEqual(await snapshot(), before, `${name}: nothing written`);
  }
});

test("a NUL in a search query is a 400, not a 500", { skip }, async () => {
  const r = await call(api.search.GET, "/api/cards/search?q=a%00b");
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, NUL_ERROR);
  const ok = await call(api.search.GET, "/api/cards/search?q=ship");
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.length, 1);
});

test("an unknown priority on update is a 400 naming the allowed ones, and the card is unchanged", { skip }, async () => {
  const before = await card();
  for (const priority of ["bogus", "High", "", 3]) {
    const r = await call(api.card.PATCH, `/api/cards/${ids.card}`, { method: "PATCH", body: { priority, title: "Renamed" }, id: ids.card });
    assert.equal(r.status, 400, `${JSON.stringify(priority)}: ${JSON.stringify(r.data)}`);
    assert.match(r.data.error, /^priority must be low, medium, high or urgent, got /);
    assert.deepEqual(await card(), before, `${JSON.stringify(priority)}: nothing written`);
  }
});

test("an unknown priority on create is a 400 and no card is made", { skip }, async () => {
  const count = async () => Number((await db.query("SELECT count(*) FROM cards")).rows[0].count);
  const n = await count();
  for (const priority of ["bogus", "URGENT", 1]) {
    const r = await call(api.cards.POST, "/api/cards", { method: "POST", body: { column_id: ids.column, title: "Never made", priority } });
    assert.equal(r.status, 400, `${JSON.stringify(priority)}: ${JSON.stringify(r.data)}`);
    assert.match(r.data.error, /^priority must be low, medium, high or urgent, got /);
  }
  assert.equal(await count(), n);
});

test("valid priorities still work: the four words, create's medium default, and null on update", { skip }, async () => {
  for (const priority of ["low", "medium", "high", "urgent"]) {
    const r = await call(api.card.PATCH, `/api/cards/${ids.card}`, { method: "PATCH", body: { priority }, id: ids.card });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await card()).priority, priority);
  }
  const cleared = await call(api.card.PATCH, `/api/cards/${ids.card}`, { method: "PATCH", body: { priority: null }, id: ids.card });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
  assert.equal((await card()).priority, null);
  for (const body of [{}, { priority: "" }, { priority: null }]) {
    const r = await call(api.cards.POST, "/api/cards", { method: "POST", body: { column_id: ids.column, title: "Default", ...body } });
    assert.equal(r.status, 201, `${JSON.stringify(body)}: ${JSON.stringify(r.data)}`);
    const { rows } = await db.query("SELECT priority FROM cards WHERE id = $1", [r.data.id]);
    assert.equal(rows[0].priority, "medium", JSON.stringify(body));
  }
});

test("the backstop answers only SQLSTATE 22021; any other error still propagates", { skip }, async () => {
  const { withTenant } = api.tenant;
  const failing = (error) => withTenant(async () => { throw error; });
  const request = () => new api.next.NextRequest("http://localhost/api/x");

  const nul = Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), { code: "22021" });
  const r = await failing(nul)(request());
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, NUL_ERROR);

  for (const code of ["23505", "23514", "57P01", undefined]) {
    const other = Object.assign(new Error(`db said ${code}`), { code });
    await assert.rejects(failing(other)(request()), (e) => e === other, String(code));
  }
});

test("a binary attachment is a 400 that says attachments hold text", { skip }, async () => {
  const count = async () => Number((await db.query("SELECT count(*) FROM attachments")).rows[0].count);
  const n = await count();
  // What a PNG read as UTF-8 looks like: its header has NUL bytes.
  const png = "\uFFFDPNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR";
  const r = await call(api.attachments.POST, `/api/cards/${ids.card}/attachments`, { method: "POST", body: { filename: "shot.png", content: png }, id: ids.card });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.error, "content can't contain a NUL character (\\u0000): attachments hold text, not binary files");
  assert.equal(await count(), n);
  const ok = await call(api.attachments.POST, `/api/cards/${ids.card}/attachments`, { method: "POST", body: { filename: "notes.md", content: "tab\there \u0001 é 😀" }, id: ids.card });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(await count(), n + 1);
});
