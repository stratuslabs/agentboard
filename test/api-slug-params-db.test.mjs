// The list endpoints take slugs as well as ids: org=, product=, board= and
// column= beside org_id=, product_id=, board_id= and column_id=. A slug the
// caller typed fails loud (404 naming it, 400 when it's ambiguous or needs a
// parent) instead of a bare "product_id is required" or a silently ignored
// filter. Ids behave exactly as before.
//
//   AGENTBOARD_TEST_DATABASE_URL=postgres://... node --test test/
//
// Skipped without it. The handlers run in-process against a schema of their
// own, dropped at the end. Team B, selected per request by a test resolver,
// reuses team A's slugs to show a lookup never crosses teams.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire, register } from "node:module";

const require = createRequire(import.meta.url);
const URL_VAR = "AGENTBOARD_TEST_DATABASE_URL";
const url = process.env[URL_VAR];
const skip = url ? false : `set ${URL_VAR} to run`;
const SCHEMA = `slug_params_test_${process.pid}`;

let api;
let tenant;
let end;
let configure;
let getConfig;
const A = {};
const B = {};

async function call(team, handler, path, { method = "GET", body } = {}) {
  const { NextRequest } = api.next;
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-team": String(team.id) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handler(request);
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
const ids = (r) => r.data.map((x) => x.id).sort((a, b) => a - b);

async function ok(team, handler, path) {
  const r = await call(team, handler, path);
  assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.data)}`);
  return r;
}

async function fails(team, handler, path, status, pattern) {
  const r = await call(team, handler, path);
  assert.equal(r.status, status, `${path}: ${JSON.stringify(r.data)}`);
  assert.match(r.data.error, pattern, path);
}

/** An org with a product, its default boards and a card in two columns. */
async function seed(team, orgName, productName) {
  const org = await call(team, api.orgs.POST, "/api/orgs", { method: "POST", body: { name: orgName } });
  assert.equal(org.status, 201, JSON.stringify(org.data));
  const product = await call(team, api.products.POST, "/api/products", {
    method: "POST", body: { org_id: org.data.id, name: productName },
  });
  assert.equal(product.status, 201, JSON.stringify(product.data));
  const board = await call(team, api.board.GET, `/api/board?product_id=${product.data.id}`);
  const [first, second] = board.data.columns;
  const cards = [];
  for (const column of [first, second]) {
    const card = await call(team, api.cards.POST, "/api/cards", {
      method: "POST", body: { column_id: column.id, title: `${orgName} ${column.slug}` },
    });
    assert.equal(card.status, 201, JSON.stringify(card.data));
    cards.push(card.data);
  }
  return { org: org.data, product: product.data, boards: board.data.boards, board: board.data.boards[0], columns: [first, second], cards };
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
  ({ end } = require("../src/lib/sql.js"));
  const { db } = require("../src/lib/sql.js");
  await db.query(`CREATE SCHEMA ${SCHEMA}`);

  tenant = await import(new URL("../src/lib/tenant.ts", import.meta.url).href);
  api = {
    next: require("next/server.js"),
    orgs: await load("orgs"),
    products: await load("products"),
    board: await load("board"),
    boards: await load("boards"),
    columns: await load("columns"),
    cards: await load("cards"),
    fallback: await load("[[...path]]"),
    bySlug: await load("products/by-slug"),
  };
  ({ configure, getConfig } = await import(new URL("../src/configure.ts", import.meta.url).href));

  const selfHosted = await tenant.resolveTenant(new Request("http://localhost/"));
  A.id = selfHosted.teamId;
  B.id = (await db.query("INSERT INTO teams (name, slug) VALUES ('Team B', 'team-b') RETURNING id")).rows[0].id;
  const { ensureTeamDefaults } = require("../src/lib/tenancy.js");
  await ensureTeamDefaults((t, v) => db.query(t, v), B.id);
  tenant.setTenantResolver({
    fromRequest: async (request) => ({ teamId: Number(request.headers.get("x-test-team")), userId: 0 }),
  });

  // Team A: "general" in two orgs (ambiguous without org=), "solo" in one.
  A.labs = await seed(A, "Labs", "General");
  A.other = await seed(A, "Other", "General");
  A.solo = await seed(A, "Solo Org", "Solo");
  // Team B reuses A's org and product slugs, and has one A doesn't.
  B.labs = await seed(B, "Labs", "Solo");
  B.only = await seed(B, "Bravo Only", "Bravo");
});

after(async () => {
  if (skip || !end) return;
  tenant?.setTenantResolver(null);
  const { db } = require("../src/lib/sql.js");
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await end();
});

test("products?org= lists that org's products", { skip }, async () => {
  assert.deepEqual(ids(await ok(A, api.products.GET, "/api/products?org=labs")), [A.labs.product.id]);
  await fails(A, api.products.GET, "/api/products?org=nope", 404, /Organization 'nope' not found/);
  // Ids are unchanged: another team's or a missing org id is an empty list.
  assert.deepEqual((await ok(A, api.products.GET, `/api/products?org_id=${B.only.org.id}`)).data, []);
});

test("boards?product= takes a slug, with org= when the slug is in more than one org", { skip }, async () => {
  assert.deepEqual(ids(await ok(A, api.boards.GET, "/api/boards?product=solo")), A.solo.boards.map((b) => b.id).sort((a, b) => a - b));
  assert.deepEqual(ids(await ok(A, api.boards.GET, "/api/boards?org=other&product=general")), A.other.boards.map((b) => b.id).sort((a, b) => a - b));
  await fails(A, api.boards.GET, "/api/boards?product=general", 400, /'general' is in more than one organization \(labs, other\).*org=/);
  await fails(A, api.boards.GET, "/api/boards?product=genral", 404, /Product 'genral' not found/);
  await fails(A, api.boards.GET, "/api/boards?org=solo-org&product=general", 404, /Product 'general' not found in organization 'solo-org'/);
});

test("a slug where an id belongs says how to pass it", { skip }, async () => {
  await fails(A, api.boards.GET, "/api/boards?product_id=solo", 400, /product_id takes a numeric id.*product=solo/);
  await fails(A, api.columns.GET, "/api/columns?board_id=development", 400, /board_id takes a numeric id.*board=development/);
  await fails(A, api.cards.GET, "/api/cards?column_id=todo", 400, /column_id takes a numeric id.*column=todo/);
  await fails(A, api.boards.GET, `/api/boards?product_id=${A.solo.product.id}&product=solo`, 400, /product_id or product, not both/);
  // Digits that aren't a row id are refused up front, not sent to Postgres.
  await fails(A, api.cards.GET, "/api/cards?org_id=99999999999", 400, /Invalid id/);
  await fails(A, api.cards.GET, "/api/cards?board_id=0", 400, /Invalid id/);
});

test("columns?board= needs the product it's in", { skip }, async () => {
  const board = A.solo.board.slug;
  const r = await ok(A, api.columns.GET, `/api/columns?product=solo&board=${board}`);
  assert.ok(r.data.length > 0 && r.data.every((c) => c.board_id === A.solo.board.id));
  const byId = await ok(A, api.columns.GET, `/api/columns?product_id=${A.solo.product.id}&board=${board}`);
  assert.deepEqual(ids(byId), ids(r));
  await fails(A, api.columns.GET, `/api/columns?board=${board}`, 400, /board= needs product= or product_id/);
  await fails(A, api.columns.GET, "/api/columns?product=solo&board=nope", 404, /Board 'nope' not found in product 'solo'/);
});

test("board?product=&board= opens that board, and a typo is a 404, not the first board", { skip }, async () => {
  const second = A.solo.boards[1];
  assert.ok(second, "default boards include a second board");
  const r = await ok(A, api.board.GET, `/api/board?product=solo&board=${second.slug}`);
  assert.equal(r.data.active_board_id, second.id);
  await fails(A, api.board.GET, "/api/board?product=solo&board=nope", 404, /Board 'nope' not found/);
  // An unknown board id still falls back to the first board, as the UI relies on.
  const fallback = await ok(A, api.board.GET, `/api/board?product_id=${A.solo.product.id}&board_id=999999`);
  assert.equal(fallback.data.active_board_id, A.solo.board.id);
});

test("cards filter by org, product, board and column slugs", { skip }, async () => {
  const [todo] = A.solo.columns;
  const board = A.solo.board.slug;
  assert.deepEqual(ids(await ok(A, api.cards.GET, "/api/cards?org=solo-org")), ids({ data: A.solo.cards }));
  assert.deepEqual(ids(await ok(A, api.cards.GET, "/api/cards?org=labs&product=general")), ids({ data: A.labs.cards }));
  assert.deepEqual(ids(await ok(A, api.cards.GET, `/api/cards?product=solo&board=${board}`)), ids({ data: A.solo.cards }));
  assert.deepEqual(
    ids(await ok(A, api.cards.GET, `/api/cards?product=solo&board=${board}&column=${todo.slug}`)),
    [A.solo.cards[0].id],
  );
  await fails(A, api.cards.GET, `/api/cards?board=${board}`, 400, /board= needs product= or product_id/);
  await fails(A, api.cards.GET, `/api/cards?column=${todo.slug}`, 400, /column= needs board= or board_id/);
  await fails(A, api.cards.GET, `/api/cards?product=solo&board=${board}&column=nope`, 404, /Column 'nope' not found/);
});

test("slug lookups never cross teams", { skip }, async () => {
  // B has a "solo" product too, and its own "labs" org: neither makes A's lookup ambiguous or leaks.
  assert.deepEqual(ids(await ok(A, api.boards.GET, "/api/boards?product=solo")), A.solo.boards.map((b) => b.id).sort((a, b) => a - b));
  assert.deepEqual(ids(await ok(B, api.products.GET, "/api/products?org=labs")), [B.labs.product.id]);
  await fails(A, api.products.GET, "/api/products?org=bravo-only", 404, /not found/);
  await fails(A, api.boards.GET, "/api/boards?product=bravo", 404, /not found/);
  assert.ok(!ids(await ok(A, api.cards.GET, "/api/cards?org=labs")).some((id) => B.labs.cards.some((c) => c.id === id)));
});

// The unknown-path fallback resolves the team first, like every real route, so
// a consumer's resolver turns an unauthenticated caller away with its own 401
// on any path. Answering 404 before auth would tell a stranger which API
// routes exist.
test("an unknown /api path answers the resolver's 401 before its 404", { skip }, async () => {
  const { NextRequest } = api.next;
  const { TenantError } = tenant;
  const signedIn = tenant.tenantResolver().fromRequest;
  tenant.setTenantResolver({
    fromRequest: async (request) => {
      if (!request.headers.get("x-test-team")) throw new TenantError(401, "Unauthorized");
      return signedIn(request);
    },
  });
  try {
    for (const path of ["/api", "/api/tasks"]) {
      const anonymous = await api.fallback.GET(new NextRequest(`http://localhost${path}`));
      assert.equal(anonymous.status, 401, path);
      assert.deepEqual(await anonymous.json(), { error: "Unauthorized" }, path);
      const real = await api.orgs.GET(new NextRequest(`http://localhost/api/orgs`));
      assert.equal(real.status, 401, "a real route agrees");
    }
    const r = await call(A, api.fallback.POST, "/api/tasks", { method: "POST", body: {} });
    assert.equal(r.status, 404);
    assert.equal(r.data.error, "No API route for POST /api/tasks");
  } finally {
    tenant.setTenantResolver({ fromRequest: signedIn });
  }
});

// The board's breadcrumb links the org name to /<org> only when that path is
// the org's page. The browser can't tell for a slug the consuming app reserved
// with configure({ reservedOrgSlugs }), so the server says, with org_page.
test("products/by-slug says whether the org has an org page", { skip }, async () => {
  const { db } = require("../src/lib/sql.js");
  const legacy = await seed(A, "Legacy Account", "Ledger");
  const core = await seed(A, "Legacy Today", "Ledger");
  await db.query("UPDATE organizations SET slug = 'account' WHERE id = $1", [legacy.org.id]);
  await db.query("UPDATE organizations SET slug = 'today' WHERE id = $1", [core.org.id]);
  const page = async (org, product = "ledger") => (await ok(A, api.bySlug.GET, `/api/products/by-slug?org_slug=${org}&product_slug=${product}`)).data;

  const previous = getConfig();
  try {
    configure({ ...previous, orgPages: true, reservedOrgSlugs: ["account"] });
    assert.equal((await page("account")).org_page, false, "a consumer-reserved slug is the app's page, not the org's");
    assert.equal((await page("today")).org_page, false, "a core-reserved slug is the app's page");
    assert.equal((await page("solo-org", "solo")).org_page, true);
    assert.equal((await page("solo-org", "solo")).org_slug, "solo-org");

    configure({ ...previous, orgPages: true, reservedOrgSlugs: [] });
    assert.equal((await page("account")).org_page, true, "without the reservation /account is the org's page");

    // An app that hasn't mounted app/(board)/[orgSlug]/page has no org pages.
    configure({ ...previous, orgPages: false });
    assert.equal((await page("solo-org", "solo")).org_page, false, "no link to a route the app didn't mount");
  } finally {
    configure(previous);
  }
});
