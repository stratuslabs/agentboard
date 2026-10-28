// Every card the API returns carries `url`, the card's permanent link on this
// server (`<origin>/c/<id>`), so an agent can cite the card itself instead of
// "card 142 on the Development board". The origin is the one the caller
// reached: behind a proxy that's X-Forwarded-Proto/Host, the same public host
// the origin check in middleware trusts.
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
const SCHEMA = `card_url_test_${process.pid}`;

let api;
let db;
let end;
let configure;
const team = {};

async function call(handler, path, { method = "GET", body, id, headers = {}, base = "http://localhost" } = {}) {
  const { NextRequest } = api.next;
  const request = new NextRequest(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-team": String(team.id), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = id === undefined
    ? await handler(request)
    : await handler(request, { params: Promise.resolve({ id: String(id) }) });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

async function load(path) {
  return import(new URL(`../src/app/api/${path}/route.ts`, import.meta.url).href);
}

const resolver = {
  fromRequest: async (request) => ({
    teamId: Number(request.headers.get("x-test-team")),
    userId: null,
    memberId: null,
  }),
};

const PROXIED = { "x-forwarded-host": "board.example.com", "x-forwarded-proto": "https" };

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

  const tenant = await import(new URL("../src/lib/tenant.ts", import.meta.url).href);
  ({ configure } = await import(new URL("../src/configure.ts", import.meta.url).href));
  api = {
    next: require("next/server.js"),
    orgs: await load("orgs"),
    products: await load("products"),
    board: await load("board"),
    cards: await load("cards"),
    card: await load("cards/[id]"),
    move: await load("cards/[id]/move"),
    views: await load("cards/views"),
    members: await load("members"),
  };

  team.id = (await tenant.resolveTenant(new Request("http://localhost/"))).teamId;
  configure({ tenant: resolver });

  const org = await call(api.orgs.POST, "/api/orgs", { method: "POST", body: { name: "Acme" } });
  const product = await call(api.products.POST, "/api/products", {
    method: "POST", body: { org_id: org.data.id, name: "Widget", key: "WG" },
  });
  team.product = product.data;
  const board = await call(api.board.GET, `/api/board?product_id=${product.data.id}`);
  team.columns = board.data.columns;
  const member = await call(api.members.POST, "/api/members", {
    method: "POST", body: { name: "Scout", type: "agent" },
  });
  team.member = member.data;
});

after(async () => {
  if (skip || !end) return;
  configure({});
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await end();
});

async function newCard(extra = {}, opts = {}) {
  return call(api.cards.POST, "/api/cards", {
    method: "POST", body: { column_id: team.columns[0].id, title: "work", ...extra }, ...opts,
  });
}

test("a created card comes back with its link on the host that was called", { skip }, async () => {
  const created = await newCard();
  assert.equal(created.status, 201);
  assert.equal(created.data.url, `http://localhost/c/${created.data.id}`);

  const direct = await newCard({}, { base: "http://localhost:3000" });
  assert.equal(direct.data.url, `http://localhost:3000/c/${direct.data.id}`);
});

test("behind a proxy the link uses the public host and scheme", { skip }, async () => {
  const created = await newCard({}, { headers: PROXIED, base: "http://127.0.0.1:3000" });
  assert.equal(created.data.url, `https://board.example.com/c/${created.data.id}`);

  // A proxy chain lists hops; the first is the client-facing one.
  const chained = await call(api.card.GET, `/api/cards/${created.data.id}`, {
    id: created.data.id,
    headers: { "x-forwarded-host": "board.example.com, inner:3000", "x-forwarded-proto": "https,http" },
  });
  assert.equal(chained.data.url, `https://board.example.com/c/${created.data.id}`);
});

test("a forwarded scheme other than http or https is ignored", { skip }, async () => {
  const created = await newCard();
  const odd = await call(api.card.GET, `/api/cards/${created.data.id}`, {
    id: created.data.id,
    headers: { "x-forwarded-host": "board.example.com", "x-forwarded-proto": "javascript" },
  });
  assert.equal(odd.data.url, `http://board.example.com/c/${created.data.id}`);
});

test("a host header that can't form a URL falls back to the address that was called", { skip }, async () => {
  const created = await newCard();
  const bad = await call(api.card.GET, `/api/cards/${created.data.id}`, {
    id: created.data.id,
    headers: { "x-forwarded-host": "bad host/with spaces" },
  });
  assert.equal(bad.status, 200);
  assert.equal(bad.data.url, `http://localhost/c/${created.data.id}`);
});

test("a card read by its key still links by its id", { skip }, async () => {
  const created = await newCard();
  assert.ok(created.data.key, "the product has a key, so the card has one");
  const byKey = await call(api.card.GET, `/api/cards/${created.data.key}`, { id: created.data.key });
  assert.equal(byKey.status, 200);
  assert.equal(byKey.data.url, `http://localhost/c/${created.data.id}`);
});

test("list, update, no-op update and move responses all carry the link", { skip }, async () => {
  const created = await newCard();
  const id = created.data.id;
  const expected = `https://board.example.com/c/${id}`;

  const list = await call(api.cards.GET, `/api/cards?product_id=${team.product.id}`, { headers: PROXIED });
  assert.equal(list.status, 200);
  assert.ok(list.data.length > 0);
  for (const card of list.data) {
    assert.equal(card.url, `https://board.example.com/c/${card.id}`);
  }

  const renamed = await call(api.card.PATCH, `/api/cards/${id}`, {
    method: "PATCH", id, body: { title: "renamed" }, headers: PROXIED,
  });
  assert.equal(renamed.data.url, expected);

  const unchanged = await call(api.card.PATCH, `/api/cards/${id}`, {
    method: "PATCH", id, body: {}, headers: PROXIED,
  });
  assert.equal(unchanged.data.url, expected);

  const moved = await call(api.move.PATCH, `/api/cards/${id}/move`, {
    method: "PATCH", id, body: { column_id: team.columns[1].id }, headers: PROXIED,
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.url, expected);
});

test("the today, assigned and past-due views carry the link", { skip }, async () => {
  const today = new Date().toISOString().slice(0, 10);
  const due = await newCard({ assignee_id: team.member.id, due_date: today });
  const late = await newCard({ assignee_id: team.member.id, due_date: "2020-01-01" });

  const views = {
    today: `/api/cards/views?view=today&tz=UTC`,
    assigned: `/api/cards/views?view=assigned&member_id=${team.member.id}`,
    "past-due": `/api/cards/views?view=past-due&member_id=${team.member.id}&tz=UTC`,
  };
  for (const [name, path] of Object.entries(views)) {
    const res = await call(api.views.GET, path, { headers: PROXIED });
    assert.equal(res.status, 200, name);
    const ids = res.data.map((c) => c.id);
    assert.ok(ids.includes(name === "past-due" ? late.data.id : due.data.id), `${name} lists the card`);
    for (const card of res.data) {
      assert.equal(card.url, `https://board.example.com/c/${card.id}`, name);
    }
  }

  // A count is not a card and gets no link.
  const count = await call(api.views.GET, `/api/cards/views?view=past-due-count&member_id=${team.member.id}&tz=UTC`);
  assert.deepEqual(Object.keys(count.data), ["count"]);
});

test("errors are passed through untouched", { skip }, async () => {
  const missing = await call(api.card.GET, "/api/cards/999999", { id: 999999 });
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.data, { error: "Not found" });
});
