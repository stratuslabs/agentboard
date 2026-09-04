"use strict";

/**
 * Postgres access for the app and the `scripts/` CLIs.
 *
 * This wraps `pg` in the small surface the codebase already used: a `sql`
 * tagged template and a `db.query(text, values)` escape hatch. Keeping that
 * shape means call sites did not have to change when the driver did.
 *
 * `pg` speaks the Postgres wire protocol, so any Postgres works — a local
 * container, Neon, Supabase, RDS, or your own server. Kept deliberately in
 * step with the same file in the hosted edition, so the two do not drift.
 */

const { Pool } = require("pg");

/** Hosts we are willing to talk to without TLS. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Connection string variables, in the order they are tried.
 *
 * `POSTGRES_URL` is what .env.example documents. `DATABASE_URL` is what Neon's
 * native Vercel integration sets, so a database provisioned through the
 * marketplace — including by the one-click deploy button — works without
 * anyone first noticing that the name does not match.
 */
const CONNECTION_STRING_VARS = ["POSTGRES_URL", "DATABASE_URL"];

/**
 * The first connection string that is set, or null when none is.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
function connectionString(env = process.env) {
  for (const name of CONNECTION_STRING_VARS) {
    const value = env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** @type {import('pg').Pool | undefined} */
let pool;

/**
 * Pull the host and sslmode out of a connection string without depending on
 * `pg`'s transitive parser.
 * @param {string} connectionString
 */
function parseTarget(connectionString) {
  try {
    const url = new URL(connectionString.replace(/^postgres(ql)?:\/\//, "https://"));
    return { host: url.hostname, sslmode: url.searchParams.get("sslmode") };
  } catch {
    return { host: "", sslmode: null };
  }
}

/**
 * TLS settings, decided explicitly rather than left to the connection string.
 *
 * `pg` enables TLS only when the URL asks for it, so a remote database reached
 * by a URL that omits `sslmode` would otherwise be queried in plaintext. Here
 * anything that is not loopback gets verified TLS unless it opts out.
 * @param {string} connectionString
 */
function sslConfig(connectionString) {
  const { host, sslmode } = parseTarget(connectionString);

  if (sslmode === "disable") return false;
  if (sslmode === "no-verify") return { rejectUnauthorized: false };
  if (sslmode) return { rejectUnauthorized: true };

  // No sslmode given: plaintext is only acceptable to loopback.
  return LOCAL_HOSTS.has(host) ? false : { rejectUnauthorized: true };
}

/**
 * Created lazily: importing this module must not throw when no connection
 * string is set, or `next build` would fail on any route that imports it.
 */
function getPool() {
  if (pool) return pool;

  const url = connectionString();
  if (!url) {
    // Naming every variable that was tried turns "it is not set" into a
    // question you can answer from the log line alone.
    throw new Error(
      `No database connection string. Looked for ${CONNECTION_STRING_VARS.join(", ")}. ` +
        "Copy .env.example to .env.local and set POSTGRES_URL, or run " +
        "`vercel env pull .env.local`."
    );
  }

  pool = new Pool({
    connectionString: url,
    ssl: sslConfig(url),
    // One pool per process, and serverless runs many processes. Keep each
    // one small and point the connection string at a pooled endpoint in
    // production.
    max: Number(process.env.POSTGRES_POOL_MAX || 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  // A pooled client erroring while idle must not take the process down.
  pool.on("error", (err) => {
    console.error("Unexpected idle client error", err);
  });

  return pool;
}

/**
 * Tagged template that parameterises every interpolation — `${x}` becomes a
 * bound `$n`, never string concatenation, so values cannot alter the SQL.
 *
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {Promise<import('pg').QueryResult<any>>}
 */
function sql(strings, ...values) {
  if (!strings || !Array.isArray(strings) || !("raw" in strings)) {
    throw new Error("`sql` must be called as a tagged template: sql`SELECT 1`");
  }
  let text = "";
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) text += `$${i + 1}`;
  }
  return getPool().query(text, values);
}

/** Escape hatch for queries built dynamically; mirrors `pg`'s Pool.query. */
const db = {
  /**
   * @param {string} text
   * @param {unknown[]} [values]
   * @returns {Promise<import('pg').QueryResult<any>>}
   */
  query(text, values) {
    return getPool().query(text, values);
  },
};

/** Close the pool so a short-lived script can exit. */
async function end() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = { sql, db, end };
