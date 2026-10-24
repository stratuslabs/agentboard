// Tenancy against a real Postgres: the migration moves an existing install
// into one default team without changing its keys or card numbers, is safe to
// run again, and makes names, settings and product keys unique per team
// instead of per instance.
//
//   AGENTBOARD_TEST_DATABASE_URL=postgres://... node --test test/
//
// Skipped without it. Each test schema is dropped at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { TENANCY_MIGRATION, ensureDefaultTeam } from "../src/lib/tenancy.js";
import {
  CARD_NUMBER_MIGRATION,
  ensureProductKeys,
  changeProductKey,
  keyForNewProduct,
  createProductWithKey,
  resolveCardRef,
} from "../src/lib/card-keys.js";

const require = createRequire(import.meta.url);
const URL_VAR = "AGENTBOARD_TEST_DATABASE_URL";
const url = process.env[URL_VAR];
const skip = url ? false : `set ${URL_VAR} to run`;
const UPGRADE = `tenancy_up_${process.pid}`;
const FRESH = `tenancy_fresh_${process.pid}`;

/** @type {import('pg').Pool} */
let pool;

/** A query function whose statements all run in `schema`. */
function inSchema(schema) {
  return async (/** @type {string} */ text, /** @type {unknown[]} */ values) => {
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${schema}`);
      const result = await client.query(text, values);
      client.release();
      return result;
    } catch (err) {
      // Discarded, not reused: pglite-socket desyncs a client after an error.
      client.release(true);
      throw err;
    }
  };
}

// The tables as current main creates them, before tenancy, including the
// per-instance product keys from #602. Trimmed to the columns that matter.
const PRE_TENANCY = `
  CREATE TABLE organizations (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE, position INTEGER DEFAULT 0
  );
  CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL, slug TEXT NOT NULL, UNIQUE(org_id, slug)
  );
  CREATE TABLE boards (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name TEXT NOT NULL, slug TEXT NOT NULL
  );
  CREATE TABLE columns (
    id SERIAL PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL, slug TEXT NOT NULL
  );
  CREATE TABLE cards (
    id SERIAL PRIMARY KEY,
    column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE members (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'human'
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE user_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  -- As #602 left them: keys unique per instance.
  ALTER TABLE products ADD COLUMN key TEXT;
  ALTER TABLE products ADD COLUMN card_seq INTEGER NOT NULL DEFAULT 0;
  CREATE UNIQUE INDEX products_key_idx ON products (key);
  CREATE TABLE product_keys (
    key TEXT PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL
  );
`;

/** Ids the tests use, filled in by `before`. */
const ids = {};
const up = (/** @type {string} */ t, /** @type {unknown[]} */ v) => inSchema(UPGRADE)(t, v);
const fresh = (/** @type {string} */ t, /** @type {unknown[]} */ v) => inSchema(FRESH)(t, v);

async function migrate(query) {
  await query(TENANCY_MIGRATION);
  await query(CARD_NUMBER_MIGRATION);
  await ensureProductKeys(query);
}

/** A product with one board and column in `orgId`. */
async function addProduct(query, orgId, name, slug, key = null) {
  const product = (await query(
    "INSERT INTO products (org_id, name, slug, key) VALUES ($1, $2, $3, $4) RETURNING id, key",
    [orgId, name, slug, key]
  )).rows[0];
  const board = (await query("INSERT INTO boards (product_id, name, slug) VALUES ($1, 'Dev', 'dev') RETURNING id", [product.id])).rows[0];
  const column = (await query("INSERT INTO columns (board_id, name, slug) VALUES ($1, 'Todo', 'todo') RETURNING id", [board.id])).rows[0];
  return { id: product.id, key: product.key, column: column.id };
}

before(async () => {
  if (skip) return;
  const { Pool } = require("pg");
  pool = new Pool({ connectionString: url, max: Number(process.env.TEST_POOL_MAX || 10) });
  await up(`CREATE SCHEMA ${UPGRADE}`);
  await up(PRE_TENANCY);
  await fresh(`CREATE SCHEMA ${FRESH}`);
  await fresh(PRE_TENANCY.replace("CREATE UNIQUE INDEX products_key_idx ON products (key);", "")
    .replace(/CREATE TABLE product_keys \([^;]*\);/, ""));

  // An existing install: an org, a product with a key and a deleted
  // product's tombstone, cards, a member, settings and preferences.
  const org = (await up("INSERT INTO organizations (name, slug) VALUES ('Acme', 'acme') RETURNING id")).rows[0];
  ids.org = org.id;
  ids.ab = await addProduct(up, org.id, "AgentBoard", "agentboard", "AB");
  await up("INSERT INTO product_keys (key, product_id) VALUES ('AB', $1), ('OLD', NULL)", [ids.ab.id]);
  await up("INSERT INTO members (name, type) VALUES ('Remy', 'agent')");
  await up("INSERT INTO settings (key, value) VALUES ('default_boards', '[\"Development\"]')");
  await up("INSERT INTO user_preferences (key, value) VALUES ('profileMemberId', '1')");
});

after(async () => {
  if (skip || !pool) return;
  await up(`DROP SCHEMA ${UPGRADE} CASCADE`);
  await fresh(`DROP SCHEMA ${FRESH} CASCADE`);
  await pool.end();
});

test("upgrade: an existing install moves into one default team, keys and numbers unchanged", { skip }, async () => {
  await migrate(up);
  // Cards created by the new trigger after migration, then checked below.
  ids.card1 = (await up("INSERT INTO cards (column_id, title) VALUES ($1, 'one') RETURNING id, number", [ids.ab.column])).rows[0];

  const { rows: teams } = await up("SELECT id, slug FROM teams");
  assert.equal(teams.length, 1);
  assert.equal(teams[0].slug, "default");
  ids.teamA = teams[0].id;

  for (const table of ["organizations", "members", "settings", "user_preferences"]) {
    const { rows } = await up(`SELECT DISTINCT team_id FROM ${table}`);
    assert.deepEqual(rows, [{ team_id: ids.teamA }], `${table} rows are in the default team`);
    const { rows: col } = await up(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = 'team_id'",
      [UPGRADE, table]
    );
    assert.equal(col[0].is_nullable, "NO", `${table}.team_id is NOT NULL`);
  }

  const { rows: keys } = await up("SELECT team_id, key, product_id FROM product_keys ORDER BY key");
  assert.deepEqual(keys, [
    { team_id: ids.teamA, key: "AB", product_id: ids.ab.id },
    { team_id: ids.teamA, key: "OLD", product_id: null },
  ], "keys and the tombstone keep their meaning, in the default team");
  const { rows: idx } = await up("SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = 'products_key_idx'", [UPGRADE]);
  assert.equal(idx.length, 0, "the per-instance key index is gone");
  assert.equal(ids.card1.number, 1);
  assert.equal(await resolveCardRef(up, ids.teamA, "AB-1"), ids.card1.id);
  assert.equal(await ensureDefaultTeam(up), ids.teamA, "the backfill team is the self-hosted team");
});

test("running the migrations again changes nothing", { skip }, async () => {
  const snapshot = async () => ({
    teams: (await up("SELECT * FROM teams ORDER BY id")).rows,
    orgs: (await up("SELECT id, team_id, slug FROM organizations ORDER BY id")).rows,
    keys: (await up("SELECT * FROM product_keys ORDER BY team_id, key")).rows,
    constraints: (await up(
      `SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE connamespace = $1::regnamespace ORDER BY 1, 2`,
      [UPGRADE]
    )).rows,
  });
  const first = await snapshot();
  await migrate(up);
  assert.deepEqual(await snapshot(), first);
});

test("fresh install: no team until the app asks for one, then exactly one", { skip }, async () => {
  await migrate(fresh);
  assert.equal((await fresh("SELECT COUNT(*)::int AS n FROM teams")).rows[0].n, 0);
  const id = await ensureDefaultTeam(fresh);
  assert.equal(await ensureDefaultTeam(fresh), id);
  assert.equal((await fresh("SELECT COUNT(*)::int AS n FROM teams")).rows[0].n, 1);
  await assert.rejects(
    fresh("INSERT INTO organizations (name, slug) VALUES ('NoTeam', 'noteam')"),
    (err) => err.code === "23502",
    "an organization must have a team"
  );
});

test("names, settings and preferences are unique per team, not per instance", { skip }, async () => {
  ids.teamB = (await up("INSERT INTO teams (name, slug) VALUES ('Other', 'other') RETURNING id")).rows[0].id;
  const orgB = (await up(
    "INSERT INTO organizations (team_id, name, slug) VALUES ($1, 'Acme', 'acme') RETURNING id",
    [ids.teamB]
  )).rows[0];
  ids.orgB = orgB.id;
  await assert.rejects(
    up("INSERT INTO organizations (team_id, name, slug) VALUES ($1, 'Acme', 'acme-2')", [ids.teamA]),
    (err) => err.code === "23505",
    "but not twice in one team"
  );
  await assert.rejects(
    up("INSERT INTO organizations (team_id, name, slug) VALUES ($1, 'Acme Two', 'acme')", [ids.teamA]),
    (err) => err.code === "23505"
  );
  await up("INSERT INTO settings (team_id, key, value) VALUES ($1, 'default_boards', '[\"Sales\"]')", [ids.teamB]);
  await up("INSERT INTO user_preferences (team_id, key, value) VALUES ($1, 'profileMemberId', '9')", [ids.teamB]);
  const { rows } = await up("SELECT team_id, value FROM settings WHERE key = 'default_boards' ORDER BY team_id");
  assert.deepEqual(rows, [
    { team_id: ids.teamA, value: '["Development"]' },
    { team_id: ids.teamB, value: '["Sales"]' },
  ]);
});

test("product keys are per team: both teams can have AB, and refs never cross teams", { skip }, async () => {
  const derived = await keyForNewProduct(up, ids.teamB, "AgentBoard", undefined);
  assert.deepEqual(derived, { key: "AB" }, "team A's AB doesn't make team B's AB2");
  assert.deepEqual(await keyForNewProduct(up, ids.teamB, "Whatever", "OLD"), { key: "OLD" }, "nor does A's tombstone");

  const insert = async (/** @type {string} */ key) =>
    (await up("INSERT INTO products (org_id, name, slug, key) VALUES ($1, 'AgentBoard', 'agentboard', $2) RETURNING *", [ids.orgB, key])).rows[0];
  const created = await createProductWithKey(up, ids.teamB, "AgentBoard", undefined, insert);
  assert.equal(created.key, "AB");
  const board = (await up("INSERT INTO boards (product_id, name, slug) VALUES ($1, 'Dev', 'dev') RETURNING id", [created.product.id])).rows[0];
  const column = (await up("INSERT INTO columns (board_id, name, slug) VALUES ($1, 'Todo', 'todo') RETURNING id", [board.id])).rows[0];
  const cardB = (await up("INSERT INTO cards (column_id, title) VALUES ($1, 'b one') RETURNING id, number", [column.id])).rows[0];
  assert.equal(cardB.number, 1);

  assert.equal(await resolveCardRef(up, ids.teamA, "AB-1"), ids.card1.id);
  assert.equal(await resolveCardRef(up, ids.teamB, "AB-1"), cardB.id);
  assert.equal(await resolveCardRef(up, ids.teamB, String(ids.card1.id)), null, "team A's card id is nothing to team B");
  assert.equal(await resolveCardRef(up, ids.teamA, String(cardB.id)), null);
  assert.equal(await resolveCardRef(up, ids.teamA, String(ids.card1.id)), ids.card1.id);

  // Within a team a key still means one product, whoever writes.
  const other = (await up("INSERT INTO products (org_id, name, slug) VALUES ($1, 'Ops', 'ops') RETURNING id", [ids.orgB])).rows[0];
  assert.equal((await changeProductKey(up, other.id, "AB")).status, 409);
  assert.equal((await keyForNewProduct(up, ids.teamB, "X", "AB")).status, 409);
  await assert.rejects(
    up("UPDATE products SET key = 'AB' WHERE id = $1", [other.id]),
    (err) => err.code === "23505" && err.constraint === "product_keys_pkey"
  );
  // And a key one team has is free in the other.
  assert.equal((await changeProductKey(up, other.id, "OLD")).product.key, "OLD");
});

test("ensureProductKeys derives keys per team", { skip }, async () => {
  // Team A already has MAR; team B's Marketing still gets MAR, not MAR2.
  await up("INSERT INTO products (org_id, name, slug, key) VALUES ($1, 'Marketing', 'marketing', 'MAR')", [ids.org]);
  const p = (await up("INSERT INTO products (org_id, name, slug) VALUES ($1, 'AgentBoard', 'agentboard-2') RETURNING id", [ids.org])).rows[0];
  const q = (await up("INSERT INTO products (org_id, name, slug) VALUES ($1, 'Marketing', 'marketing') RETURNING id", [ids.orgB])).rows[0];
  await ensureProductKeys(up);
  const { rows } = await up("SELECT id, key FROM products WHERE id = ANY($1) ORDER BY id", [[p.id, q.id]]);
  assert.deepEqual(rows, [{ id: p.id, key: "AB2" }, { id: q.id, key: "MAR" }]);
});

test("deleting a team removes its board data and nothing else", { skip }, async () => {
  await up("DELETE FROM teams WHERE id = $1", [ids.teamB]);
  for (const table of ["organizations", "settings", "user_preferences", "product_keys"]) {
    const { rows } = await up(`SELECT COUNT(*)::int AS n FROM ${table} WHERE team_id = $1`, [ids.teamB]);
    assert.equal(rows[0].n, 0, `${table} is cleared`);
  }
  assert.equal(await resolveCardRef(up, ids.teamA, "AB-1"), ids.card1.id);
});

// Two instances starting at once on a fresh database. Needs two real
// connections, so not against pglite-socket.
const concurrent = skip || (Number(process.env.TEST_POOL_MAX || 10) < 2 ? "needs two connections" : false);
test("two instances migrating at once both succeed", { skip: concurrent }, async () => {
  const schema = `tenancy_race_${process.pid}`;
  const race = inSchema(schema);
  await race(`CREATE SCHEMA ${schema}`);
  try {
    await race(PRE_TENANCY);
    await race("INSERT INTO organizations (name, slug) VALUES ('Acme', 'acme')");
    await Promise.all([migrate(race), migrate(race)]);
    const { rows } = await race("SELECT COUNT(*)::int AS n FROM teams");
    assert.equal(rows[0].n, 1);
  } finally {
    await race(`DROP SCHEMA ${schema} CASCADE`);
  }
});
