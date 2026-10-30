// The demo seed (`node scripts/seed.js --demo`, run by `npm run demo`) through
// the real scripts, against a database of its own:
//
// - it fills a board with cards in every column, plus people, agents,
//   sub-tasks and links, so the app has something to show;
// - running it again adds nothing, so `npm run demo` is safe to rerun;
// - plain `db:seed` still only creates the empty orgs, products and boards.
//
//   AGENTBOARD_TEST_DATABASE_URL=postgres://... node --test test/
//
// Skipped without it. Needs a role that can CREATE DATABASE; the database is
// dropped at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const run = promisify(execFile);
const URL_VAR = "AGENTBOARD_TEST_DATABASE_URL";
const adminUrl = process.env[URL_VAR];
const skip = adminUrl ? false : `set ${URL_VAR} to run`;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DB_NAME = `seed_demo_test_${process.pid}`;

let admin;
let db;
let dbUrl;

function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function script(name, ...args) {
  const env = { ...process.env, POSTGRES_URL: dbUrl, DATABASE_URL: dbUrl };
  return run(process.execPath, [`scripts/${name}`, ...args], { cwd: ROOT, env });
}

async function counts() {
  const q = async (text) => Number((await db.query(text)).rows[0].n);
  return {
    orgs: await q("SELECT count(*) AS n FROM organizations"),
    products: await q("SELECT count(*) AS n FROM products"),
    boards: await q("SELECT count(*) AS n FROM boards"),
    columns: await q("SELECT count(*) AS n FROM columns"),
    cards: await q("SELECT count(*) AS n FROM cards"),
    members: await q("SELECT count(*) AS n FROM members"),
    subtasks: await q("SELECT count(*) AS n FROM subtasks"),
    links: await q("SELECT count(*) AS n FROM card_links"),
  };
}

before(async () => {
  if (skip) return;
  const { Client } = require("pg");
  admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  dbUrl = withDatabase(adminUrl, DB_NAME);
  db = new Client({ connectionString: dbUrl });
  await db.connect();
  await script("setup-db.js");
});

after(async () => {
  if (skip) return;
  await db?.end().catch(() => {});
  await admin?.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`).catch(() => {});
  await admin?.end().catch(() => {});
});

test("plain db:seed creates boards but no cards or members", { skip }, async () => {
  await script("seed.js");
  const c = await counts();
  assert.ok(c.boards > 0, "boards");
  assert.equal(c.cards, 0);
  assert.equal(c.members, 0);
});

test("--demo fills a board: cards in every column, people and agents, sub-tasks and links", { skip }, async () => {
  const { stdout } = await script("seed.js", "--demo");
  assert.match(stdout, /demo/i);

  // Every column of the demo board has at least one card.
  const { rows: columns } = await db.query(`
    SELECT col.slug, count(c.id)::int AS n
    FROM columns col
    JOIN boards b ON b.id = col.board_id
    JOIN products p ON p.id = b.product_id
    LEFT JOIN cards c ON c.column_id = col.id
    WHERE p.slug = 'web-app' AND b.slug = 'development'
    GROUP BY col.slug
  `);
  assert.ok(columns.length >= 6, JSON.stringify(columns));
  for (const col of columns) assert.ok(col.n > 0, `column ${col.slug} is empty`);

  const { rows: members } = await db.query("SELECT name, type FROM members ORDER BY id");
  assert.ok(members.some((m) => m.type === "human"), "a human member");
  assert.ok(members.some((m) => m.type === "agent"), "an agent member");

  // Assigned cards point at real members, and every card got a number (AB-1 style).
  const { rows: cards } = await db.query(`
    SELECT c.assignee, c.assignee_id, m.name AS member_name, cn.number
    FROM cards c
    LEFT JOIN members m ON m.id = c.assignee_id
    LEFT JOIN card_numbers cn ON cn.card_id = c.id
  `);
  assert.ok(cards.length >= 8, `only ${cards.length} cards`);
  for (const card of cards) {
    assert.ok(card.number, "card has a number");
    // A member-backed assignment is stored by id only (card 838), never as text too.
    if (card.assignee_id) assert.equal(card.assignee, null, "assigned by id, no text copy");
    assert.ok(!card.assignee || card.member_name === card.assignee);
  }
  assert.ok(cards.some((c) => c.assignee_id), "some cards are assigned");

  const c = await counts();
  assert.ok(c.subtasks > 0, "sub-tasks");
  assert.ok(c.links > 0, "links");
});

test("running the demo seed again adds nothing", { skip }, async () => {
  const first = await counts();
  await script("seed.js", "--demo");
  await script("seed.js", "--demo");
  assert.deepEqual(await counts(), first);
});

test("the demo seed leaves a card someone moved or edited alone", { skip }, async () => {
  // A demo visitor drags a card to Done and edits its title. Reseeding must
  // not put a second copy back where it started.
  const { rows } = await db.query(`
    SELECT c.id FROM cards c JOIN columns col ON col.id = c.column_id
    WHERE col.slug = 'todo' ORDER BY c.id LIMIT 1
  `);
  const id = rows[0].id;
  await db.query(
    `UPDATE cards SET title = title || ' (edited)',
       column_id = (SELECT id FROM columns WHERE board_id = (SELECT board_id FROM columns WHERE id = cards.column_id) AND slug = 'done')
     WHERE id = $1`,
    [id],
  );
  const before = await counts();
  await script("seed.js", "--demo");
  assert.deepEqual(await counts(), before);
});
