// Per-product card numbers against a real Postgres: the migration backfills
// existing cards, the trigger numbers new and moved cards, concurrent creates
// never share a number, and KEY-N resolves through moves and key changes.
//
// Needs a throwaway database:
//
//   AGENTBOARD_TEST_DATABASE_URL=postgres://... node --test test/
//
// Skipped without it. Everything happens in a schema of its own, dropped at
// the end, so it never touches the tables of the database it is pointed at.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  CARD_NUMBER_MIGRATION,
  ensureProductKeys,
  changeProductKey,
  keyForNewProduct,
  resolveCardRef,
} from "../src/lib/card-keys.js";
import { updateProduct } from "../src/lib/product-update.js";

const require = createRequire(import.meta.url);
const URL_VAR = "AGENTBOARD_TEST_DATABASE_URL";
const url = process.env[URL_VAR];
const skip = url ? false : `set ${URL_VAR} to run`;
const SCHEMA = `card_keys_test_${process.pid}`;

/** @type {import('pg').Pool} */
let pool;
/** Clients that have been pointed at the test schema. */
const scoped = new WeakSet();
/**
 * Every query runs in the test schema. Set per client rather than with a
 * startup option, which pglite-socket ignores.
 * @param {string} text @param {unknown[]} [values]
 */
async function query(text, values) {
  const client = await pool.connect();
  try {
    if (!scoped.has(client)) {
      await client.query(`SET search_path TO ${SCHEMA}`);
      scoped.add(client);
    }
    const result = await client.query(text, values);
    client.release();
    return result;
  } catch (err) {
    // Like pool.query: a client that errored is discarded, not reused.
    client.release(true);
    throw err;
  }
}

/** A connection of its own, for a transaction. Release it when done. */
async function scopedClient() {
  const client = await pool.connect();
  await client.query(`SET search_path TO ${SCHEMA}`);
  scoped.add(client);
  return client;
}

async function withScoped(fn) {
  const client = await scopedClient();
  try {
    return await fn(client);
  } finally {
    client.release(true);
  }
}

// The tables as they were before card numbers, trimmed to what matters here.
const BASE_SCHEMA = `
  CREATE TABLE organizations (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE);
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
`;

/** Ids of what the tests use, filled in by `before`. */
const ids = {};

async function insertCard(columnId, title, createdAt) {
  const { rows } = createdAt
    ? await query("INSERT INTO cards (column_id, title, created_at) VALUES ($1, $2, $3) RETURNING *", [columnId, title, createdAt])
    : await query("INSERT INTO cards (column_id, title) VALUES ($1, $2) RETURNING *", [columnId, title]);
  return rows[0];
}

async function numberOf(cardId) {
  const { rows } = await query("SELECT number FROM cards WHERE id = $1", [cardId]);
  return rows[0].number;
}

before(async () => {
  if (skip) return;
  const { Pool } = require("pg");
  // Max 1 against pglite-socket, which crosses results between connections.
  pool = new Pool({ connectionString: url, max: Number(process.env.TEST_POOL_MAX || 10) });
  await query(`CREATE SCHEMA ${SCHEMA}`);
  await query(BASE_SCHEMA);

  const org = (await query("INSERT INTO organizations (name, slug) VALUES ('Acme', 'acme') RETURNING id")).rows[0];
  for (const [name, slug] of [["AgentBoard", "agentboard"], ["Agent Builder", "agent-builder"], ["Ops", "ops"]]) {
    const product = (await query("INSERT INTO products (org_id, name, slug) VALUES ($1, $2, $3) RETURNING id", [org.id, name, slug])).rows[0];
    const board = (await query("INSERT INTO boards (product_id, name, slug) VALUES ($1, 'Dev', 'dev') RETURNING id", [product.id])).rows[0];
    const column = (await query("INSERT INTO columns (board_id, name, slug) VALUES ($1, 'Todo', 'todo') RETURNING id", [board.id])).rows[0];
    ids[slug] = { product: product.id, column: column.id };
  }

  // Existing cards, inserted out of creation order and interleaved across
  // products, so the backfill has to sort them.
  ids.oldB = await insertCard(ids.agentboard.column, "second", "2026-01-02");
  ids.oldX = await insertCard(ids["agent-builder"].column, "builder first", "2026-01-01");
  ids.oldA = await insertCard(ids.agentboard.column, "first", "2026-01-01");
  ids.oldC = await insertCard(ids.agentboard.column, "third", "2026-01-03");
});

after(async () => {
  if (skip || !pool) return;
  await query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await pool.end();
});

test("the migration numbers existing cards per product in creation order and gives products keys", { skip }, async () => {
  await query(CARD_NUMBER_MIGRATION);
  await ensureProductKeys(query);

  assert.equal(await numberOf(ids.oldA.id), 1);
  assert.equal(await numberOf(ids.oldB.id), 2);
  assert.equal(await numberOf(ids.oldC.id), 3);
  assert.equal(await numberOf(ids.oldX.id), 1);

  const { rows } = await query("SELECT slug, key, card_seq FROM products ORDER BY id");
  assert.deepEqual(rows, [
    { slug: "agentboard", key: "AB", card_seq: 3 },
    { slug: "agent-builder", key: "AB2", card_seq: 1 },
    { slug: "ops", key: "OPS", card_seq: 0 },
  ]);
});

test("running the migration again changes nothing", { skip }, async () => {
  const snapshot = async () =>
    (await query("SELECT * FROM card_numbers ORDER BY product_id, number")).rows;
  const beforeRows = await snapshot();
  await query(CARD_NUMBER_MIGRATION);
  await ensureProductKeys(query);
  assert.deepEqual(await snapshot(), beforeRows);
  const { rows } = await query("SELECT key, card_seq FROM products WHERE id = $1", [ids.agentboard.product]);
  assert.deepEqual(rows[0], { key: "AB", card_seq: 3 });
});

test("a new card gets its product's next number, visible in RETURNING", { skip }, async () => {
  const card = await insertCard(ids.agentboard.column, "new");
  assert.equal(card.number, 4);
  const other = await insertCard(ids.ops.column, "ops first");
  assert.equal(other.number, 1);
});

test("concurrent creates in one product never share a number", { skip }, async () => {
  const { rows: seq } = await query("SELECT card_seq FROM products WHERE id = $1", [ids.agentboard.product]);
  const start = seq[0].card_seq;
  const cards = await Promise.all(
    Array.from({ length: 40 }, (_, i) => insertCard(ids.agentboard.column, `burst ${i}`))
  );
  const numbers = cards.map((c) => c.number).sort((a, b) => a - b);
  assert.equal(new Set(numbers).size, 40, "numbers are unique");
  assert.deepEqual(numbers, Array.from({ length: 40 }, (_, i) => start + 1 + i), "and contiguous");
});

test("KEY-N resolves in any case; numeric ids still work; unknown refs are null", { skip }, async () => {
  assert.equal(await resolveCardRef(query, "AB-1"), ids.oldA.id);
  assert.equal(await resolveCardRef(query, "ab-3"), ids.oldC.id);
  assert.equal(await resolveCardRef(query, "AB2-1"), ids.oldX.id);
  assert.equal(await resolveCardRef(query, String(ids.oldB.id)), ids.oldB.id);
  assert.equal(await resolveCardRef(query, "AB-9999"), null);
  assert.equal(await resolveCardRef(query, "ZZ-1"), null);
  assert.equal(await resolveCardRef(query, "AB-1; DROP TABLE cards"), null);
});

test("a moved card gets a number in its new product, and its old key still finds it", { skip }, async () => {
  const card = ids.oldB; // AB-2
  await query("UPDATE cards SET column_id = $1 WHERE id = $2", [ids.ops.column, card.id]);
  assert.equal(await numberOf(card.id), 2, "OPS-2: ops already had one card");
  assert.equal(await resolveCardRef(query, "OPS-2"), card.id);
  assert.equal(await resolveCardRef(query, "AB-2"), card.id, "old key redirects");

  await query("UPDATE cards SET column_id = $1 WHERE id = $2", [ids.agentboard.column, card.id]);
  assert.equal(await numberOf(card.id), 2, "moving back restores AB-2");
  const { rows } = await query("SELECT card_seq FROM products WHERE id = $1", [ids.agentboard.product]);
  const { rows: count } = await query("SELECT COUNT(*)::int AS n FROM card_numbers WHERE product_id = $1", [ids.agentboard.product]);
  assert.equal(rows[0].card_seq, count[0].n, "no number was spent on the way back");
});

test("updating other fields or the same column keeps the number", { skip }, async () => {
  await query("UPDATE cards SET title = 'renamed' WHERE id = $1", [ids.oldC.id]);
  await query("UPDATE cards SET column_id = column_id WHERE id = $1", [ids.oldC.id]);
  assert.equal(await numberOf(ids.oldC.id), 3);
});

test("a changed key keeps the old one as an alias", { skip }, async () => {
  const result = await changeProductKey(query, ids.agentboard.product, "agb");
  assert.equal(result.product.key, "AGB");
  assert.equal(await resolveCardRef(query, "AGB-1"), ids.oldA.id);
  assert.equal(await resolveCardRef(query, "AB-1"), ids.oldA.id, "old key still resolves");

  // Nobody else can take the alias, or a key in use.
  assert.deepEqual(await changeProductKey(query, ids.ops.product, "AB"), {
    error: "Key AB is already used by another product",
    status: 409,
  });
  assert.equal((await changeProductKey(query, ids.ops.product, "AB2")).status, 409);
  assert.equal((await keyForNewProduct(query, "Whatever", "ab")).status, 409);
  assert.equal((await keyForNewProduct(query, "AgentBoard", undefined)).key, "AB3");
  assert.equal((await changeProductKey(query, ids.ops.product, "x")).status, 400);
  assert.equal((await changeProductKey(query, 999999, "NEW")).status, 404);
  const { rows } = await query("SELECT key FROM products WHERE id = $1", [ids.ops.product]);
  assert.equal(rows[0].key, "OPS", "failed changes changed nothing");

  // The owner can take its old key back; AGB then becomes the alias.
  const back = await changeProductKey(query, ids.agentboard.product, "AB");
  assert.equal(back.product.key, "AB");
  const { rows: keys } = await query("SELECT key FROM product_keys WHERE product_id = $1 ORDER BY key", [ids.agentboard.product]);
  assert.deepEqual(keys.map((a) => a.key), ["AB", "AGB"]);

  // The database refuses it too, whoever writes: not only these helpers.
  await assert.rejects(
    query("UPDATE products SET key = 'AGB' WHERE id = $1", [ids.ops.product]),
    (err) => err.code === "23505" && err.constraint === "product_keys_pkey"
  );
  await assert.rejects(
    query("INSERT INTO products (org_id, name, slug, key) SELECT org_id, 'Thief', 'thief', 'AGB' FROM products WHERE id = $1", [ids.ops.product]),
    (err) => err.code === "23505"
  );
  assert.equal(await resolveCardRef(query, "AGB-1"), ids.oldA.id);
});

// Two renames racing: one product hands its key off while another asks for
// it. Needs two real connections, so not against pglite-socket.
const concurrent = skip || (Number(process.env.TEST_POOL_MAX || 10) < 2 ? "needs two connections" : false);
test("a key being handed off can't be taken by a concurrent rename", { skip: concurrent }, async () => {
  const a = await scopedClient();
  const b = await scopedClient();
  let taking;
  try {
    await a.query("BEGIN");
    const moved = await changeProductKey((t, v) => a.query(t, v), ids["agent-builder"].product, "ZED");
    assert.equal(moved.product.key, "ZED");
    // Waits on a's uncommitted change, then has to see AB2 is still a's.
    taking = changeProductKey((t, v) => b.query(t, v), ids.ops.product, "AB2");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await a.query("COMMIT");
    assert.deepEqual(await taking, { error: "Key AB2 is already used by another product", status: 409 });
  } finally {
    await taking?.catch(() => {});
    a.release(true);
    b.release(true);
  }
  const { rows } = await query("SELECT key FROM products WHERE id = $1", [ids.ops.product]);
  assert.equal(rows[0].key, "OPS");
  assert.equal(await resolveCardRef(query, "AB2-1"), ids.oldX.id, "the old key still means its own product");
  assert.equal(await resolveCardRef(query, "ZED-1"), ids.oldX.id);
});

test("a product update that fails partway changes nothing", { skip }, async () => {
  const client = await scopedClient();
  let result;
  try {
    // The key is free; the name's slug belongs to another product.
    result = await updateProduct(client, ids.ops.product, { key: "NEWK", name: "AgentBoard" });
  } finally {
    // Discarded, not reused: pglite-socket desyncs a client after an error.
    client.release(true);
  }
  assert.deepEqual(result, { error: "Product already exists in this org", status: 409 });
  const { rows } = await query("SELECT key, name FROM products WHERE id = $1", [ids.ops.product]);
  assert.deepEqual(rows[0], { key: "OPS", name: "Ops" });
  const ops = await insertCard(ids.ops.column, "probe");
  assert.equal(await resolveCardRef(query, `NEWK-${ops.number}`), null, "NEWK was not kept as a key");
  await query("DELETE FROM cards WHERE id = $1", [ops.id]);

  // The same call with nothing in the way applies both.
  const ok = await withScoped((c) => updateProduct(c, ids.ops.product, { key: "OPZ", name: "Ops Two" }));
  assert.equal(ok.product.key, "OPZ");
  assert.equal(ok.product.name, "Ops Two");
  await withScoped((c) => updateProduct(c, ids.ops.product, { key: "OPS", name: "Ops" }));
});

test("deleting a card or a product leaves no dangling numbers", { skip }, async () => {
  const card = await insertCard(ids.ops.column, "short-lived");
  const ref = `OPS-${card.number}`;
  await query("DELETE FROM cards WHERE id = $1", [card.id]);
  assert.equal(await resolveCardRef(query, ref), null);

  await query("DELETE FROM products WHERE id = $1", [ids.ops.product]);
  const { rows } = await query("SELECT COUNT(*)::int AS n FROM card_numbers WHERE product_id = $1", [ids.ops.product]);
  assert.equal(rows[0].n, 0);
});

test("a failed insert spends no number", { skip }, async () => {
  const { rows: seq } = await query("SELECT card_seq FROM products WHERE id = $1", [ids.agentboard.product]);
  await assert.rejects(query("INSERT INTO cards (column_id, title) VALUES ($1, NULL)", [ids.agentboard.column]));
  const { rows: after } = await query("SELECT card_seq FROM products WHERE id = $1", [ids.agentboard.product]);
  assert.equal(after[0].card_seq, seq[0].card_seq);
});
