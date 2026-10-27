// Card links (card 250) through the real route handlers: a card can link any
// http(s) URL, such as a Slack thread, a doc or a design, not only a GitHub
// issue or PR.
//
// - Linking the same URL twice keeps one link, so a retried command doesn't
//   pile up duplicates. A title given the second time replaces the old one.
// - Only http(s) is stored: the app renders links as hrefs.
// - Removing is by URL, the thing the caller already has.
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
const SCHEMA = `card_links_test_${process.pid}`;

const SLACK = "https://stratuslabs.slack.com/archives/C0123456789/p1791332967606559";
const DOC = "https://docs.google.com/document/d/abc/edit";
const FIGMA = "https://www.figma.com/design/XYZ/AgentBoard?node-id=1-2";

let api;
let end;
let db;
let card;

async function call(handler, { method = "GET", body, id } = {}) {
  const { NextRequest } = api.next;
  const request = new NextRequest(`http://localhost/api/cards/${id}/links`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const response = await handler(request, { params: Promise.resolve({ id: String(id) }) });
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
const list = (id = card.id) => call(api.links.GET, { id });
const add = (body, id = card.id) => call(api.links.POST, { method: "POST", id, body });
const remove = (body, id = card.id) => call(api.links.DELETE, { method: "DELETE", id, body });
const stored = async () =>
  (await db.query("SELECT url, title FROM card_links WHERE card_id = $1 ORDER BY id", [card.id])).rows;
const updatedAt = async () =>
  (await db.query("SELECT updated_at FROM cards WHERE id = $1", [card.id])).rows[0].updated_at.getTime();

function expect(r, status, pattern) {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (pattern) assert.match(r.data.error, pattern);
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
    links: await load("cards/[id]/links"),
  };

  const post = async (handler, path, body) => {
    const { NextRequest } = api.next;
    const r = await handler(new NextRequest(`http://localhost${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    assert.ok(r.status < 300, await r.clone().text());
    return r.json();
  };
  const org = await post(api.orgs.POST, "/api/orgs", { name: "Link Labs" });
  const product = await post(api.products.POST, "/api/products", { org_id: org.id, name: "AgentBoard" });
  const { rows } = await db.query(
    "SELECT c.id FROM columns c JOIN boards b ON b.id = c.board_id WHERE b.product_id = $1 ORDER BY b.position, c.position LIMIT 1",
    [product.id],
  );
  card = await post(api.cards.POST, "/api/cards", { column_id: rows[0].id, title: "Link anything" });
});

after(async () => {
  if (skip || !end) return;
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await end();
});

test("a card starts with no links", { skip }, async () => {
  const r = await list();
  expect(r, 200);
  assert.deepEqual(r.data, []);
});

test("any http(s) URL links to the card, in the order added", { skip }, async () => {
  const before = await updatedAt();
  const slack = await add({ url: SLACK, title: "Launch thread" });
  expect(slack, 201);
  assert.equal(slack.data.card_id, card.id);
  assert.equal(slack.data.url, SLACK);
  assert.equal(slack.data.title, "Launch thread");
  expect(await add({ url: DOC }), 201);
  expect(await add({ url: FIGMA, title: "Design" }), 201);
  const r = await list();
  expect(r, 200);
  assert.deepEqual(r.data.map((l) => [l.url, l.title]), [[SLACK, "Launch thread"], [DOC, null], [FIGMA, "Design"]]);
  assert.ok((await updatedAt()) >= before, "a link write bumps the card, so board deltas pick it up");
});

test("the card's readable key works in place of its id", { skip }, async () => {
  assert.ok(card.key, "the card has a key like AB-1");
  const r = await list(card.key);
  expect(r, 200);
  assert.equal(r.data.length, 3);
});

test("linking a URL again keeps one link; a new title replaces the old", { skip }, async () => {
  const again = await add({ url: SLACK });
  expect(again, 200);
  assert.equal(again.data.title, "Launch thread", "no title keeps the old one");
  const retitled = await add({ url: DOC, title: "Spec" });
  expect(retitled, 200);
  assert.equal(retitled.data.title, "Spec");
  assert.deepEqual(await stored(), [
    { url: SLACK, title: "Launch thread" },
    { url: DOC, title: "Spec" },
    { url: FIGMA, title: "Design" },
  ]);
});

test("a URL that isn't http(s), or a bad body, is a 400 and stores nothing", { skip }, async () => {
  const before = await stored();
  expect(await add({ url: "javascript:alert(document.cookie)" }), 400, /http/);
  expect(await add({ url: "not a url" }), 400, /url/);
  expect(await add({}), 400, /url/);
  expect(await add("{not json"), 400, /JSON/);
  assert.deepEqual(await stored(), before);
});

test("a missing card is a 404", { skip }, async () => {
  expect(await list(999999), 404);
  expect(await add({ url: SLACK }, 999999), 404);
  expect(await remove({ url: SLACK }, 999999), 404);
  expect(await list("nope"), 404);
});

test("removing is by URL; removing it again is a 404", { skip }, async () => {
  expect(await remove({ url: DOC }), 200);
  assert.deepEqual((await stored()).map((l) => l.url), [SLACK, FIGMA]);
  expect(await remove({ url: DOC }), 404, /link/);
  expect(await remove({}), 400, /url/);
});

test("deleting the card deletes its links", { skip }, async () => {
  const r = await api.card.DELETE(
    new api.next.NextRequest(`http://localhost/api/cards/${card.id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: String(card.id) }) },
  );
  assert.equal(r.status, 200, await r.text());
  assert.deepEqual(await stored(), []);
});
