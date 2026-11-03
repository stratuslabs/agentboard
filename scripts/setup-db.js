// Standalone database setup for self-hosting (PostgreSQL).
//
// IMPORTANT: keep this schema in sync with `ensureTables()` in `src/lib/db.ts`,
// which is the runtime source of truth — the app also creates/migrates these
// tables lazily on the first request. This script exists so a fresh deploy can
// be initialized explicitly (e.g. `vercel env pull .env.local && npm run db:setup`).

const { describeDbError } = require("./db-script");
const { sql, db, end } = require("../src/lib/sql");
const { DEFAULT_BOARD_MIGRATION } = require("../src/lib/default-board-migration");
const { CARD_NUMBER_MIGRATION, ensureProductKeys } = require("../src/lib/card-keys");
const { TENANCY_MIGRATION, ensureDefaultTeam, ensureTeamDefaults } = require("../src/lib/tenancy");
const { AGENT_NAME_MIGRATION } = require("../src/lib/agent-names");
const { GITHUB_APP_MIGRATION } = require("../src/lib/github-tables");

async function setup() {
  await sql`
    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      position INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      emoji TEXT DEFAULT '📦',
      position INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(org_id, slug)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS boards (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      UNIQUE(product_id, slug)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS columns (
      id SERIAL PRIMARY KEY,
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      color TEXT DEFAULT '#6B7280',
      UNIQUE(board_id, slug)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS cards (
      id SERIAL PRIMARY KEY,
      column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      assignee TEXT,
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
      labels TEXT DEFAULT '',
      github_issue_url TEXT,
      github_pr_url TEXT,
      position INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS members (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'human' CHECK(type IN ('human', 'agent')),
      color TEXT DEFAULT '#6B7280',
      avatar_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  // Migration: link cards to members (matches src/lib/db.ts)
  await sql`ALTER TABLE cards ADD COLUMN IF NOT EXISTS assignee_id INTEGER REFERENCES members(id) ON DELETE SET NULL`;
  // Migration: due dates on cards
  await sql`ALTER TABLE cards ADD COLUMN IF NOT EXISTS due_date DATE`;
  // Migration: stamp boards and columns so a client can fetch a delta
  await sql`ALTER TABLE boards ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`;
  await sql`ALTER TABLE columns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`;
  // Migration: a product's default board is where the CLI lands when no board
  // is named. Products that predate it get their `development` board, once,
  // atomically with adding the column (see default-board-migration.js).
  await db.query(DEFAULT_BOARD_MIGRATION);
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS user_preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  // Migration: tenancy, before card numbers (see tenancy.js)
  await db.query(TENANCY_MIGRATION);
  await db.query(AGENT_NAME_MIGRATION);
  // Migration: per-product card numbers and product keys (see card-keys.js)
  await db.query(CARD_NUMBER_MIGRATION);
  await ensureProductKeys((text, values) => db.query(text, values));
  await sql`
    CREATE TABLE IF NOT EXISTS attachments (
      id SERIAL PRIMARY KEY,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  // Sub-tasks: a checklist on a card. Every write also bumps the card's
  // updated_at, so board deltas and the realtime stream pick it up.
  await sql`
    CREATE TABLE IF NOT EXISTS subtasks (
      id SERIAL PRIMARY KEY,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      done BOOLEAN NOT NULL DEFAULT FALSE,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS subtasks_card_id_idx ON subtasks (card_id, position, id)`;
  // Card links: any URL a card points at (a Slack thread, a doc, a design).
  await sql`
    CREATE TABLE IF NOT EXISTS card_links (
      id SERIAL PRIMARY KEY,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (card_id, url)
    )
  `;
  // GitHub App: installation bindings and handled deliveries.
  await db.query(GITHUB_APP_MIGRATION);
  // The self-hosted team and its default settings (the app also does this on
  // its first request). An untouched old default column list gains Blocked.
  const query = (text, values) => db.query(text, values);
  await ensureTeamDefaults(query, await ensureDefaultTeam(query));

  console.log("Database setup complete (PostgreSQL).");
}

setup()
  .then(() => end())
  .catch(async (err) => {
    console.error("Setup failed:", describeDbError(err));
    await end().catch(() => {});
    process.exit(1);
  });
