// Shared by the database scripts (db:setup, db:seed).
//
// The database scripts run outside Next, and Next is what reads .env.local for
// `npm run dev`. Without this, `npm run db:setup` never sees the POSTGRES_URL
// the README tells you to put in .env.local.
//
// It loads the same files Next does (.env.local, .env, ...) with Next's own
// loader. Variables already set in the environment win, so
// `POSTGRES_URL=... npm run db:setup` still works.

const path = require("path");

// @next/env is a dependency of next; resolve it from next's location rather
// than relying on npm hoisting it to the top of node_modules.
const nextEnv = require.resolve("@next/env", {
  paths: [path.dirname(require.resolve("next/package.json"))],
});

require(nextEnv).loadEnvConfig(path.resolve(__dirname, ".."));

// A refused connection (Postgres not started) arrives as an AggregateError with
// an empty message, which used to print "Setup failed: " and nothing else.
function describeDbError(err) {
  const message = err.message || err.code || String(err);
  return err.code === "ECONNREFUSED"
    ? `${message}. Is Postgres running? For the bundled one: docker compose up -d`
    : message;
}

module.exports = { describeDbError };
