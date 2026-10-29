#!/usr/bin/env node
// `npm run demo`: AgentBoard with sample data, in one command.
//
// 1. Picks a database of its own (never the one in POSTGRES_URL/DATABASE_URL,
//    since it writes sample cards):
//    - AGENTBOARD_DEMO_DATABASE_URL, used as it is, or
//    - an `agentboard_demo` database on the Docker Compose Postgres, which it
//      starts with `docker compose up -d db` and creates if missing.
// 2. Runs `scripts/setup-db.js` and `scripts/seed.js --demo` against it. Both
//    are safe to rerun, so the demo keeps whatever you changed last time.
// 3. Starts `next dev` pointed at it.
//
// Flags:
//   --reset      drop and recreate agentboard_demo first (Compose only)
//   --no-start   set up and seed, then exit
//   --port N     port for the app (default: PORT, then 3000)

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The Postgres from docker-compose.yml. */
export const COMPOSE_URL = "postgresql://agentboard:agentboard@localhost:5432/agentboard";
export const DEMO_DATABASE = "agentboard_demo";

/** `url` with its database name replaced by `name`. */
export function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/**
 * Where the demo's data goes.
 * @param {Record<string, string | undefined>} env
 * @returns {{ url: string, compose: boolean }}
 */
export function demoTarget(env) {
  const explicit = env.AGENTBOARD_DEMO_DATABASE_URL?.trim();
  if (explicit) return { url: explicit, compose: false };
  return { url: withDatabase(COMPOSE_URL, DEMO_DATABASE), compose: true };
}

/** `env` with both connection variables the app reads pointed at `url`. */
export function childEnv(env, url) {
  return { ...env, POSTGRES_URL: url, DATABASE_URL: url };
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const out = { reset: false, start: true, port: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--reset") out.reset = true;
    else if (arg === "--no-start") out.start = false;
    else if (arg === "--port" || arg.startsWith("--port=")) {
      const value = arg === "--port" ? argv[++i] : arg.slice("--port=".length);
      if (!/^[1-9][0-9]{0,4}$/.test(value ?? "") || Number(value) > 65535) {
        throw new Error(`--port needs a port number, got ${value === undefined ? "nothing" : JSON.stringify(value)}`);
      }
      out.port = value;
    } else throw new Error(`unknown option ${arg} (try --reset, --no-start or --port N)`);
  }
  return out;
}

/** The URL without its password, for messages. */
function display(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "(unparseable URL)";
  }
}

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${args.join(" ")} failed (${signal ?? `exit ${code}`})`)),
    );
  });
}

function startCompose() {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "up", "-d", "db"], { cwd: ROOT, stdio: "inherit" });
    child.on("error", (err) =>
      reject(
        err.code === "ENOENT"
          ? new Error(
              "Docker isn't installed. Install it, or point the demo at a Postgres you have:\n" +
                "  AGENTBOARD_DEMO_DATABASE_URL=postgresql://user:pass@localhost:5432/agentboard_demo npm run demo",
            )
          : err,
      ),
    );
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("`docker compose up -d db` failed. Is Docker running? (Or set AGENTBOARD_DEMO_DATABASE_URL.)")),
    );
  });
}

/** Connect to the Compose server's own database, retrying while it boots. */
async function connectAdmin(timeoutMs = 60_000) {
  const { Client } = require("pg");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const client = new Client({ connectionString: COMPOSE_URL });
    try {
      await client.connect();
      return client;
    } catch (err) {
      await client.end().catch(() => {});
      if (Date.now() > deadline) throw new Error(`Postgres on ${display(COMPOSE_URL)} didn't come up: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function prepareComposeDatabase(reset) {
  await startCompose();
  const admin = await connectAdmin();
  try {
    if (reset) {
      await admin.query(`DROP DATABASE IF EXISTS ${DEMO_DATABASE} WITH (FORCE)`);
      console.log(`Dropped ${DEMO_DATABASE}.`);
    }
    const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DEMO_DATABASE]);
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE ${DEMO_DATABASE}`);
      console.log(`Created ${DEMO_DATABASE}.`);
    }
  } finally {
    await admin.end().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = demoTarget(process.env);
  if (args.reset && !target.compose) {
    throw new Error(
      "--reset only drops the Compose demo database. To start over with AGENTBOARD_DEMO_DATABASE_URL, drop and recreate that database yourself.",
    );
  }
  if (target.compose) await prepareComposeDatabase(args.reset);

  console.log(`Demo database: ${display(target.url)}`);
  const env = childEnv(process.env, target.url);
  await runNode(["scripts/setup-db.js"], env);
  await runNode(["scripts/seed.js", "--demo"], env);
  if (!args.start) return;

  const port = args.port ?? process.env.PORT ?? "3000";
  console.log(`\nStarting AgentBoard at http://localhost:${port} (Ctrl+C to stop).\n`);
  const next = require.resolve("next/dist/bin/next");
  const app = spawn(process.execPath, [next, "dev", "-p", port], { cwd: ROOT, env, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => app.kill(signal));
  app.on("exit", (code, signal) => process.exit(signal ? 0 : (code ?? 0)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`Demo failed: ${err.message}`);
    process.exit(1);
  });
}
