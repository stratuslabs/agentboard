// Two-team isolation through the real route handlers: team A's API calls can't
// read or write team B's organizations, products, boards, columns, cards,
// attachments, sub-tasks, members, settings, preferences or card keys.
//
//   AGENTBOARD_TEST_DATABASE_URL=postgres://... node --test test/
//
// Skipped without it. The handlers run in-process against a schema of their
// own, dropped at the end. Team A is the self-hosted team, resolved the way a
// self-hosted request is; team B is a second team, selected per request by a
// resolver this test installs (setTenantResolver, as the hosted edition does).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire, register } from "node:module";

const require = createRequire(import.meta.url);
const URL_VAR = "AGENTBOARD_TEST_DATABASE_URL";
const url = process.env[URL_VAR];
const skip = url ? false : `set ${URL_VAR} to run`;
const SCHEMA = `isolation_test_${process.pid}`;

/** Route modules and helpers, imported once the database is pointed at the schema. */
let api;
let tenant;
let end;
const A = {};
const B = {};

/** Call a route handler as `team`, the way Next would. */
async function call(team, handler, path, { method = "GET", body, id, headers = {} } = {}) {
  const { NextRequest } = api.next;
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-team": String(team.id), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = id === undefined
    ? await handler(request)
    : await handler(request, { params: Promise.resolve({ id: String(id) }) });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function load(path) {
  return import(new URL(`../src/app/api/${path}/route.ts`, import.meta.url).href);
}

/** One team's worth of everything, created through the API. */
async function populate(team, { orgName, productName, uniqueSlug }) {
  const org = await call(team, api.orgs.POST, "/api/orgs", { method: "POST", body: { name: orgName } });
  assert.equal(org.status, 201, JSON.stringify(org.data));
  team.org = org.data;
  const only = await call(team, api.orgs.POST, "/api/orgs", { method: "POST", body: { name: uniqueSlug } });
  team.onlyOrg = only.data;

  const product = await call(team, api.products.POST, "/api/products", {
    method: "POST", body: { org_id: team.org.id, name: productName },
  });
  assert.equal(product.status, 201, JSON.stringify(product.data));
  team.product = product.data;
  const onlyProduct = await call(team, api.products.POST, "/api/products", {
    method: "POST", body: { org_id: team.org.id, name: uniqueSlug, key: uniqueSlug.slice(0, 3).toUpperCase() },
  });
  team.onlyProduct = onlyProduct.data;

  const board = await call(team, api.board.GET, `/api/board?product_id=${team.product.id}`);
  team.board = board.data.boards[0];
  team.column = board.data.columns[0];

  const member = await call(team, api.members.POST, "/api/members", { method: "POST", body: { name: "Shared Name" } });
  team.member = member.data;

  const card = await call(team, api.cards.POST, "/api/cards", {
    method: "POST",
    body: { column_id: team.column.id, title: `${productName} card`, assignee_id: team.member.id, due_date: "2000-01-01" },
  });
  assert.equal(card.status, 201, JSON.stringify(card.data));
  team.card = card.data;

  const attachment = await call(team, api.cardAttachments.POST, `/api/cards/${team.card.id}/attachments`, {
    method: "POST", id: team.card.id, body: { filename: "a.txt", content: "secret" },
  });
  team.attachment = attachment.data;
  const subtask = await call(team, api.cardSubtasks.POST, `/api/cards/${team.card.id}/subtasks`, {
    method: "POST", id: team.card.id, body: { title: "step" },
  });
  team.subtask = subtask.data;
  const link = await call(team, api.cardLinks.POST, `/api/cards/${team.card.id}/links`, {
    method: "POST", id: team.card.id, body: { url: "https://x.test/thread", title: "thread" },
  });
  team.link = link.data;

  await call(team, api.settings.PATCH, "/api/settings", { method: "PATCH", body: { key: "theme", value: `${productName}-theme` } });
  await call(team, api.preferences.PATCH, "/api/preferences", { method: "PATCH", body: { key: "profileMemberId", value: String(team.member.id) } });
}

before(async () => {
  if (skip) return;
  // Every connection the app's pool opens starts in the test schema: pg runs
  // this before the query the pool hands the client out for.
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
  ({ end } = require("../src/lib/sql.js"));
  const { db } = require("../src/lib/sql.js");
  await db.query(`CREATE SCHEMA ${SCHEMA}`);

  tenant = await import(new URL("../src/lib/tenant.ts", import.meta.url).href);
  api = {
    next: require("next/server.js"),
    orgs: await load("orgs"),
    org: await load("orgs/[id]"),
    orgsReorder: await load("orgs/reorder"),
    products: await load("products"),
    product: await load("products/[id]"),
    productBySlug: await load("products/by-slug"),
    productMove: await load("products/move"),
    productsReorder: await load("products/reorder"),
    board: await load("board"),
    boards: await load("boards"),
    boardOne: await load("boards/[id]"),
    boardsReorder: await load("boards/reorder"),
    columns: await load("columns"),
    column: await load("columns/[id]"),
    columnsByCard: await load("columns/by-card/[id]"),
    cards: await load("cards"),
    card: await load("cards/[id]"),
    cardMove: await load("cards/[id]/move"),
    cardsReorder: await load("cards/reorder"),
    cardViews: await load("cards/views"),
    cardAttachments: await load("cards/[id]/attachments"),
    cardSubtasks: await load("cards/[id]/subtasks"),
    cardLinks: await load("cards/[id]/links"),
    attachment: await load("attachments/[id]"),
    subtask: await load("subtasks/[id]"),
    members: await load("members"),
    member: await load("members/[id]"),
    settings: await load("settings"),
    preferences: await load("preferences"),
    stream: await load("stream"),
  };

  // Team A is the self-hosted team, resolved exactly as a self-hosted request
  // is. Team B is added beside it, as the hosted edition would.
  const selfHosted = await tenant.resolveTenant(new Request("http://localhost/"));
  A.id = selfHosted.teamId;
  A.userId = selfHosted.userId;
  B.id = (await db.query("INSERT INTO teams (name, slug) VALUES ('Team B', 'team-b') RETURNING id")).rows[0].id;
  const { ensureTeamDefaults } = require("../src/lib/tenancy.js");
  await ensureTeamDefaults((t, v) => db.query(t, v), B.id);
  tenant.setTenantResolver({
    // A user per request too: x-test-user, "none" for a caller with no user
    // (the hosted edition's API keys), and otherwise the self-hosted user, 0.
    fromRequest: async (request) => {
      const user = request.headers.get("x-test-user");
      return {
        teamId: Number(request.headers.get("x-test-team")),
        userId: user === "none" ? null : Number(user ?? 0),
      };
    },
  });

  // The same names in both teams, which per-team uniques allow, plus a slug
  // only B has, for the lookups by slug.
  await populate(B, { orgName: "Acme", productName: "AgentBoard", uniqueSlug: "bravo-only" });
  await populate(A, { orgName: "Acme", productName: "AgentBoard", uniqueSlug: "alpha-only" });
});

after(async () => {
  if (skip || !end) return;
  tenant?.setTenantResolver(null);
  const { db } = require("../src/lib/sql.js");
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await end();
});

test("both teams have the same names and the same card key, each their own", { skip }, async () => {
  assert.equal(A.org.slug, B.org.slug);
  assert.notEqual(A.org.id, B.org.id);
  assert.equal(A.product.key, "AB");
  assert.equal(B.product.key, "AB");
  assert.equal(A.card.key, "AB-1");
  assert.equal(B.card.key, "AB-1");
  const viaKey = await call(A, api.card.GET, "/api/cards/AB-1", { id: "AB-1" });
  assert.equal(viaKey.data.id, A.card.id, "AB-1 means A's card to A");
  const viaKeyB = await call(B, api.card.GET, "/api/cards/AB-1", { id: "AB-1" });
  assert.equal(viaKeyB.data.id, B.card.id);
});

test("lists only ever show the caller's team", { skip }, async () => {
  const ids = (r) => r.data.map((x) => x.id);
  assert.ok(!ids(await call(A, api.orgs.GET, "/api/orgs")).includes(B.org.id));
  assert.ok(!ids(await call(A, api.products.GET, "/api/products")).includes(B.product.id));
  assert.deepEqual((await call(A, api.products.GET, `/api/products?org_id=${B.org.id}`)).data, []);
  assert.deepEqual((await call(A, api.boards.GET, `/api/boards?product_id=${B.product.id}`)).data, []);
  assert.deepEqual((await call(A, api.columns.GET, `/api/columns?board_id=${B.board.id}`)).data, []);
  const board = await call(A, api.board.GET, `/api/board?product_id=${B.product.id}`);
  assert.equal(board.status, 200);
  assert.deepEqual(board.data.boards, []);
  assert.deepEqual(board.data.cards, []);
  assert.ok(!ids(await call(A, api.cards.GET, "/api/cards")).includes(B.card.id));
  assert.deepEqual((await call(A, api.cards.GET, `/api/cards?board_id=${B.board.id}`)).data, []);
  assert.deepEqual((await call(A, api.cards.GET, `/api/cards?column_id=${B.column.id}`)).data, []);
  assert.deepEqual((await call(A, api.cards.GET, `/api/cards?assignee_id=${B.member.id}`)).data, []);
  assert.deepEqual((await call(A, api.cards.GET, "/api/cards?assignee=Shared%20Name")).data.map((c) => c.id), [A.card.id]);
  assert.ok(!ids(await call(A, api.members.GET, "/api/members")).includes(B.member.id));
  for (const view of ["today", "assigned", "past-due"]) {
    const r = await call(A, api.cardViews.GET, `/api/cards/views?view=${view}&member_id=${B.member.id}`);
    assert.ok(!ids(r).includes(B.card.id), view);
  }
  const count = await call(A, api.cardViews.GET, `/api/cards/views?view=past-due-count&member_id=${B.member.id}`);
  assert.equal(count.data.count, 0);
  assert.equal((await call(A, api.settings.GET, "/api/settings")).data.theme, "AgentBoard-theme");
  assert.equal((await call(A, api.preferences.GET, "/api/preferences")).data.profileMemberId, A.member.id);
  assert.equal((await call(B, api.preferences.GET, "/api/preferences")).data.profileMemberId, B.member.id);
  const bySlug = await call(A, api.productBySlug.GET, `/api/products/by-slug?org_slug=${B.onlyOrg.slug}&product_slug=agentboard`);
  assert.equal(bySlug.status, 404);
});

test("an attachment can be read by id, by its own team", { skip }, async () => {
  const own = await call(A, api.attachment.GET, "", { id: A.attachment.id });
  assert.equal(own.status, 200, JSON.stringify(own.data));
  assert.equal(own.data.id, A.attachment.id);
  assert.equal(own.data.card_id, A.card.id);
  assert.equal(own.data.filename, "a.txt");
  assert.equal(own.data.content, "secret");
  assert.equal((await call(A, api.attachment.GET, "", { id: "abc" })).status, 400);
  assert.equal((await call(A, api.attachment.GET, "", { id: 999999 })).status, 404);
});

test("another team's rows read as missing", { skip }, async () => {
  const notFound = async (r, what) => assert.equal((await r).status, 404, what);
  await notFound(call(A, api.card.GET, "", { id: B.card.id }), "card by id");
  await notFound(call(A, api.boardOne.GET, "", { id: B.board.id }), "board");
  await notFound(call(A, api.cardSubtasks.GET, "", { id: B.card.id }), "card's sub-tasks");
  await notFound(call(A, api.subtask.GET, "", { id: B.subtask.id }), "sub-task");
  await notFound(call(A, api.cardLinks.GET, "", { id: B.card.id }), "card's links");
  await notFound(call(A, api.attachment.GET, "", { id: B.attachment.id }), "attachment");
  await notFound(call(A, api.stream.GET, `/api/stream?board_id=${B.board.id}`), "stream of B's board");
  assert.deepEqual((await call(A, api.cardAttachments.GET, "", { id: B.card.id })).data, []);
  assert.deepEqual((await call(A, api.columnsByCard.GET, "", { id: B.card.id })).data, []);
});

test("writes aimed at another team's rows change nothing", { skip }, async () => {
  const refused = async (r, what) => assert.equal((await r).status, 404, what);
  await refused(call(A, api.org.PATCH, "", { method: "PATCH", id: B.org.id, body: { name: "Mine" } }), "rename org");
  await refused(call(A, api.org.DELETE, "", { method: "DELETE", id: B.org.id }), "delete org");
  await refused(call(A, api.org.DELETE, "", { method: "DELETE", id: B.onlyOrg.slug }), "delete org by slug");
  await refused(call(A, api.products.POST, "/api/products", { method: "POST", body: { org_id: B.org.id, name: "Planted" } }), "product in B's org");
  await refused(call(A, api.product.PATCH, "", { method: "PATCH", id: B.product.id, body: { name: "Mine" } }), "rename product");
  await refused(call(A, api.product.DELETE, "", { method: "DELETE", id: B.product.id }), "delete product");
  await refused(call(A, api.product.DELETE, "", { method: "DELETE", id: B.onlyProduct.slug }), "delete product by slug");
  await refused(call(A, api.productMove.PATCH, "", { method: "PATCH", body: { product_id: B.product.id, org_id: A.org.id } }), "take B's product");
  await refused(call(A, api.productMove.PATCH, "", { method: "PATCH", body: { product_id: A.product.id, org_id: B.org.id } }), "push into B's org");
  await refused(call(A, api.boards.POST, "", { method: "POST", body: { product_id: B.product.id, name: "Planted" } }), "board in B's product");
  await refused(call(A, api.boardOne.PATCH, "", { method: "PATCH", id: B.board.id, body: { name: "Mine" } }), "rename board");
  await refused(call(A, api.boardOne.DELETE, "", { method: "DELETE", id: B.board.id }), "delete board");
  await refused(call(A, api.columns.POST, "", { method: "POST", body: { board_id: B.board.id, name: "Planted" } }), "column on B's board");
  await refused(call(A, api.column.PATCH, "", { method: "PATCH", id: B.column.id, body: { name: "Mine" } }), "rename column");
  await refused(call(A, api.column.DELETE, "", { method: "DELETE", id: B.column.id }), "delete column");
  await refused(call(A, api.cards.POST, "", { method: "POST", body: { column_id: B.column.id, title: "Planted" } }), "card in B's column");
  await refused(call(A, api.cards.POST, "", { method: "POST", body: { column_id: A.column.id, title: "x", assignee_id: B.member.id } }), "assign B's member");
  await refused(call(A, api.card.PATCH, "", { method: "PATCH", id: B.card.id, body: { title: "Mine" } }), "edit card");
  await refused(call(A, api.card.PATCH, "", { method: "PATCH", id: A.card.id, body: { column_id: B.column.id } }), "move own card to B");
  await refused(call(A, api.card.PATCH, "", { method: "PATCH", id: A.card.id, body: { assignee_id: B.member.id } }), "assign own card to B's member");
  await refused(call(A, api.card.DELETE, "", { method: "DELETE", id: B.card.id }), "delete card");
  await refused(call(A, api.cardMove.PATCH, "", { method: "PATCH", id: B.card.id, body: { column_id: A.column.id } }), "move B's card");
  await refused(call(A, api.cardMove.PATCH, "", { method: "PATCH", id: A.card.id, body: { column_id: B.column.id } }), "move own card into B's column");
  await refused(call(A, api.cardAttachments.POST, "", { method: "POST", id: B.card.id, body: { filename: "x", content: "y" } }), "attach to B's card");
  await refused(call(A, api.attachment.DELETE, "", { method: "DELETE", id: B.attachment.id }), "delete attachment");
  await refused(call(A, api.cardSubtasks.POST, "", { method: "POST", id: B.card.id, body: { title: "x" } }), "sub-task on B's card");
  await refused(call(A, api.subtask.PATCH, "", { method: "PATCH", id: B.subtask.id, body: { done: true } }), "tick sub-task");
  await refused(call(A, api.subtask.DELETE, "", { method: "DELETE", id: B.subtask.id }), "delete sub-task");
  await refused(call(A, api.cardLinks.POST, "", { method: "POST", id: B.card.id, body: { url: "https://evil.test" } }), "link on B's card");
  await refused(call(A, api.cardLinks.DELETE, "", { method: "DELETE", id: B.card.id, body: { url: B.link.url } }), "unlink B's link");
  await refused(call(A, api.member.PATCH, "", { method: "PATCH", id: B.member.id, body: { name: "Mine" } }), "rename member");
  await refused(call(A, api.member.DELETE, "", { method: "DELETE", id: B.member.id }), "delete member");

  // Reorders skip foreign ids rather than moving them.
  await call(A, api.orgsReorder.PATCH, "", { method: "PATCH", body: { ids: [B.onlyOrg.id, B.org.id] } });
  await call(A, api.productsReorder.PATCH, "", { method: "PATCH", body: { ids: [B.onlyProduct.id, B.product.id] } });
  await call(A, api.boardsReorder.PATCH, "", { method: "PATCH", body: { ids: [B.board.id, A.board.id] } });
  await call(A, api.cardsReorder.PATCH, "", { method: "PATCH", body: { ids: [999999, B.card.id] } });

  // Settings, preferences and agents with the same key or name stay per team.
  await call(A, api.settings.PATCH, "", { method: "PATCH", body: { key: "theme", value: "a-changed" } });
  await call(A, api.preferences.PATCH, "", { method: "PATCH", body: { key: "profileMemberId", value: "0" } });
  const agentCard = await call(A, api.cards.POST, "", {
    method: "POST", body: { column_id: A.column.id, title: "by agent" }, headers: { "x-agent-name": "Remy" },
  });
  const bAgentCard = await call(B, api.cards.POST, "", {
    method: "POST", body: { column_id: B.column.id, title: "by agent" }, headers: { "x-agent-name": "Remy" },
  });
  assert.notEqual(agentCard.data.assignee_id, bAgentCard.data.assignee_id, "each team gets its own Remy");

  // And a key B uses is free for A.
  const rekey = await call(A, api.product.PATCH, "", { method: "PATCH", id: A.onlyProduct.id, body: { key: B.onlyProduct.key } });
  assert.equal(rekey.status, 200, JSON.stringify(rekey.data));
});

test("team B's data came through all of that untouched", { skip }, async () => {
  const orgs = (await call(B, api.orgs.GET, "/api/orgs")).data;
  assert.deepEqual(orgs.map((o) => [o.id, o.name, o.position]), [[B.org.id, "Acme", 0], [B.onlyOrg.id, "bravo-only", 1]]);
  const products = (await call(B, api.products.GET, `/api/products?org_id=${B.org.id}`)).data;
  assert.deepEqual(products.map((p) => [p.id, p.name, p.org_id]).sort(), [[B.product.id, "AgentBoard", B.org.id], [B.onlyProduct.id, "bravo-only", B.org.id]].sort());
  const board = (await call(B, api.board.GET, `/api/board?product_id=${B.product.id}`)).data;
  assert.equal(board.boards[0].id, B.board.id);
  assert.equal(board.boards[0].name, B.board.name);
  assert.equal(board.boards[0].position, B.board.position);
  assert.ok(board.columns.some((c) => c.id === B.column.id && c.name === B.column.name));
  const card = (await call(B, api.card.GET, "", { id: B.card.id })).data;
  assert.deepEqual(
    [card.title, card.column_id, card.assignee_id, card.position, card.key],
    [B.card.title, B.column.id, B.member.id, B.card.position, "AB-1"]
  );
  assert.equal((await call(B, api.cardAttachments.GET, "", { id: B.card.id })).data.length, 1);
  const subtask = (await call(B, api.subtask.GET, "", { id: B.subtask.id })).data;
  assert.equal(subtask.done, false);
  const links = (await call(B, api.cardLinks.GET, "", { id: B.card.id })).data;
  assert.deepEqual(links.map((l) => [l.id, l.url, l.title]), [[B.link.id, "https://x.test/thread", "thread"]]);
  const members = (await call(B, api.members.GET, "/api/members")).data;
  assert.ok(members.some((m) => m.id === B.member.id && m.name === "Shared Name"));
  assert.equal((await call(B, api.settings.GET, "/api/settings")).data.theme, "AgentBoard-theme");
  assert.equal((await call(B, api.preferences.GET, "/api/preferences")).data.profileMemberId, B.member.id);
});

test("preferences are per user within a team, and need a user", { skip }, async () => {
  assert.equal(A.userId, 0, "self-hosted requests act as its one implicit user");
  const as = (/** @type {string} */ user) => ({ headers: { "x-test-user": user } });
  const prefs = api.preferences;
  for (const [user, value] of [["1", "101"], ["2", "102"]]) {
    const saved = await call(B, prefs.PATCH, "/api/preferences", { method: "PATCH", body: { key: "profileMemberId", value }, ...as(user) });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
  }
  assert.equal((await call(B, prefs.GET, "/api/preferences", as("1"))).data.profileMemberId, 101);
  assert.equal((await call(B, prefs.GET, "/api/preferences", as("2"))).data.profileMemberId, 102);
  assert.equal((await call(B, prefs.GET, "/api/preferences")).data.profileMemberId, B.member.id, "user 0's stays its own");
  assert.equal((await call(A, prefs.GET, "/api/preferences", as("1"))).data.profileMemberId, undefined, "and user 1 in team A has none");

  assert.equal((await call(B, prefs.GET, "/api/preferences", as("none"))).status, 403);
  const anon = await call(B, prefs.PATCH, "/api/preferences", { method: "PATCH", body: { key: "x", value: "y" }, ...as("none") });
  assert.equal(anon.status, 403);
});

// A card opened full page from Assigned or Past due links its breadcrumbs to
// its own board and opens its org's product list (card 805), so the view rows
// and a single card both say where the card lives, by id and slug.
test("views and GET /api/cards/:id say which org, product and board a card is on", { skip }, async () => {
  for (const view of ["assigned", "past-due"]) {
    const r = await call(A, api.cardViews.GET, `/api/cards/views?view=${view}&member_id=${A.member.id}`);
    const row = r.data.find((c) => c.id === A.card.id);
    assert.ok(row, `${view} lists A's card`);
    assert.equal(row.org_id, A.org.id, view);
    assert.equal(row.org_slug, A.org.slug, view);
    assert.equal(row.product_slug, A.product.slug, view);
    assert.equal(row.board_id, A.board.id, view);
  }
  const one = await call(A, api.card.GET, `/api/cards/${A.card.id}`, { id: A.card.id });
  assert.equal(one.data.org_id, A.org.id);
  assert.equal(one.data.org_name, A.org.name);
  assert.equal(one.data.product_emoji, A.product.emoji);
});
