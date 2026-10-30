// Quick search (card 295) through the real route handler: GET
// /api/cards/search?q= finds cards across every board and product in the
// team, by words in the title, description or labels, or by reference
// (AB-12, #41, 41), and says where each one lives so the dialog can show it
// and open its permanent link.
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
const SCHEMA = `card_search_test_${process.pid}`;

let api;
let end;
let db;
const cards = {};
let ab;
let okb;

const load = (path) => import(new URL(`../src/app/api/${path}/route.ts`, import.meta.url).href);

async function search(q, extra = "") {
  const { NextRequest } = api.next;
  const qs = q === null ? extra : `q=${encodeURIComponent(q)}${extra}`;
  const response = await api.search.GET(new NextRequest(`http://localhost/api/cards/search?${qs}`));
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}
const titles = (r) => r.data.map((c) => c.title);

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
    search: await load("cards/search"),
  };

  const post = async (handler, path, body) => {
    const { NextRequest } = api.next;
    const r = await handler(new NextRequest(`http://localhost${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    assert.ok(r.status < 300, await r.clone().text());
    return r.json();
  };
  const org = await post(api.orgs.POST, "/api/orgs", { name: "Search Labs" });
  ab = await post(api.products.POST, "/api/products", { org_id: org.id, name: "AgentBoard" });
  okb = await post(api.products.POST, "/api/products", { org_id: org.id, name: "OpenKB" });
  const columnsOf = async (product) =>
    (await db.query(
      "SELECT c.id, c.name FROM columns c JOIN boards b ON b.id = c.board_id WHERE b.product_id = $1 ORDER BY b.position, c.position",
      [product.id],
    )).rows;
  const abCols = await columnsOf(ab);
  const okbCols = await columnsOf(okb);
  const abDone = abCols.find((c) => c.name.toLowerCase() === "done");
  assert.ok(abDone, "the default board has a Done column");

  const add = async (name, column_id, title, extra = {}) => {
    cards[name] = await post(api.cards.POST, "/api/cards", { column_id, title, ...extra });
  };
  await add("login", abCols[0].id, "Fix login redirect", { description: "Signed-out links land on /" });
  await add("loginDone", abDone.id, "Login page copy");
  await add("search", abCols[0].id, "Board search", { labels: "search, ux" });
  await add("okbLogin", okbCols[0].id, "Login for the docs site");
  await add("percent", okbCols[0].id, "Show 100% when every subtask is done");
  await add("plain", okbCols[0].id, "Show 100 cards per page");
  for (let i = 0; i < 12; i++) await add(`bulk${i}`, okbCols[0].id, `Bulk card ${i}`);
});

after(async () => {
  if (skip || !end) return;
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await end();
});

test("a blank query finds nothing rather than everything", { skip }, async () => {
  for (const q of [null, "", "   "]) {
    const r = await search(q);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, []);
  }
});

test("words match titles across every product in the team", { skip }, async () => {
  const r = await search("login");
  assert.equal(r.status, 200);
  assert.deepEqual(new Set(titles(r)), new Set(["Fix login redirect", "Login page copy", "Login for the docs site"]));
});

test("every word has to match, in the title, description or labels", { skip }, async () => {
  assert.deepEqual(titles(await search("login redirect")), ["Fix login redirect"]);
  assert.deepEqual(titles(await search("login signed-out")), ["Fix login redirect"], "description");
  assert.deepEqual(titles(await search("ux")), ["Board search"], "labels");
  assert.deepEqual(titles(await search("login nowhere")), []);
});

test("cards in a Done column come after open ones", { skip }, async () => {
  const r = await search("login");
  assert.equal(r.data.at(-1).title, "Login page copy");
});

test("each result says where the card lives and how to link to it", { skip }, async () => {
  const [hit] = (await search("redirect")).data;
  assert.equal(hit.id, cards.login.id);
  assert.equal(hit.key, cards.login.key);
  assert.match(hit.key, /^AB-\d+$/);
  assert.equal(hit.product_name, "AgentBoard");
  assert.equal(hit.org_slug, "search-labs");
  assert.equal(typeof hit.product_slug, "string");
  assert.equal(typeof hit.board_name, "string");
  assert.equal(typeof hit.column_name, "string");
  assert.equal(hit.done, false);
});

test("a key finds exactly that card, in any case", { skip }, async () => {
  const key = cards.search.key;
  assert.deepEqual(titles(await search(key)), ["Board search"]);
  assert.deepEqual(titles(await search(key.toLowerCase())), ["Board search"]);
});

test("a number finds the card with that id first, then cards numbered that", { skip }, async () => {
  const r = await search(`#${cards.okbLogin.id}`);
  assert.equal(r.data[0].id, cards.okbLogin.id);
  const n = await search(String(cards.login.number));
  assert.ok(n.data.some((c) => c.id === cards.login.id), "AB card with that number");
});

test("an old product key still finds the card", { skip }, async () => {
  const { NextRequest } = api.next;
  const productRoute = await load("products/[id]");
  const r = await productRoute.PATCH(
    new NextRequest(`http://localhost/api/products/${okb.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "DOCS" }),
    }),
    { params: Promise.resolve({ id: String(okb.id) }) },
  );
  assert.ok(r.status < 300, await r.text());
  const old = cards.okbLogin.key;
  assert.match(old, /^OKB-\d+$/);
  const hit = await search(old);
  assert.deepEqual(titles(hit), ["Login for the docs site"]);
  assert.match(hit.data[0].key, /^DOCS-\d+$/, "shown with its current key");
});

test("LIKE wildcards are matched literally", { skip }, async () => {
  assert.deepEqual(titles(await search("100%")), ["Show 100% when every subtask is done"]);
  assert.deepEqual(titles(await search("_")), []);
});

test("results are capped, 20 by default and at most 50", { skip }, async () => {
  assert.equal((await search("bulk")).data.length, 12);
  assert.equal((await search("bulk", "&limit=5")).data.length, 5);
  assert.equal((await search("bulk", "&limit=500")).data.length, 12);
  const card = await search("card");
  assert.ok(card.data.length <= 20);
  assert.equal((await search("bulk", "&limit=abc")).status, 200);
});
