// Who an agent is, through the real route handlers: registering an agent twice
// lands on one row, a header name never resolves to a person, a credential
// that names its agent decides attribution when a card is created, agent
// names stay unique per team, and a consumer can refuse a member type change.
//
//   AGENTBOARD_TEST_DATABASE_URL=postgres://... node --test test/
//
// Skipped without it. Runs in a schema of its own, dropped at the end.

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire, register } from "node:module";

const require = createRequire(import.meta.url);
const URL_VAR = "AGENTBOARD_TEST_DATABASE_URL";
const url = process.env[URL_VAR];
const skip = url ? false : `set ${URL_VAR} to run`;
const SCHEMA = `agent_identity_test_${process.pid}`;

let api;
let tenant;
let configure;
let db;
let end;
const A = {};
const B = {};

/**
 * Call a route handler as `team`. `member` stands in for a credential issued
 * to that agent (the hosted edition's per-agent API keys).
 */
async function call(team, handler, path, { method = "GET", body, id, headers = {}, member } = {}) {
  const { NextRequest } = api.next;
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-test-team": String(team.id),
      ...(member === undefined ? {} : { "x-test-member": String(member) }),
      ...headers,
    },
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

const resolver = {
  fromRequest: async (request) => {
    const member = request.headers.get("x-test-member");
    return {
      teamId: Number(request.headers.get("x-test-team")),
      userId: null,
      memberId: member === null ? null : Number(member),
    };
  },
};

async function newCard(team, extra = {}, opts = {}) {
  return call(team, api.cards.POST, "/api/cards", {
    method: "POST", body: { column_id: team.column.id, title: "work", ...extra }, ...opts,
  });
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

  tenant = await import(new URL("../src/lib/tenant.ts", import.meta.url).href);
  ({ configure } = await import(new URL("../src/configure.ts", import.meta.url).href));
  api = {
    next: require("next/server.js"),
    orgs: await load("orgs"),
    products: await load("products"),
    board: await load("board"),
    cards: await load("cards"),
    card: await load("cards/[id]"),
    members: await load("members"),
    member: await load("members/[id]"),
  };

  const selfHosted = await tenant.resolveTenant(new Request("http://localhost/"));
  A.id = selfHosted.teamId;
  B.id = (await db.query("INSERT INTO teams (name, slug) VALUES ('Team B', 'team-b') RETURNING id")).rows[0].id;
  const { ensureTeamDefaults } = require("../src/lib/tenancy.js");
  await ensureTeamDefaults((t, v) => db.query(t, v), B.id);
  configure({ tenant: resolver });

  for (const team of [A, B]) {
    const org = await call(team, api.orgs.POST, "/api/orgs", { method: "POST", body: { name: "Acme" } });
    const product = await call(team, api.products.POST, "/api/products", {
      method: "POST", body: { org_id: org.data.id, name: "Widget" },
    });
    const board = await call(team, api.board.GET, `/api/board?product_id=${product.data.id}`);
    team.column = board.data.columns[0];
  }
});

afterEach(() => {
  if (skip) return;
  configure({ tenant: resolver });
});

after(async () => {
  if (skip || !end) return;
  configure({});
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await end();
});

test("registering an agent twice lands on the row it already has, any case", { skip }, async () => {
  const first = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Scout", type: "agent" } });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const again = await call(A, api.members.POST, "/api/members", {
    method: "POST", body: { name: "scout", type: "agent", color: "#22C55E" },
  });
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(again.data.id, first.data.id);
  assert.equal(again.data.name, "Scout", "the registered name is kept");
  assert.equal(again.data.color, "#22C55E", "a re-registration can update the color");
  assert.equal(again.data.created, undefined, "no internal flag leaks into the response");

  // Another team's agent of the same name is its own.
  const other = await call(B, api.members.POST, "/api/members", { method: "POST", body: { name: "Scout", type: "agent" } });
  assert.equal(other.status, 201);
  assert.notEqual(other.data.id, first.data.id);
});

test("two people may share a name; each gets a row", { skip }, async () => {
  const one = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Alex" } });
  const two = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Alex" } });
  assert.equal(one.status, 201);
  assert.equal(two.status, 201);
  assert.notEqual(one.data.id, two.data.id);
});

test("X-Agent-Name finds the agent in any case and never a person", { skip }, async () => {
  const person = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Robin" } });
  const card = await newCard(A, {}, { headers: { "x-agent-name": "robin" } });
  assert.equal(card.status, 201, JSON.stringify(card.data));
  assert.notEqual(card.data.assignee_id, person.data.id, "a header name must not file work under a person");
  assert.equal(card.data.assignee_type, "agent");

  const again = await newCard(A, {}, { headers: { "x-agent-name": "ROBIN" } });
  assert.equal(again.data.assignee_id, card.data.assignee_id, "same agent, whatever the case");
});

test("concurrent first cards from one new agent register it once", { skip }, async () => {
  const cards = await Promise.all(
    Array.from({ length: 4 }, () => newCard(A, {}, { headers: { "x-agent-name": "Racer" } })),
  );
  for (const c of cards) assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.equal(new Set(cards.map((c) => c.data.assignee_id)).size, 1);
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS n FROM members WHERE team_id = $1 AND LOWER(name) = 'racer'", [A.id],
  );
  assert.equal(rows[0].n, 1);
});

test("a credential that names its agent decides who a new card is filed under", { skip }, async () => {
  const agent = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Keyholder", type: "agent" } });
  const someoneElse = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Other", type: "agent" } });

  const plain = await newCard(A, {}, { member: agent.data.id });
  assert.equal(plain.status, 201, JSON.stringify(plain.data));
  assert.equal(plain.data.assignee_id, agent.data.id);
  assert.equal(plain.data.assignee_name, "Keyholder");

  // The header is only a claim; the credential already answered.
  const claimed = await newCard(A, {}, { member: agent.data.id, headers: { "x-agent-name": "Impostor" } });
  assert.equal(claimed.data.assignee_id, agent.data.id);
  const { rows } = await db.query("SELECT 1 FROM members WHERE team_id = $1 AND name = 'Impostor'", [A.id]);
  assert.equal(rows.length, 0, "an ignored header registers nobody");

  // An explicit assignee is still an explicit choice.
  const explicit = await newCard(A, { assignee_id: someoneElse.data.id }, { member: agent.data.id });
  assert.equal(explicit.data.assignee_id, someoneElse.data.id);
});

test("updating a card never reassigns it from the credential", { skip }, async () => {
  const owner = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Owner", type: "agent" } });
  const mover = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Mover", type: "agent" } });
  const card = await newCard(A, { assignee_id: owner.data.id });

  const patched = await call(A, api.card.PATCH, `/api/cards/${card.data.id}`, {
    method: "PATCH", id: card.data.id, body: { priority: "high" }, member: mover.data.id,
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.equal(patched.data.assignee_id, owner.data.id);
});

test("a named assignee wins over the caller's credential and header", { skip }, async () => {
  const caller = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Caller", type: "agent" } });
  const named = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Named", type: "agent" } });

  // Hosted: a per-agent credential, and `--assignee Named` sent as text.
  const hosted = await newCard(A, { assignee: "named" }, { member: caller.data.id });
  assert.equal(hosted.status, 201, JSON.stringify(hosted.data));
  assert.equal(hosted.data.assignee_id, named.data.id, "the credential is a fallback, not an override");

  // Self-hosted: the CLI sends X-Agent-Name on every create.
  const selfHosted = await newCard(A, { assignee: "Named" }, { headers: { "x-agent-name": "Caller" } });
  assert.equal(selfHosted.data.assignee_id, named.data.id, "the header is a fallback, not an override");

  // A name that matches nobody isn't quietly filed under the caller instead.
  const unknown = await newCard(A, { assignee: "Nobody Here" }, { member: caller.data.id });
  assert.equal(unknown.status, 201, JSON.stringify(unknown.data));
  assert.equal(unknown.data.assignee_id, null);
  assert.equal(unknown.data.assignee, "Nobody Here");
});

test("a credentialed update ignores X-Agent-Name", { skip }, async () => {
  const owner = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Holder", type: "agent" } });
  const caller = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Patcher", type: "agent" } });
  const card = await newCard(A, { assignee_id: owner.data.id });

  const patched = await call(A, api.card.PATCH, `/api/cards/${card.data.id}`, {
    method: "PATCH", id: card.data.id, body: { priority: "low" },
    member: caller.data.id, headers: { "x-agent-name": "Claimant" },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.equal(patched.data.assignee_id, owner.data.id);
  const { rows } = await db.query("SELECT 1 FROM members WHERE team_id = $1 AND name = 'Claimant'", [A.id]);
  assert.equal(rows.length, 0, "an ignored header registers nobody");
});

test("re-registering an agent keeps a color it didn't send", { skip }, async () => {
  const first = await call(A, api.members.POST, "/api/members", {
    method: "POST", body: { name: "Painter", type: "agent", color: "#EF4444" },
  });
  const again = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Painter", type: "agent" } });
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(again.data.id, first.data.id);
  assert.equal(again.data.color, "#EF4444");
});

test("re-registering an agent with a new look puts its cards in the next delta", { skip }, async () => {
  const agent = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Restyled", type: "agent" } });
  const card = await newCard(A, { assignee_id: agent.data.id });
  await db.query("UPDATE cards SET updated_at = NOW() - INTERVAL '1 hour' WHERE id = $1", [card.data.id]);

  // Same look: nothing a client renders changed, so nothing is stamped.
  await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Restyled", type: "agent" } });
  let { rows } = await db.query("SELECT updated_at < NOW() - INTERVAL '30 minutes' AS stale FROM cards WHERE id = $1", [card.data.id]);
  assert.equal(rows[0].stale, true, "an unchanged re-registration leaves cards alone");

  await call(A, api.members.POST, "/api/members", {
    method: "POST", body: { name: "Restyled", type: "agent", color: "#3B82F6" },
  });
  ({ rows } = await db.query("SELECT updated_at > NOW() - INTERVAL '1 minute' AS fresh FROM cards WHERE id = $1", [card.data.id]));
  assert.equal(rows[0].fresh, true, "cards showing the member are stamped");
});

test("a credential naming another team's member is refused, not trusted", { skip }, async () => {
  const foreign = await call(B, api.members.POST, "/api/members", { method: "POST", body: { name: "Foreign", type: "agent" } });
  const card = await newCard(A, {}, { member: foreign.data.id });
  assert.equal(card.status, 404, JSON.stringify(card.data));
});

test("an agent can't be renamed onto another agent's name", { skip }, async () => {
  await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Taken", type: "agent" } });
  const mine = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Mine", type: "agent" } });
  const renamed = await call(A, api.member.PATCH, `/api/members/${mine.data.id}`, {
    method: "PATCH", id: mine.data.id, body: { name: "TAKEN" },
  });
  assert.equal(renamed.status, 409, JSON.stringify(renamed.data));
  assert.match(renamed.data.error, /already uses that name/);
  const { rows } = await db.query("SELECT name FROM members WHERE id = $1", [mine.data.id]);
  assert.equal(rows[0].name, "Mine");

  // The pool still answers afterwards.
  const ok = await call(A, api.member.PATCH, `/api/members/${mine.data.id}`, {
    method: "PATCH", id: mine.data.id, body: { name: "Mine Too" },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
});

test("a consumer can refuse a member type change", { skip }, async () => {
  const agent = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Guarded", type: "agent" } });
  const seen = [];
  configure({
    tenant: resolver,
    members: {
      beforeTypeChange: async (change) => {
        seen.push(change);
        throw new tenant.TenantError(409, "This agent has API keys.");
      },
    },
  });
  const refused = await call(A, api.member.PATCH, `/api/members/${agent.data.id}`, {
    method: "PATCH", id: agent.data.id, body: { type: "human", name: "Renamed" },
  });
  assert.equal(refused.status, 409, JSON.stringify(refused.data));
  assert.equal(refused.data.error, "This agent has API keys.");
  assert.deepEqual(seen, [{ teamId: A.id, memberId: agent.data.id, from: "agent", to: "human" }]);
  const { rows } = await db.query("SELECT name, type FROM members WHERE id = $1", [agent.data.id]);
  assert.deepEqual(rows[0], { name: "Guarded", type: "agent" }, "nothing changed");

  // Not called when the type stays the same.
  seen.length = 0;
  const color = await call(A, api.member.PATCH, `/api/members/${agent.data.id}`, {
    method: "PATCH", id: agent.data.id, body: { color: "#000000", type: "agent" },
  });
  assert.equal(color.status, 200);
  assert.equal(seen.length, 0);

  // Without a hook the change goes through.
  configure({ tenant: resolver });
  const allowed = await call(A, api.member.PATCH, `/api/members/${agent.data.id}`, {
    method: "PATCH", id: agent.data.id, body: { type: "human" },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.data.type, "human");
});

test("the migration renames existing duplicate agents instead of failing", { skip }, async () => {
  const { AGENT_NAME_MIGRATION } = require("../src/lib/agent-names.js");
  await db.query("DROP INDEX members_team_agent_name_key");
  const ids = [];
  for (const name of ["Dup", "dup", "Dup", "Dup (0)"]) {
    const { rows } = await db.query(
      "INSERT INTO members (team_id, name, type) VALUES ($1, $2, 'agent') RETURNING id", [B.id, name],
    );
    ids.push(rows[0].id);
  }
  // A person called Dup is not an agent and keeps the name.
  const { rows: human } = await db.query(
    "INSERT INTO members (team_id, name, type) VALUES ($1, 'Dup', 'human') RETURNING id", [B.id],
  );
  // A free-looking candidate that is already taken.
  await db.query(
    "UPDATE members SET name = $2 WHERE id = $1", [ids[3], `Dup (${ids[1]})`],
  );

  await db.query(AGENT_NAME_MIGRATION);
  await db.query(AGENT_NAME_MIGRATION); // and again: nothing left to do

  const { rows } = await db.query("SELECT id, name FROM members WHERE id = ANY($1) ORDER BY id", [[...ids, human[0].id]]);
  const names = Object.fromEntries(rows.map((r) => [r.id, r.name]));
  assert.equal(names[ids[0]], "Dup", "the oldest keeps its name");
  assert.equal(names[ids[1]], `dup (${ids[1]}-1)`, "a taken candidate is skipped");
  assert.equal(names[ids[2]], `Dup (${ids[2]})`);
  assert.equal(names[human[0].id], "Dup");
  const { rows: idx } = await db.query(
    "SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = 'members_team_agent_name_key'", [SCHEMA],
  );
  assert.equal(idx.length, 1);
});

// Card 838: assignee (text) and assignee_id (member) must never name two
// different people. Card 699 read assignee "Nova" and assignee_id Blair.

/** Text and member never both set, and the text never names another member. */
function assertAgree(card, label) {
  assert.ok(card.assignee_id === null || card.assignee === null,
    `${label}: assignee ${JSON.stringify(card.assignee)} beside assignee_id ${card.assignee_id} (${card.assignee_name})`);
}

async function patch(team, id, body, opts = {}) {
  return call(team, api.card.PATCH, `/api/cards/${id}`, { method: "PATCH", id, body, ...opts });
}

test("assigning by id replaces a name the card had (card 838)", { skip }, async () => {
  const nova = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Nova838", type: "agent" } });
  const blair = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Blair838", type: "agent" } });

  const card = await newCard(A, { assignee: "Nova838" });
  assert.equal(card.data.assignee_id, nova.data.id);
  assertAgree(card.data, "create by name");

  const moved = await patch(A, card.data.id, { assignee_id: blair.data.id });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal(moved.data.assignee_id, blair.data.id);
  assert.equal(moved.data.assignee_name, "Blair838");
  assertAgree(moved.data, "patch by id");
});

test("assigning a name that matches nobody doesn't leave the old member", { skip }, async () => {
  const owner = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Holder838", type: "agent" } });
  const card = await newCard(A, { assignee_id: owner.data.id });

  const renamed = await patch(A, card.data.id, { assignee: "Pat Outside" });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal(renamed.data.assignee, "Pat Outside");
  assert.equal(renamed.data.assignee_id, null, "the old member must not stay beside a new name");
});

test("assigning by name on update stores the member", { skip }, async () => {
  const named = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Target838", type: "agent" } });
  const card = await newCard(A, { assignee: "Pat Outside" });
  assert.equal(card.data.assignee_id, null);

  const assigned = await patch(A, card.data.id, { assignee: "target838" });
  assert.equal(assigned.data.assignee_id, named.data.id);
  assertAgree(assigned.data, "patch by name");
});

test("unassigning clears both fields, by name or by id", { skip }, async () => {
  const owner = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Leaver838", type: "agent" } });

  const byName = await newCard(A, { assignee_id: owner.data.id });
  const clearedByName = await patch(A, byName.data.id, { assignee: "" });
  assert.equal(clearedByName.data.assignee_id, null, "an empty name unassigns the member too");
  assert.equal(clearedByName.data.assignee, null);

  // A text-only assignee would otherwise still show after the id is cleared.
  const outside = await newCard(A, { assignee: "Pat Outside" });
  const clearedById = await patch(A, outside.data.id, { assignee_id: null });
  assert.equal(clearedById.data.assignee_id, null);
  assert.equal(clearedById.data.assignee, null, "unassigning must not leave the old name showing");
});

test("an update with X-Agent-Name that claims a card drops its old name", { skip }, async () => {
  const card = await newCard(A, { assignee: "Pat Outside" });
  const claimed = await patch(A, card.data.id, { priority: "high" }, { headers: { "x-agent-name": "Claimer838" } });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
  assert.equal(claimed.data.assignee_name, "Claimer838");
  assertAgree(claimed.data, "header claim");
});

test("filtering by assignee name follows the member, not a stale name", { skip }, async () => {
  const nova = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Stale838", type: "agent" } });
  const blair = await call(A, api.members.POST, "/api/members", { method: "POST", body: { name: "Fresh838", type: "agent" } });
  const card = await newCard(A, { assignee_id: blair.data.id });
  // A row written before this fix: text naming one member, id another.
  await db.query("UPDATE cards SET assignee = 'Stale838' WHERE id = $1", [card.data.id]);
  assert.ok(nova.data.id);

  const ids = async (name) => (await call(A, api.cards.GET, `/api/cards?assignee=${name}`)).data.map((c) => c.id);
  assert.ok((await ids("Fresh838")).includes(card.data.id));
  assert.ok(!(await ids("Stale838")).includes(card.data.id), "a card filed under Fresh838 isn't Stale838's");

  // A text-only assignee is still found by its name.
  const outside = await newCard(A, { assignee: "Pat Filter838" });
  assert.ok((await ids("Pat%20Filter838")).includes(outside.data.id));
});
