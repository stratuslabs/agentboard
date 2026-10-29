// `npm run demo` (scripts/demo.mjs): where the demo's data goes, and the
// seed-only path end to end.
//
// The demo writes sample cards, so it must never land in the database the app
// is configured for. It uses its own: AGENTBOARD_DEMO_DATABASE_URL when set,
// otherwise an `agentboard_demo` database on the Docker Compose Postgres. It
// ignores POSTGRES_URL and DATABASE_URL, and overrides both for the scripts
// and the app it starts.
//
// The end-to-end tests need AGENTBOARD_TEST_DATABASE_URL (a role that can
// CREATE DATABASE) and are skipped without it.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { demoTarget, withDatabase, childEnv, parseArgs, COMPOSE_URL } from "../scripts/demo.mjs";

const require = createRequire(import.meta.url);
const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const URL_VAR = "AGENTBOARD_TEST_DATABASE_URL";
const adminUrl = process.env[URL_VAR];
const skip = adminUrl ? false : `set ${URL_VAR} to run`;
const DB_NAME = `demo_launcher_test_${process.pid}`;

test("with no demo URL it uses agentboard_demo on the Compose Postgres", () => {
  const t = demoTarget({ POSTGRES_URL: "postgres://prod/app", DATABASE_URL: "postgres://prod/app" });
  assert.equal(t.compose, true);
  assert.equal(t.url, withDatabase(COMPOSE_URL, "agentboard_demo"));
  assert.match(t.url, /localhost:5432\/agentboard_demo/);
});

test("AGENTBOARD_DEMO_DATABASE_URL is used as it is, and Compose is left alone", () => {
  const t = demoTarget({ AGENTBOARD_DEMO_DATABASE_URL: " postgres://me@db:5433/try_it ", POSTGRES_URL: "postgres://prod/app" });
  assert.deepEqual(t, { url: "postgres://me@db:5433/try_it", compose: false });
});

test("withDatabase swaps only the database name and keeps the query", () => {
  assert.equal(
    withDatabase("postgresql://u:p@localhost:5432/agentboard?sslmode=disable", "agentboard_demo"),
    "postgresql://u:p@localhost:5432/agentboard_demo?sslmode=disable",
  );
});

test("the scripts and the app get the demo URL in both variables the app reads", () => {
  const env = childEnv({ POSTGRES_URL: "postgres://prod/app", DATABASE_URL: "postgres://prod/app", PATH: "/bin" }, "postgres://demo/db");
  assert.equal(env.POSTGRES_URL, "postgres://demo/db");
  assert.equal(env.DATABASE_URL, "postgres://demo/db");
  assert.equal(env.PATH, "/bin");
});

test("flags: --reset, --no-start and --port", () => {
  assert.deepEqual(parseArgs([]), { reset: false, start: true, port: null });
  assert.deepEqual(parseArgs(["--reset", "--no-start", "--port", "3456"]), { reset: true, start: false, port: "3456" });
  assert.deepEqual(parseArgs(["--port=4000"]), { reset: false, start: true, port: "4000" });
  assert.throws(() => parseArgs(["--port", "abc"]), /port/);
  assert.throws(() => parseArgs(["--bogus"]), /--bogus/);
});

let admin;
let db;
let dbUrl;

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
});

after(async () => {
  if (skip) return;
  await db?.end().catch(() => {});
  await admin?.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`).catch(() => {});
  await admin?.end().catch(() => {});
});

async function demo(...args) {
  // A configured app database that must not be touched: unreachable on purpose.
  const env = {
    ...process.env,
    AGENTBOARD_DEMO_DATABASE_URL: dbUrl,
    POSTGRES_URL: "postgresql://nobody:nothing@127.0.0.1:1/not_this_one",
    DATABASE_URL: "postgresql://nobody:nothing@127.0.0.1:1/not_this_one",
  };
  return run(process.execPath, ["scripts/demo.mjs", ...args], { cwd: ROOT, env });
}

const cardCount = async () => Number((await db.query("SELECT count(*) AS n FROM cards")).rows[0].n);

test("--no-start sets up and seeds the demo database, not the configured one", { skip }, async () => {
  const { stdout } = await demo("--no-start");
  assert.match(stdout, /Demo data added/);
  assert.ok((await cardCount()) >= 8);
});

test("a second run adds nothing", { skip }, async () => {
  const before = await cardCount();
  const { stdout } = await demo("--no-start");
  assert.match(stdout, /already there/);
  assert.equal(await cardCount(), before);
});

test("--reset refuses a database it didn't create", { skip }, async () => {
  await assert.rejects(demo("--reset", "--no-start"), (err) => {
    assert.match(err.stderr, /--reset/);
    return true;
  });
  assert.ok((await cardCount()) >= 8, "data still there");
});
